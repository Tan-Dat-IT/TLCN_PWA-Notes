import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Note, type NoteInput } from '../db/database'
import { isOverdue, validSchedule } from '../db/noteFields'

export type NoteView = 'active' | 'todo' | 'done' | 'overdue' | 'trash'
export type NoteKindFilter = 'all' | Note['kind']
const NOTE_VIEWS: NoteView[] = ['active', 'todo', 'done', 'overdue', 'trash']

function normalizeInput(input: NoteInput): NoteInput {
  const title = input.title.trim()
  const content = input.content.trim()
  const tag = input.tag.trim() || 'chung'
  if (!title || title.length > 255 || content.length > 100000 || tag.length > 100 || !validSchedule(input)) {
    throw new Error('Tiêu đề, nội dung hoặc thời gian không hợp lệ.')
  }
  return { ...input, title, content, tag }
}

export function useNotes(filterTag: string | null = null, view: NoteView = 'active', kindFilter: NoteKindFilter = 'all') {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])

  const result = useLiveQuery(async () => {
    try {
      const notes = await db.notes.orderBy('updatedAt').reverse().toArray()
      return { notes, error: '' }
    } catch {
      return { notes: [] as Note[], error: 'Không đọc được dữ liệu trên thiết bị. Hãy thử tải lại trang.' }
    }
  }, [])
  const all = result?.notes ?? []
  const matches = (n: Note, v: NoteView) => v === 'trash' ? n.deleted === 1
    : v === 'overdue' ? isOverdue(n, now)
    : n.deleted === 0 && (v === 'active' || (n.kind === 'task' && (v === 'done' ? n.done : !n.done && !isOverdue(n, now))))
  const selectedByKind = all.filter(n => matches(n, view) && (kindFilter === 'all' || n.kind === kindFilter))
  const notes = selectedByKind.filter(n => !filterTag || n.tag === filterTag)
  const allTags = Array.from(new Set(selectedByKind.map(n => n.tag))).sort()
  const counts = Object.fromEntries(NOTE_VIEWS.map(v => [v, 0])) as Record<NoteView, number>
  for (const note of all) {
    if (note.deleted === 1) counts.trash++
    else {
      counts.active++
      if (note.kind === 'task') {
        if (note.done) counts.done++
        else if (isOverdue(note, now)) counts.overdue++
        else counts.todo++
      }
    }
  }

  async function addNote(input: NoteInput) {
    const timestamp = Date.now()
    await db.notes.add({
      ...normalizeInput(input), createdAt: timestamp, completedAt: null, deletedAt: null,
      done: false, updatedAt: timestamp, synced: 0, deleted: 0
    })
  }

  async function updateNote(id: number, changes: Partial<NoteInput & Pick<Note, 'done' | 'deleted'>>) {
    await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(id)
      if (!current) throw new Error('Không tìm thấy ghi chú.')
      const next = { ...current, ...changes, ...normalizeInput({ ...current, ...changes }) }
      const timestamp = Date.now()
      if (next.kind === 'note') next.done = false
      if (next.done !== current.done) next.completedAt = next.done ? timestamp : null
      if (next.deleted !== current.deleted) next.deletedAt = next.deleted ? timestamp : null
      await db.notes.put({ ...next, updatedAt: Math.max(timestamp, current.updatedAt + 1), synced: 0 })
    })
  }

  async function toggleDone(id: number) {
    await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(id)
      if (current?.kind === 'task' && !current.deleted) await updateNote(id, { done: !current.done })
    })
  }
  async function deleteNote(id: number) { await updateNote(id, { deleted: 1 }) }
  async function restoreNote(id: number) { await updateNote(id, { deleted: 0 }) }
  return {
    notes, allTags, counts, now, loading: result === undefined, error: result?.error ?? '',
    addNote, updateNote, toggleDone, deleteNote, restoreNote
  }
}
