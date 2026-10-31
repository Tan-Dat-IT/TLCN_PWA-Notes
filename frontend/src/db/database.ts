import Dexie, { type Table } from 'dexie'

export interface Note {
  id?: number
  kind: 'note' | 'task'
  createdAt: number | null
  startAt: number | null
  dueAt: number | null
  completedAt: number | null
  deletedAt: number | null
  title: string
  content: string
  tag: string
  done: boolean
  updatedAt: number
  synced: 0 | 1
  deleted: 0 | 1
}

export type NoteInput = Pick<Note, 'title' | 'content' | 'tag' | 'kind' | 'startAt' | 'dueAt'>

export class NotesDB extends Dexie {
  notes!: Table<Note, number>

  constructor() {
    // Tách dữ liệu của bản tuần 4 khỏi bản đầy đủ đang chạy trên cùng máy.
    super('PwaNotesWeek04')
    this.version(1).stores({
      // IndexedDB không đánh index boolean, nên synced và deleted dùng 0/1.
      notes: '++id, title, tag, updatedAt, synced, deleted'
    })
    this.version(2).stores({
      notes: '++id, tag, updatedAt, synced, deleted, kind, dueAt'
    }).upgrade(tx => tx.table('notes').toCollection().modify(note => {
      // Dữ liệu cũ từng dùng checkbox công việc; không đoán thời điểm lịch sử.
      note.kind = 'task'
      note.createdAt = null
      note.startAt = null
      note.dueAt = null
      note.completedAt = null
      note.deletedAt = null
    }))
  }
}

export const db = new NotesDB()
