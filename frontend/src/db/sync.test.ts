import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { validRemote, synchronize, type RemoteNote } from './sync'
import { db, clearLocalData, SYNC_CURSOR_KEY, type Note } from './database'
import { API_URL } from './api'
import { useNotes } from '../hooks/useNotes'

function remote(overrides: Partial<RemoteNote> = {}): RemoteNote {
  return {
    serverId: 's1', title: 't', content: '', tag: 'chung', kind: 'task',
    createdAt: null, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
    done: false, updatedAt: 0, deleted: 0, version: 1, ...overrides
  }
}

describe('validRemote', () => {
  it('chấp nhận note hợp lệ tối thiểu', () => {
    expect(validRemote(remote())).toBe(true)
  })
  it('từ chối khi serverId rỗng', () => {
    expect(validRemote(remote({ serverId: '' }))).toBe(false)
  })
  it('từ chối chuỗi vượt giới hạn backend hoặc tiêu đề chỉ có khoảng trắng', () => {
    expect(validRemote(remote({ serverId: 'x'.repeat(101) }))).toBe(false)
    expect(validRemote(remote({ title: ' '.repeat(10) }))).toBe(false)
    expect(validRemote(remote({ title: 'x'.repeat(256) }))).toBe(false)
    expect(validRemote(remote({ content: 'x'.repeat(100001) }))).toBe(false)
    expect(validRemote(remote({ tag: 'x'.repeat(101) }))).toBe(false)
  })
  it('từ chối note (kind=note) đã done', () => {
    expect(validRemote(remote({ kind: 'note', done: true }))).toBe(false)
  })
  it('từ chối completedAt khi done=false', () => {
    expect(validRemote(remote({ done: false, completedAt: 1000 }))).toBe(false)
  })
  it('chấp nhận completedAt khi done=true', () => {
    expect(validRemote(remote({ done: true, completedAt: 1000 }))).toBe(true)
  })
  it('từ chối deletedAt khi deleted=0', () => {
    expect(validRemote(remote({ deleted: 0, deletedAt: 1000 }))).toBe(false)
  })
  it('từ chối lịch không hợp lệ (dueAt trước startAt)', () => {
    expect(validRemote(remote({ startAt: 2000, dueAt: 1000 }))).toBe(false)
  })
  it('từ chối thiếu version hoặc version < 1 (backend cũ chưa migrate)', () => {
    expect(validRemote({ ...remote(), version: undefined } as unknown as RemoteNote)).toBe(false)
    expect(validRemote(remote({ version: 0 }))).toBe(false)
  })
})

// --- Server giả lập trong bộ nhớ, cùng quy tắc với backend/src/store.js ---
// (Version tăng mỗi lần ghi, conflict khi baseVersion lệch, idempotent khi
// nội dung trùng, rejected khi ServerId của tài khoản khác, delta theo seq.)
type Row = RemoteNote & { owner: number; seq: number }
const SAME_KEYS = ['title', 'content', 'tag', 'kind', 'done', 'deleted', 'startAt', 'dueAt'] as const

class FakeServer {
  rows = new Map<string, Row>()
  seq = 100
  requests: string[] = []
  beforeSyncResponse?: () => Promise<void>
  resetNext = false
  pageSize = 500

  // Thiết bị khác ghi trực tiếp lên server.
  write(note: Partial<RemoteNote> & { serverId: string }, owner = 1) {
    const prev = this.rows.get(note.serverId)
    const row = { ...remote(), ...prev, ...note, version: prev ? prev.version + 1 : 1, owner, seq: ++this.seq }
    this.rows.set(note.serverId, row)
    return row
  }
  view(row: Row): RemoteNote { const { owner: _o, seq: _s, ...n } = row; return n }

  upsert(n: Note & { baseVersion: number | null }) {
    const cur = this.rows.get(n.serverId!)
    const fields = { serverId: n.serverId!, title: n.title, content: n.content, tag: n.tag, kind: n.kind, done: n.done,
      deleted: n.deleted, updatedAt: n.updatedAt, createdAt: n.createdAt, startAt: n.startAt, dueAt: n.dueAt,
      completedAt: n.completedAt, deletedAt: n.deletedAt }
    if (!cur) { this.rows.set(n.serverId!, { ...fields, version: 1, owner: 1, seq: ++this.seq }); return { status: 'applied', version: 1 } }
    if (cur.owner !== 1) return { status: 'rejected' }
    if (n.baseVersion === cur.version) {
      this.rows.set(n.serverId!, { ...fields, createdAt: cur.createdAt ?? n.createdAt, version: cur.version + 1, owner: 1, seq: ++this.seq })
      return { status: 'applied', version: cur.version + 1 }
    }
    if (SAME_KEYS.every(k => cur[k] === n[k])) return { status: 'applied', version: cur.version }
    return { status: 'conflict', server: this.view(cur) }
  }

  async handle(url: string, init?: RequestInit) {
    this.requests.push(`${init?.method || 'GET'} ${url.replace(API_URL, '')}`)
    if (url === `${API_URL}/protocol`) return { version: 3 }
    if (url === `${API_URL}/sync`) {
      const { notes } = JSON.parse(String(init!.body))
      const results = notes.map((n: Note & { baseVersion: number | null }) => ({ localId: n.id, serverId: n.serverId, ...this.upsert(n) }))
      if (this.beforeSyncResponse) { const hook = this.beforeSyncResponse; this.beforeSyncResponse = undefined; await hook() }
      return { results, version: 3 }
    }
    let since = BigInt(new URL(url, 'http://x').searchParams.get('since') ?? '0')
    const reset = this.resetNext
    if (reset) { this.resetNext = false; since = 0n }
    const changed = [...this.rows.values()].filter(r => r.owner === 1 && BigInt(r.seq) > since).sort((a, b) => a.seq - b.seq)
    const page = changed.slice(0, this.pageSize)
    const cursor = page.length ? String(page[page.length - 1].seq) : (reset ? '0' : String(since))
    return { notes: page.map(r => this.view(r)), cursor, hasMore: changed.length > this.pageSize, reset }
  }
}

let server: FakeServer
beforeEach(async () => {
  await clearLocalData()
  server = new FakeServer()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = await server.handle(url, init)
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

async function addLocal(overrides: Partial<Note> = {}) {
  const id = await db.notes.add({ serverId: crypto.randomUUID(), title: 'Việc', content: '', tag: 'chung', kind: 'task',
    createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null, done: false,
    updatedAt: 1000, synced: 0, deleted: 0, baseVersion: null, conflict: null, ...overrides })
  return (await db.notes.get(id))!
}
async function edit(id: number, changes: Partial<Note>) {
  const cur = (await db.notes.get(id))!
  await db.notes.put({ ...cur, ...changes, updatedAt: cur.updatedAt + 1, synced: 0 })
}
const cursor = async () => (await db.meta.get(SYNC_CURSOR_KEY))?.value

describe('synchronize (giao thức v3)', () => {
  it('ghi chú mới: gửi lên, nhận Version 1, đánh dấu đã đồng bộ và lưu con trỏ', async () => {
    const note = await addLocal({ title: 'Mới' })
    await synchronize()
    const local = (await db.notes.get(note.id!))!
    expect(local).toMatchObject({ synced: 1, baseVersion: 1, conflict: null })
    expect(server.rows.get(note.serverId!)?.title).toBe('Mới')
    expect(await cursor()).toBe(String(server.seq))
  })

  it('lần đầu trên thiết bị tải về trước rồi mới gửi (để biết phiên bản server)', async () => {
    server.write({ serverId: 'a', title: 'Từ server' })
    await addLocal()
    await synchronize()
    const order = server.requests.filter(r => !r.endsWith('/protocol'))
    expect(order[0]).toMatch(/^GET \?since=0$/)
    expect(order[1]).toBe('POST /sync')
  })

  it('delta: lần sau chỉ tải thay đổi sau con trỏ, không tải lại toàn bộ', async () => {
    server.write({ serverId: 'a', title: 'A' })
    server.write({ serverId: 'b', title: 'B' })
    await synchronize()
    expect(await db.notes.count()).toBe(2)
    const before = await cursor()
    server.write({ serverId: 'b', title: 'B đã sửa' })
    const spy = vi.mocked(fetch)
    spy.mockClear(); server.requests = []
    await synchronize()
    expect(server.requests).toContain(`GET ?since=${before}`)
    expect((await db.notes.where('serverId').equals('b').first())?.title).toBe('B đã sửa')
    expect((await db.notes.where('serverId').equals('b').first())?.baseVersion).toBe(2)
  })

  it('delta nhiều trang: đi hết các trang theo hasMore', async () => {
    server.pageSize = 2
    for (let i = 0; i < 5; i++) server.write({ serverId: `p${i}`, title: `p${i}` })
    await synchronize()
    expect(await db.notes.count()).toBe(5)
    expect(server.requests.filter(r => r.startsWith('GET ?since')).length).toBeGreaterThanOrEqual(3)
  })

  it('XUNG ĐỘT: thiết bị khác sửa trước -> không ghi đè 2 phía, giữ bản server để so sánh', async () => {
    server.write({ serverId: 'x', title: 'Gốc' })
    await synchronize()
    const local = (await db.notes.where('serverId').equals('x').first())!
    server.write({ serverId: 'x', title: 'Máy khác sửa' }) // server lên v2
    await edit(local.id!, { title: 'Tôi sửa', updatedAt: 10 ** 12 }) // đồng hồ máy này chạy nhanh cũng không thắng
    await synchronize()
    const after = (await db.notes.get(local.id!))!
    expect(after.title).toBe('Tôi sửa')
    expect(after.synced).toBe(0)
    expect(after.conflict).toMatchObject({ title: 'Máy khác sửa', version: 2 })
    expect(server.rows.get('x')?.title).toBe('Máy khác sửa')
    // Ghi chú đang xung đột không bị gửi lại ở các lần đồng bộ sau
    server.requests = []
    await synchronize()
    expect(server.requests).not.toContain('POST /sync')
  })

  it('sửa trùng nội dung với server (vd. gửi lại sau mất phản hồi) không bị coi là xung đột', async () => {
    server.write({ serverId: 'x', title: 'Gốc' })
    await synchronize()
    const local = (await db.notes.where('serverId').equals('x').first())!
    server.write({ serverId: 'x', title: 'Giống nhau' })
    await edit(local.id!, { title: 'Giống nhau' })
    await synchronize()
    expect(await db.notes.get(local.id!)).toMatchObject({ synced: 1, baseVersion: 2, conflict: null })
  })

  it('người dùng sửa tiếp trong lúc đang gửi: vẫn chờ gửi và dựa trên version mới, lần sau không tự xung đột', async () => {
    const note = await addLocal({ title: 'v1' })
    server.beforeSyncResponse = async () => { await edit(note.id!, { title: 'v2 sửa trong lúc gửi' }) }
    await synchronize()
    expect(await db.notes.get(note.id!)).toMatchObject({ synced: 0, baseVersion: 1, title: 'v2 sửa trong lúc gửi' })
    await synchronize()
    expect(await db.notes.get(note.id!)).toMatchObject({ synced: 1, baseVersion: 2, conflict: null })
    expect(server.rows.get(note.serverId!)?.title).toBe('v2 sửa trong lúc gửi')
  })

  it('ghi chú mới đã lên server nhưng mất phản hồi, sau đó sửa tiếp: không tự xung đột với chính mình', async () => {
    await db.meta.put({ key: SYNC_CURSOR_KEY, value: '0' }) // thiết bị đã từng đồng bộ -> gửi trước, tải sau
    const note = await addLocal({ title: 'bản 1' })
    server.upsert({ ...note, baseVersion: null }) // server đã nhận nhưng client mất phản hồi
    await edit(note.id!, { title: 'bản 2' })
    await synchronize()
    // Lượt này: nhận version 1 làm gốc, vẫn chờ gửi, KHÔNG hiện xung đột
    expect(await db.notes.get(note.id!)).toMatchObject({ title: 'bản 2', synced: 0, baseVersion: 1, conflict: null })
    await synchronize() // useSync tự chạy lượt kế tiếp khi còn ghi chú chờ gửi
    expect(await db.notes.get(note.id!)).toMatchObject({ title: 'bản 2', synced: 1, baseVersion: 2, conflict: null })
    expect(server.rows.get(note.serverId!)?.title).toBe('bản 2')
  })

  it('ghi chú mới trùng ServerId đã bị thiết bị khác sửa (version >= 2) thì vẫn báo xung đột thật', async () => {
    await db.meta.put({ key: SYNC_CURSOR_KEY, value: '0' })
    const note = await addLocal({ title: 'bản 1' })
    server.upsert({ ...note, baseVersion: null })
    server.write({ serverId: note.serverId!, title: 'Thiết bị khác sửa' })
    await edit(note.id!, { title: 'bản 2' })
    await synchronize()
    expect((await db.notes.get(note.id!))!.conflict).toMatchObject({ title: 'Thiết bị khác sửa', version: 2 })
    expect(server.rows.get(note.serverId!)?.title).toBe('Thiết bị khác sửa')
  })

  it('ServerId trùng ghi chú của tài khoản khác (rejected): tự đổi ServerId rồi gửi lại được', async () => {
    const note = await addLocal({ title: 'Của tôi' })
    server.write({ serverId: note.serverId!, title: 'Của người khác' }, 2)
    await synchronize()
    const after = (await db.notes.get(note.id!))!
    expect(after.serverId).not.toBe(note.serverId)
    expect(after.synced).toBe(0)
    await synchronize()
    expect(await db.notes.get(note.id!)).toMatchObject({ synced: 1, baseVersion: 1 })
    expect(server.rows.get(note.serverId!)?.title).toBe('Của người khác')
  })

  it('dữ liệu cũ trước v3 (không có baseVersion) đang chờ gửi, server có bản mới hơn khác nội dung -> xung đột thay vì mất', async () => {
    server.write({ serverId: 'old', title: 'Server mới hơn', updatedAt: 5000 })
    await addLocal({ serverId: 'old', title: 'Local cũ hơn', updatedAt: 3000, baseVersion: undefined })
    await synchronize()
    const local = (await db.notes.where('serverId').equals('old').first())!
    expect(local.title).toBe('Local cũ hơn')
    expect(local.conflict).toMatchObject({ title: 'Server mới hơn' })
    expect(server.rows.get('old')?.title).toBe('Server mới hơn')
  })

  it('dữ liệu cũ trước v3 đang chờ gửi và mới hơn server -> gửi lên bình thường (như quy tắc cũ)', async () => {
    server.write({ serverId: 'old', title: 'Server cũ', updatedAt: 3000 })
    await addLocal({ serverId: 'old', title: 'Local mới hơn', updatedAt: 5000, baseVersion: undefined })
    await synchronize()
    expect((await db.notes.where('serverId').equals('old').first())).toMatchObject({ synced: 1, baseVersion: 2 })
    expect(server.rows.get('old')?.title).toBe('Local mới hơn')
  })

  it('server báo con trỏ không hợp lệ (DB khôi phục từ backup): ghi chú local không còn trên server được gửi lại', async () => {
    const note = await addLocal({ title: 'Chỉ còn ở thiết bị' })
    await synchronize()
    expect((await db.notes.get(note.id!))!.synced).toBe(1)
    server.rows.clear() // database bị khôi phục về bản chưa có ghi chú này
    server.resetNext = true
    await synchronize()
    expect(await db.notes.get(note.id!)).toMatchObject({ synced: 0, baseVersion: null })
    await synchronize()
    expect(await db.notes.get(note.id!)).toMatchObject({ synced: 1, baseVersion: 1 })
    expect(server.rows.get(note.serverId!)?.title).toBe('Chỉ còn ở thiết bị')
  })

  it('clearLocalData xóa cả con trỏ (đổi tài khoản phải tải lại toàn bộ)', async () => {
    server.write({ serverId: 'a' })
    await synchronize()
    expect(await cursor()).toBeDefined()
    await clearLocalData()
    expect(await cursor()).toBeUndefined()
    expect(await db.notes.count()).toBe(0)
  })

  it('từ chối backend khác phiên bản giao thức', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ version: 2 }) })))
    await expect(synchronize()).rejects.toThrow(/không khớp/)
  })

  it('dừng khi server báo còn trang nhưng con trỏ không tiến lên', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = url.endsWith('/protocol')
        ? { version: 3 }
        : { notes: [], cursor: '0', hasMore: true, reset: false }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    await expect(synchronize()).rejects.toThrow(/con trỏ không tiến lên/)
  })
})

describe('resolveConflict (useNotes)', () => {
  async function makeConflict() {
    server.write({ serverId: 'x', title: 'Gốc', content: 'chung' })
    await synchronize()
    const local = (await db.notes.where('serverId').equals('x').first())!
    server.write({ serverId: 'x', title: 'Bản server' })
    await edit(local.id!, { title: 'Bản của tôi' })
    await synchronize()
    expect((await db.notes.get(local.id!))!.conflict).toBeTruthy()
    return local.id!
  }

  it('Giữ bản của tôi: ghi đè lên đúng phiên bản server đã thấy', async () => {
    const id = await makeConflict()
    const { result } = renderHook(() => useNotes(null, 'conflict'))
    await act(async () => { await result.current.resolveConflict(id, 'mine') })
    await synchronize()
    expect(await db.notes.get(id)).toMatchObject({ title: 'Bản của tôi', synced: 1, baseVersion: 3, conflict: null })
    expect(server.rows.get('x')?.title).toBe('Bản của tôi')
  })

  it('Giữ bản của tôi nhưng server lại đổi tiếp -> báo xung đột lần nữa, không ghi đè', async () => {
    const id = await makeConflict()
    const { result } = renderHook(() => useNotes(null, 'conflict'))
    await act(async () => { await result.current.resolveConflict(id, 'mine') })
    server.write({ serverId: 'x', title: 'Server đổi tiếp' })
    await synchronize()
    expect((await db.notes.get(id))!.conflict).toMatchObject({ title: 'Server đổi tiếp', version: 3 })
    expect(server.rows.get('x')?.title).toBe('Server đổi tiếp')
  })

  it('Dùng bản trên server: bỏ thay đổi local, không gửi gì lên', async () => {
    const id = await makeConflict()
    const { result } = renderHook(() => useNotes(null, 'conflict'))
    await act(async () => { await result.current.resolveConflict(id, 'server') })
    expect(await db.notes.get(id)).toMatchObject({ title: 'Bản server', synced: 1, baseVersion: 2, conflict: null })
    server.requests = []
    await synchronize()
    expect(server.requests).not.toContain('POST /sync')
  })

  it('Giữ cả hai: ghi chú gốc nhận bản server, bản của tôi thành ghi chú mới được gửi lên', async () => {
    const id = await makeConflict()
    const { result } = renderHook(() => useNotes(null, 'conflict'))
    await act(async () => { await result.current.resolveConflict(id, 'both') })
    await synchronize()
    expect(await db.notes.get(id)).toMatchObject({ title: 'Bản server', synced: 1, conflict: null })
    const copy = (await db.notes.toArray()).find(n => n.id !== id)!
    expect(copy).toMatchObject({ title: 'Bản của tôi (bản sao xung đột)', synced: 1, baseVersion: 1, conflict: null })
    expect(copy.serverId).not.toBe('x')
    expect(server.rows.get(copy.serverId!)?.title).toBe('Bản của tôi (bản sao xung đột)')
  })

  it('Giữ cả hai với tiêu đề 255 ký tự: bản sao vẫn không vượt giới hạn', async () => {
    const id = await makeConflict()
    await db.notes.update(id, { title: 'a'.repeat(255) })
    const { result } = renderHook(() => useNotes(null, 'conflict'))
    await act(async () => { await result.current.resolveConflict(id, 'both') })
    const copy = (await db.notes.toArray()).find(n => n.id !== id)!
    expect(copy.title.length).toBeLessThanOrEqual(255)
    expect(copy.title.endsWith('(bản sao xung đột)')).toBe(true)
  })

  it('đếm mục Xung đột đồng bộ', async () => {
    await makeConflict()
    const { result } = renderHook(() => useNotes(null, 'conflict'))
    await vi.waitFor(() => expect(result.current.counts.conflict).toBe(1))
    expect(result.current.notes).toHaveLength(1)
  })
})
