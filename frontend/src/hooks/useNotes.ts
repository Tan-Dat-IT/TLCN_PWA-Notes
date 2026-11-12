import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Note, type TaskStatus } from '../db/database'
import { getTaskStatus, isTaskStatus, isOverdue, validSchedule, type NoteInput } from '../db/noteFields'
import { fromServer } from '../db/sync'
import { buildWorkspaceSummary } from '../lib/stats'

export type NoteView = 'active' | 'todo' | 'doing' | 'done' | 'overdue' | 'pending' | 'conflict' | 'trash'
export type NoteKindFilter = 'all' | Note['kind']
export type ConflictChoice = 'mine' | 'server' | 'both'
const COPY_SUFFIX = ' (bản sao xung đột)'
export function useNotes(filterTag: string | null, view: NoteView = 'active', kindFilter: NoteKindFilter = 'all') {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible) }
  }, [])
  const all = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), [])
  const matches = (n: Note, v: NoteView) => v === 'trash' ? n.deleted === 1
    : v === 'pending' ? n.synced === 0 && !n.conflict
    : v === 'conflict' ? !!n.conflict
    : v === 'overdue' ? isOverdue(n, now)
    : n.deleted === 0 && (v === 'active' || (n.kind === 'task' && getTaskStatus(n) === v))
  const selected = (all ?? []).filter(n => matches(n, view))
  // Loại nội dung được áp dụng trước tag để thanh tag chỉ đưa ra các lựa chọn
  // thực sự có kết quả trong Ghi chú/Công việc đang chọn.
  const selectedByKind = selected.filter(n => kindFilter === 'all' || n.kind === kindFilter)
  const notes = selectedByKind.filter(n => !filterTag || n.tag === filterTag)
  const allTags = Array.from(new Set(selectedByKind.map(n => n.tag))).sort()
  // Đếm một lượt thay vì lọc lại toàn bộ mảng cho từng view. Xung đột không
  // nằm trong "Chờ đồng bộ" vì nó cần người dùng chọn bản trước, không thể
  // tự động gửi như các pending note thông thường.
  const summary = buildWorkspaceSummary(all ?? [], now)
  const { counts } = summary

  function validateInput(input: NoteInput) {
    if (!input.title.trim() || input.title.length > 255 || input.content.length > 100000 || input.tag.length > 100 || !validSchedule(input) ||
        (input.status != null && !isTaskStatus(input.status))) {
      throw new Error('Tiêu đề hoặc thời gian không hợp lệ')
    }
  }

  async function addNote(input: NoteInput) {
    validateInput(input)
    const timestamp = Date.now()
    const status = input.kind === 'task' ? input.status ?? 'todo' : null
    await db.notes.add({ ...input, tag: input.tag || 'chung', serverId: crypto.randomUUID(),
      status, createdAt: timestamp, completedAt: status === 'done' ? timestamp : null, deletedAt: null,
      done: status === 'done', updatedAt: timestamp, synced: 0, deleted: 0, baseVersion: null, conflict: null })
  }

  // Xử lý xung đột đồng bộ (server báo thiết bị khác đã sửa trước):
  //  - mine:   giữ bản trên thiết bị, ghi đè lên đúng phiên bản server vừa thấy
  //            (server lại đổi tiếp trong lúc đó thì sẽ báo xung đột lần nữa).
  //  - server: bỏ thay đổi trên thiết bị, dùng bản trên server.
  //  - both:   ghi chú này nhận bản server, nội dung trên thiết bị được tách
  //            thành 1 ghi chú MỚI (ServerId mới) - không mất bên nào.
  async function resolveConflict(id: number, choice: ConflictChoice) {
    await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(id)
      const server = current?.conflict
      if (!current || !server) return
      const timestamp = Date.now()
      if (choice === 'mine') {
        await db.notes.put({ ...current, conflict: null, baseVersion: server.version, synced: 0,
          updatedAt: Math.max(timestamp, current.updatedAt + 1, server.updatedAt + 1) })
        return
      }
      await db.notes.put({ ...current, ...fromServer(server) })
      if (choice === 'both') {
        const { id: _id, conflict: _conflict, ...mine } = current
        await db.notes.add({ ...mine, serverId: crypto.randomUUID(), baseVersion: null, conflict: null, synced: 0,
          title: current.title.slice(0, 255 - COPY_SUFFIX.length) + COPY_SUFFIX,
          createdAt: timestamp, updatedAt: timestamp })
      }
    })
  }

  async function updateNote(id: number, changes: Partial<NoteInput & Pick<Note, 'done' | 'deleted'>>) {
    await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(id)
      if (!current) throw new Error('Không tìm thấy ghi chú')
      const next = { ...current, ...changes }
      validateInput(next)
      const timestamp = Date.now()
      if (next.kind === 'note') next.status = null
      else if (changes.status !== undefined && changes.status !== null) next.status = changes.status
      else if (changes.done !== undefined) next.status = changes.done ? 'done' : 'todo'
      else next.status = current.kind === 'task' ? getTaskStatus(current) : 'todo'
      next.done = next.status === 'done'
      if (next.done !== (getTaskStatus(current) === 'done')) next.completedAt = next.done ? timestamp : null
      if (!next.done) next.completedAt = null
      if (next.deleted !== current.deleted) next.deletedAt = next.deleted ? timestamp : null
      await db.notes.put({ ...next, tag: next.tag || 'chung', updatedAt: Math.max(timestamp, current.updatedAt + 1), synced: 0 })
    })
  }

  async function toggleDone(note: Note) {
    if (note.id == null) return
    await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(note.id!)
      if (current?.kind === 'task' && !current.deleted) await updateNote(note.id!, { done: getTaskStatus(current) !== 'done' })
    })
  }

  async function moveTask(id: number, status: TaskStatus) {
    if (!isTaskStatus(status)) throw new Error('Trạng thái công việc không hợp lệ')
    await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(id)
      if (!current || current.kind !== 'task' || current.deleted) throw new Error('Không tìm thấy công việc đang hoạt động')
      if (getTaskStatus(current) === status) return
      await updateNote(id, { status })
    })
  }

  async function deleteNote(id: number) { await updateNote(id, { deleted: 1 }) }
  async function restoreNote(id: number) { await updateNote(id, { deleted: 0 }) }
  return { notes, allNotes: all ?? [], isLoading: all === undefined, allTags, counts, summary, now, addNote, updateNote, moveTask, toggleDone, deleteNote, restoreNote, resolveConflict }
}
