import Dexie, { type Table } from 'dexie'

// Note là đơn vị dữ liệu chính. `synced` đánh dấu note này đã được gửi
// lên server hay chưa - đây là cơ chế đơn giản để biết cái gì cần đồng bộ.
// `updatedAt` phục vụ hiển thị/thứ tự; xung đột được quyết định bằng Version.
export interface Note {
  id?: number
  serverId?: string // UUID được lưu trên client trước lần gửi đầu tiên
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
  // Dexie chỉ đánh index được các kiểu "IndexableType" (số, chuỗi...),
  // không đánh index trực tiếp trên boolean -> dùng 0/1 thay vì true/false.
  synced: 0 | 1
  deleted: 0 | 1 // xóa mềm để còn đồng bộ việc xóa lên server
  // Phiên bản trên server mà bản local này dựa vào (server tự tăng mỗi lần
  // ghi). null = ghi chú mới chưa từng lên server. undefined = dữ liệu tạo
  // trước giao thức v3, lần đồng bộ đầu tiên sẽ tự gán (xem sync.ts).
  baseVersion?: number | null
  // Bản đang có trên server khi server báo xung đột - còn giá trị này thì
  // ghi chú KHÔNG được gửi lên cho tới khi người dùng chọn cách xử lý.
  conflict?: ServerNote | null
}

// Ghi chú như server trả về (GET /api/notes, hoặc kèm kết quả conflict).
export type ServerNote = Omit<Note, 'id' | 'synced' | 'baseVersion' | 'conflict'> & { serverId: string; version: number }

export interface Meta { key: string; value: string }
// Con trỏ đồng bộ delta (RowVer lớn nhất đã tải về) - gắn với tài khoản đang
// đăng nhập nên phải xóa cùng ghi chú khi đổi tài khoản (clearLocalData).
export const SYNC_CURSOR_KEY = 'syncCursor'

export class NotesDB extends Dexie {
  notes!: Table<Note, number>
  meta!: Table<Meta, string>

  constructor() {
    super('NotesDB')
    this.version(1).stores({
      // ++id: khóa chính tự tăng. Các trường còn lại được đánh index để
      // truy vấn/lọc theo tag hoặc trạng thái đồng bộ nhanh hơn.
      notes: '++id, title, tag, updatedAt, synced, deleted' // giữ nguyên tên field, chỉ đổi kiểu giá trị
    })
    this.version(2).stores({
      notes: '++id, title, tag, updatedAt, synced, deleted, serverId'
    })
    this.version(3).stores({
      notes: '++id, tag, updatedAt, synced, deleted, serverId, kind, dueAt'
    }).upgrade(tx => tx.table('notes').toCollection().modify(note => {
      // Dữ liệu cũ từng dùng checkbox công việc; không đoán thời điểm lịch sử.
      note.kind = 'task'
      note.createdAt = null
      note.startAt = null
      note.dueAt = null
      note.completedAt = null
      note.deletedAt = null
    }))
    // Giao thức đồng bộ v3: thêm bảng meta giữ con trỏ delta. Không sửa
    // ghi chú cũ - thiếu baseVersion chính là dấu hiệu "dữ liệu trước v3".
    this.version(4).stores({
      notes: '++id, tag, updatedAt, synced, deleted, serverId, kind, dueAt',
      meta: 'key'
    })
  }
}

export const db = new NotesDB()

// Xóa toàn bộ dữ liệu cục bộ của tài khoản hiện tại (ghi chú + con trỏ đồng
// bộ) trong 1 giao dịch. Nếu chỉ xóa ghi chú mà giữ con trỏ, tài khoản đăng
// nhập kế tiếp sẽ chỉ tải "thay đổi sau con trỏ cũ" và thiếu gần hết dữ liệu.
export async function clearLocalData() {
  await db.transaction('rw', db.notes, db.meta, async () => {
    await db.notes.clear()
    await db.meta.clear()
  })
}
