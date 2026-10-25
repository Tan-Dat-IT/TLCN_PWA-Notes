import Dexie, { type Table } from 'dexie'

export interface Note {
  id?: number
  title: string
  content: string
  tag: string
  done: boolean
  updatedAt: number
  synced: 0 | 1
  deleted: 0 | 1
}

export type NoteInput = Pick<Note, 'title' | 'content' | 'tag'>

export class NotesDB extends Dexie {
  notes!: Table<Note, number>

  constructor() {
    // Tách dữ liệu của bản tuần 4 khỏi bản đầy đủ đang chạy trên cùng máy.
    super('PwaNotesWeek04')
    this.version(1).stores({
      // IndexedDB không đánh index boolean, nên synced và deleted dùng 0/1.
      notes: '++id, title, tag, updatedAt, synced, deleted'
    })
  }
}

export const db = new NotesDB()
