import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Note, type NoteInput } from '../db/database'

function normalizeInput(input: NoteInput): NoteInput {
  const title = input.title.trim()
  const content = input.content.trim()
  const tag = input.tag.trim() || 'chung'
  if (!title || title.length > 255 || content.length > 100000 || tag.length > 100) {
    throw new Error('Tiêu đề hoặc nội dung ghi chú không hợp lệ.')
  }
  return { title, content, tag }
}

async function changeNote(id: number, changes: (current: Note) => Partial<Note>) {
  await db.transaction('rw', db.notes, async () => {
    const current = await db.notes.get(id)
    if (!current) throw new Error('Không tìm thấy ghi chú.')
    await db.notes.put({
      ...current,
      ...changes(current),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
      synced: 0
    })
  })
}

export function useNotes() {
  const result = useLiveQuery(async () => {
    try {
      const notes = await db.notes.orderBy('updatedAt').reverse().toArray()
      return { notes, error: '' }
    } catch {
      return { notes: [] as Note[], error: 'Không đọc được dữ liệu trên thiết bị. Hãy thử tải lại trang.' }
    }
  }, [])

  async function addNote(input: NoteInput) {
    await db.notes.add({
      ...normalizeInput(input),
      done: false,
      updatedAt: Date.now(),
      synced: 0,
      deleted: 0
    })
  }

  async function updateNote(id: number, input: NoteInput) {
    const changes = normalizeInput(input)
    await changeNote(id, () => changes)
  }

  async function toggleDone(id: number) {
    await changeNote(id, current => ({ done: !current.done }))
  }

  // Xóa mềm giữ lại bản ghi để có thể khôi phục và đồng bộ ở các tuần sau.
  async function deleteNote(id: number) {
    await changeNote(id, () => ({ deleted: 1 }))
  }

  async function restoreNote(id: number) {
    await changeNote(id, () => ({ deleted: 0 }))
  }

  return {
    notes: result?.notes ?? [],
    loading: result === undefined,
    error: result?.error ?? '',
    addNote,
    updateNote,
    toggleDone,
    deleteNote,
    restoreNote
  }
}
