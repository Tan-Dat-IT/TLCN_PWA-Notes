import { db, SYNC_CURSOR_KEY, type Note, type ServerNote } from './database'
import { validSchedule, validTime } from './noteFields'
import { API_URL, request, SyncFailure } from './api'

// Giao thức đồng bộ v3 (khớp SYNC_VERSION ở backend/src/app.js):
//  - Gửi lên: mỗi ghi chú kèm baseVersion = phiên bản server nó dựa vào. Server
//    chỉ ghi khi baseVersion khớp, lệch thì trả "conflict" kèm bản trên server
//    -> không bao giờ âm thầm ghi đè thay đổi của thiết bị khác.
//  - Tải về: chỉ lấy thay đổi sau con trỏ đã lưu (delta), theo từng trang.
const SYNC_VERSION = 3
const MAX_PAGES = 1000

let running: Promise<void> | undefined

export type RemoteNote = ServerNote
export function validRemote(n: RemoteNote) {
  return Boolean(n && typeof n.serverId === 'string' && n.serverId.length > 0 && n.serverId.length <= 100 &&
    typeof n.title === 'string' && n.title.trim().length > 0 && n.title.length <= 255 &&
    typeof n.content === 'string' && n.content.length <= 100000 && typeof n.tag === 'string' && n.tag.length <= 100 &&
    typeof n.done === 'boolean' && validTime(n.updatedAt) && n.updatedAt !== null &&
    Number.isSafeInteger(n.version) && n.version >= 1 && n.version <= 2147483647 &&
    (n.deleted === 0 || n.deleted === 1) && validSchedule(n) &&
    validTime(n.createdAt) && validTime(n.completedAt) && validTime(n.deletedAt) &&
    (n.kind !== 'note' || !n.done) && (n.done || n.completedAt === null) && (n.deleted || n.deletedAt === null))
}

const validCursor = (value: unknown): value is string => typeof value === 'string' && /^\d{1,19}$/.test(value)

// Hai bản có cùng nội dung người dùng nhìn thấy (bỏ qua các mốc thời gian tự sinh).
export function sameContent(a: Pick<Note, 'title' | 'content' | 'tag' | 'kind' | 'done' | 'deleted' | 'startAt' | 'dueAt'>, b: typeof a) {
  return a.title === b.title && a.content === b.content && a.tag === b.tag && a.kind === b.kind &&
    a.done === b.done && a.deleted === b.deleted && a.startAt === b.startAt && a.dueAt === b.dueAt
}

// Dữ liệu local tương ứng 1 bản trên server (đã đồng bộ, không còn xung đột).
export function fromServer(remote: ServerNote) {
  return { serverId: remote.serverId, title: remote.title, content: remote.content,
    kind: remote.kind, startAt: remote.startAt, dueAt: remote.dueAt,
    createdAt: remote.createdAt, completedAt: remote.completedAt, deletedAt: remote.deletedAt,
    tag: remote.tag, done: remote.done, updatedAt: remote.updatedAt, deleted: remote.deleted,
    baseVersion: remote.version, conflict: null, synced: 1 as const }
}

// Chỉ gửi đúng các trường server cần - không gửi `conflict` (có thể nặng tới
// 100k ký tự) hay `synced`.
function toPayload(note: Note) {
  return { id: note.id, serverId: note.serverId, title: note.title, content: note.content, tag: note.tag,
    kind: note.kind, done: note.done, deleted: note.deleted, updatedAt: note.updatedAt,
    createdAt: note.createdAt, startAt: note.startAt, dueAt: note.dueAt,
    completedAt: note.completedAt, deletedAt: note.deletedAt, baseVersion: note.baseVersion ?? null }
}

type PushResult = { localId: number; serverId: string } & (
  { status: 'applied'; version: number } | { status: 'conflict'; server: ServerNote } | { status: 'rejected' })

function validResult(r: PushResult, sent: Note) {
  if (!r || r.localId !== sent.id || r.serverId !== sent.serverId) return false
  if (r.status === 'applied') return Number.isSafeInteger(r.version) && r.version >= 1
  if (r.status === 'conflict') return validRemote(r.server) && r.server.serverId === sent.serverId
  return r.status === 'rejected'
}

async function getCursor() {
  return (await db.meta.get(SYNC_CURSOR_KEY))?.value
}

async function push() {
  const pending = (await db.notes.where('synced').equals(0).toArray()).filter(n => !n.conflict)
  // Tối đa ba bản: cả trường hợp ký tự JSON phải escape vẫn dưới giới hạn 2 MB.
  for (let offset = 0; offset < pending.length; offset += 3) {
    const batch = pending.slice(offset, offset + 3)
    const { results, version } = await request(`${API_URL}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Version': String(SYNC_VERSION) },
      body: JSON.stringify({ notes: batch.map(toPayload) })
    })
    if (version !== SYNC_VERSION || !Array.isArray(results) || results.length !== batch.length ||
        !batch.every((note, i) => validResult(results[i], note))) {
      throw new SyncFailure('Phản hồi xác nhận không hợp lệ. Dữ liệu chưa xác nhận vẫn được giữ để gửi lại.', false)
    }
    await db.transaction('rw', db.notes, async () => {
      for (const [i, sent] of batch.entries()) {
        const result = results[i] as PushResult
        const current = await db.notes.get(sent.id!)
        if (!current || current.serverId !== sent.serverId) continue
        if (result.status === 'applied') {
          // Người dùng sửa tiếp trong lúc request đang chạy: bản mới vẫn chờ gửi,
          // nhưng phải dựa trên phiên bản server vừa nhận - nếu không lần gửi
          // sau sẽ tự xung đột với chính thay đổi của mình.
          await db.notes.update(sent.id!, current.updatedAt === sent.updatedAt
            ? { synced: 1, baseVersion: result.version } : { baseVersion: result.version })
        } else if (result.status === 'conflict') {
          // Ghi chú mới (baseVersion=null) mà server đã có ở phiên bản 1: lần gửi
          // trước đã tới server nhưng mất phản hồi. ServerId do chính thiết bị
          // này sinh nên phiên bản 1 chắc chắn là bản của mình và chưa ai sửa
          // (thiết bị khác sửa sẽ thành phiên bản 2+) -> nhận làm gốc rồi gửi
          // lại, không bắt người dùng xử lý xung đột với chính mình.
          if (sent.baseVersion == null && result.server.version === 1) await db.notes.update(sent.id!, { baseVersion: 1 })
          else await db.notes.update(sent.id!, { conflict: result.server })
        } else {
          // ServerId tình cờ trùng ghi chú của tài khoản khác: đổi ID mới, gửi lại lần sau.
          await db.notes.update(sent.id!, { serverId: crypto.randomUUID(), baseVersion: null })
        }
      }
    })
  }
}

async function applyRemote(remote: ServerNote) {
  const local = await db.notes.where('serverId').equals(remote.serverId).first()
  if (!local) { await db.notes.add(fromServer(remote)); return }
  if (local.baseVersion === undefined) {
    // Dữ liệu tạo trước giao thức v3 (chưa biết phiên bản). Bản đã đồng bộ thì
    // nhận bản server. Bản đang chờ gửi thì nhận phiên bản server làm gốc; nếu
    // server có bản mới hơn với nội dung khác (trước đây sẽ bị ghi đè mất) thì
    // đánh dấu xung đột để người dùng tự chọn.
    if (local.synced === 1) await db.notes.update(local.id!, fromServer(remote))
    else await db.notes.update(local.id!, { baseVersion: remote.version,
      conflict: remote.updatedAt > local.updatedAt && !sameContent(local, remote) ? remote : null })
    return
  }
  if (local.synced === 1) {
    if (remote.version >= (local.baseVersion ?? 0)) await db.notes.update(local.id!, fromServer(remote))
    // Server có phiên bản CŨ hơn bản local đã đồng bộ: chỉ xảy ra khi database
    // server bị khôi phục từ bản sao lưu -> gửi lại bản local lên.
    else await db.notes.update(local.id!, { synced: 0, baseVersion: remote.version })
    return
  }
  // Đang chờ gửi: không ghi đè. Nếu server đổi tiếp khi đang có xung đột thì
  // cập nhật bản so sánh cho mới nhất; còn lại lần gửi sau sẽ tự phát hiện.
  if (local.conflict) {
    if (remote.version > local.conflict.version) await db.notes.update(local.id!, { conflict: remote })
  } else if (local.baseVersion === null && remote.version === 1) {
    // Ghi chú mới đã lên server nhưng mất phản hồi xác nhận. ServerId do chính
    // thiết bị này sinh nên phiên bản 1 chắc chắn là bản của mình và chưa ai
    // sửa -> nhận làm gốc, tránh lần gửi sau tự xung đột với chính mình.
    await db.notes.update(local.id!, { baseVersion: 1 })
  }
}

async function fetchPage(since: string) {
  const body = await request(`${API_URL}?since=${encodeURIComponent(since)}`)
  if (!body || !Array.isArray(body.notes) || !body.notes.every(validRemote) || !validCursor(body.cursor) ||
      typeof body.hasMore !== 'boolean' || typeof body.reset !== 'boolean') {
    throw new SyncFailure('Dữ liệu server thiếu trường hoặc sai định dạng. Kiểm tra migration và phiên bản backend.', false)
  }
  if (body.hasMore && body.cursor === since) {
    throw new SyncFailure('Server báo còn dữ liệu nhưng con trỏ không tiến lên. Dừng đồng bộ để tránh vòng lặp vô hạn.', false)
  }
  return body as { notes: ServerNote[]; cursor: string; hasMore: boolean; reset: boolean }
}

async function pull() {
  let cursor = (await getCursor()) ?? '0'
  const first = await fetchPage(cursor)
  if (first.reset) { await pullAfterReset(first); return }
  let page = first
  for (let count = 1; ; count++) {
    await db.transaction('rw', db.notes, db.meta, async () => {
      for (const remote of page.notes) await applyRemote(remote)
      await db.meta.put({ key: SYNC_CURSOR_KEY, value: page.cursor })
    })
    cursor = page.cursor
    if (!page.hasMore) return
    if (count >= MAX_PAGES) {
      throw new SyncFailure('Một lượt đồng bộ vượt quá giới hạn trang an toàn. Hãy bấm Đồng bộ ngay để tải tiếp.', false)
    }
    page = await fetchPage(cursor)
  }
}

// Server báo con trỏ không còn hợp lệ (database bị khôi phục/tạo lại). Tải lại
// toàn bộ trước rồi mới áp dụng trong 1 giao dịch: ghi chú local từng lên
// server nhưng nay không còn ở đó được đánh dấu chờ gửi như ghi chú mới để
// không bị mất. Không lưu con trỏ giữa chừng - đứt mạng thì lần sau làm lại từ đầu.
async function pullAfterReset(first: { notes: ServerNote[]; cursor: string; hasMore: boolean }) {
  const all = [...first.notes]
  let page = first
  for (let count = 1; page.hasMore && count < MAX_PAGES; count++) {
    page = await fetchPage(page.cursor)
    all.push(...page.notes)
  }
  // Chưa áp dụng gì khi lần tải lại toàn bộ chưa hoàn tất; nếu đánh dấu
  // orphan từ danh sách bị cắt giữa chừng, ghi chú hợp lệ ở trang sau có thể
  // bị biến thành note mới và gửi ngược lên server.
  if (page.hasMore) throw new SyncFailure('Không thể tải trọn dữ liệu sau khi server đặt lại con trỏ. Dữ liệu trên thiết bị chưa bị thay đổi.', false)
  const seen = new Set(all.map(n => n.serverId))
  await db.transaction('rw', db.notes, db.meta, async () => {
    for (const remote of all) await applyRemote(remote)
    const orphans = await db.notes.filter(n => !!n.serverId && !seen.has(n.serverId) && (n.synced === 1 || n.baseVersion != null)).toArray()
    for (const note of orphans) await db.notes.update(note.id!, { synced: 0, baseVersion: null, conflict: null })
    await db.meta.put({ key: SYNC_CURSOR_KEY, value: page.cursor })
  })
}

async function exchange() {
  // Chặn gửi sang API khác phiên bản giao thức (tránh ghi đè sai cách).
  const protocol = await request(`${API_URL}/protocol`)
  if (protocol?.version !== SYNC_VERSION) throw new SyncFailure('Phiên bản backend và ứng dụng không khớp. Khởi động lại backend mới nhất rồi tải lại trang.', false)
  // Lưu ID trước khi gửi: retry sau mất response vẫn dùng cùng một bản ghi.
  await db.transaction('rw', db.notes, async () => {
    const pending = await db.notes.where('synced').equals(0).toArray()
    for (const note of pending) {
      if (!note.serverId) await db.notes.update(note.id!, { serverId: crypto.randomUUID() })
    }
  })
  // Lần đầu trên thiết bị (mới đăng nhập, hoặc vừa nâng cấp từ v2): tải về
  // trước để biết phiên bản hiện tại trên server rồi mới gửi thay đổi local.
  if (await getCursor() === undefined) await pull()
  await push()
  await pull()
}

export function synchronize() {
  if (!running) {
    const work = (async () => {
      if (navigator.locks) await navigator.locks.request('pwa-notes-sync', exchange)
      else await exchange()
    })()
    running = work.finally(() => { running = undefined })
  }
  return running
}
