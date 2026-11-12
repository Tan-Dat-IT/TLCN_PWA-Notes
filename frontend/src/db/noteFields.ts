import type { Note, TaskStatus } from './database'

export type NoteInput = Pick<Note, 'title' | 'content' | 'tag' | 'kind' | 'startAt' | 'dueAt' | 'status'>
type TaskStatusFields = Pick<Note, 'kind' | 'status' | 'done' | 'deleted' | 'dueAt' | 'completedAt'>
export const TASK_WORKFLOW_LABELS: Record<TaskStatus, string> = {
  todo: 'Cần làm', doing: 'Đang làm', done: 'Hoàn thành'
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'todo' || value === 'doing' || value === 'done'
}

export function getTaskStatus(note: Pick<Note, 'kind' | 'status' | 'done'>): TaskStatus | null {
  if (note.kind !== 'task') return null
  return isTaskStatus(note.status) ? note.status : note.done ? 'done' : 'todo'
}
export type TaskDisplayStatus = 'in_progress' | 'overdue' | 'completed' | 'completed_late'

export const TASK_STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  in_progress: 'Đang thực hiện',
  overdue: 'Đang quá hạn',
  completed: 'Đã hoàn thành (không trễ)',
  completed_late: 'Đã hoàn thành trễ'
}

export function validTime(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000)
}

export function validSchedule(note: Pick<Note, 'kind' | 'startAt' | 'dueAt'>) {
  return (note.kind === 'note' || note.kind === 'task') && validTime(note.startAt) && validTime(note.dueAt) &&
    (note.startAt === null || note.dueAt === null || note.dueAt >= note.startAt)
}

export function isOverdue(note: TaskStatusFields, now: number) {
  return note.kind === 'task' && getTaskStatus(note) !== 'done' && note.deleted === 0 && note.dueAt !== null && note.dueAt < now
}

// Trạng thái lịch sử: công việc đã xong nhưng thời điểm hoàn thành thực tế
// muộn hơn deadline. Khác với isOverdue: không phụ thuộc thời điểm hiện tại.
export function isCompletedLate(note: TaskStatusFields) {
  return note.kind === 'task' && getTaskStatus(note) === 'done' && note.dueAt !== null && note.completedAt !== null && note.completedAt > note.dueAt
}

/** Trạng thái hiển thị loại trừ nhau, chỉ dùng cho công việc chưa xóa. */
export function taskDisplayStatus(note: TaskStatusFields, now: number): TaskDisplayStatus {
  if (getTaskStatus(note) === 'done') return isCompletedLate(note) ? 'completed_late' : 'completed'
  return isOverdue(note, now) ? 'overdue' : 'in_progress'
}

export function formatTime(value: number | null) {
  return value === null ? 'Chưa có thông tin' : new Date(value).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

// datetime-local dùng giờ thiết bị; dữ liệu lưu là epoch để đồng bộ qua múi giờ.
export function toDateInput(value: number | null) {
  if (value === null) return ''
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromDateInput(value: string) {
  return value ? new Date(value).getTime() : null
}
