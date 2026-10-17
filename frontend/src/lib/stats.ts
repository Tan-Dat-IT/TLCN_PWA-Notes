import type { Note } from '../db/database'
import { isCompletedLate } from '../db/noteFields'

export type StatsRange = 'days14' | 'months6'
export type StatsContentType = 'all' | 'note' | 'task'

export interface StatsBucket {
  key: string
  label: string
  completed: number
  completedLate: number
  openOverdue: number
  notesCreated: number
  tasksCreated: number
}

export interface OverdueReport {
  completedLate: number
  openOverdue: number
}

/**
 * Bốn trạng thái loại trừ nhau của công việc đang hoạt động. Tổng bốn trường
 * luôn bằng total, nhờ vậy giao diện không để lại một công việc "không rõ đang ở đâu".
 */
export interface TaskStatusReport extends OverdueReport {
  total: number
  inProgress: number
  completedOnTime: number
}

export interface StatsSeries extends OverdueReport {
  created: number
  completed: number
  buckets: StatsBucket[]
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function monthKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}`
}

function makeBuckets(range: StatsRange, now: number): StatsBucket[] {
  const reference = new Date(now)
  const buckets: StatsBucket[] = []
  const count = range === 'days14' ? 14 : 6

  for (let offset = count - 1; offset >= 0; offset--) {
    const date = range === 'days14'
      ? new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - offset)
      : new Date(reference.getFullYear(), reference.getMonth() - offset, 1)
    buckets.push({
      key: range === 'days14' ? dayKey(date.getTime()) : monthKey(date.getTime()),
      label: range === 'days14'
        ? `${date.getDate()}/${date.getMonth() + 1}`
        : `${date.getMonth() + 1}/${date.getFullYear()}`,
      completed: 0,
      completedLate: 0,
      openOverdue: 0,
      notesCreated: 0,
      tasksCreated: 0
    })
  }
  return buckets
}

/** Tổng quá hạn trên toàn bộ dữ liệu, dùng cho các thẻ tổng quan. */
export function buildOverdueReport(notes: Note[], now = Date.now()): OverdueReport {
  let completedLate = 0
  let openOverdue = 0
  for (const note of notes) {
    if (note.kind !== 'task' || note.deleted === 1 || note.dueAt === null) continue
    if (isCompletedLate(note)) completedLate++
    else if (!note.done && note.dueAt < now) openOverdue++
  }
  return { completedLate, openOverdue }
}

export function buildTaskStatusReport(notes: Note[], now = Date.now()): TaskStatusReport {
  const report: TaskStatusReport = {
    total: 0,
    inProgress: 0,
    openOverdue: 0,
    completedOnTime: 0,
    completedLate: 0
  }

  for (const note of notes) {
    if (note.kind !== 'task' || note.deleted === 1) continue
    report.total++
    if (note.done) {
      if (isCompletedLate(note)) report.completedLate++
      else report.completedOnTime++
    } else if (note.dueAt !== null && note.dueAt < now) {
      report.openOverdue++
    } else {
      report.inProgress++
    }
  }

  return report
}

/**
 * Chuỗi 14 ngày (mỗi cột là một ngày) hoặc 6 tháng (mỗi cột là một tháng).
 * Việc hoàn thành được xếp theo completedAt; hai nhóm quá hạn theo dueAt.
 */
export function buildStatsSeries(notes: Note[], range: StatsRange, now = Date.now(), contentType: StatsContentType = 'all'): StatsSeries {
  const buckets = makeBuckets(range, now)
  const index = new Map(buckets.map((bucket, position) => [bucket.key, position]))
  const keyOf = range === 'days14' ? dayKey : monthKey

  for (const note of notes) {
    if (note.deleted === 1 || (contentType !== 'all' && note.kind !== contentType)) continue

    if (note.createdAt !== null && note.createdAt <= now) {
      const createdIndex = index.get(keyOf(note.createdAt))
      if (createdIndex !== undefined) {
        if (note.kind === 'note') buckets[createdIndex].notesCreated++
        else buckets[createdIndex].tasksCreated++
      }
    }

    if (note.kind !== 'task') continue

    if (note.done && note.completedAt !== null && note.completedAt <= now) {
      const completedIndex = index.get(keyOf(note.completedAt))
      if (completedIndex !== undefined) buckets[completedIndex].completed++
    }

    if (note.dueAt === null) continue
    const completedLate = isCompletedLate(note)
    const isOpenOverdue = !note.done && note.dueAt < now
    if (!completedLate && !isOpenOverdue) continue

    const overdueIndex = index.get(keyOf(note.dueAt))
    if (overdueIndex === undefined) continue
    if (completedLate) buckets[overdueIndex].completedLate++
    else buckets[overdueIndex].openOverdue++
  }

  return buckets.reduce<StatsSeries>((report, bucket) => {
    report.created += bucket.notesCreated + bucket.tasksCreated
    report.completed += bucket.completed
    report.completedLate += bucket.completedLate
    report.openOverdue += bucket.openOverdue
    return report
  }, { created: 0, completed: 0, completedLate: 0, openOverdue: 0, buckets })
}
