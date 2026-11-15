import type { Note } from '../db/database'
import { getTaskStatus, isCompletedLate, isOverdue } from '../db/noteFields'

export interface StatsRange { startDate: string; endDate: string }
export type StatsPreset = 'week' | 'month'
export type StatsContentType = 'all' | 'note' | 'task'

function dateValue(date: Date) {
  return `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return year >= 1 && dateValue(date) === value ? date : null
}

export function getStatsRangeBounds(range: StatsRange) {
  const start = parseDate(range.startDate)
  const end = parseDate(range.endDate)
  if (!start || !end || start > end) return null
  const endExclusive = new Date(end)
  endExclusive.setDate(endExclusive.getDate() + 1)
  return { start, end, endExclusive }
}

export function getStatsPresetRange(preset: StatsPreset, now: number): StatsRange {
  const end = new Date(now)
  const start = new Date(end)
  if (preset === 'week') start.setDate(start.getDate() - 6)
  else {
    const lastDay = new Date(end.getFullYear(), end.getMonth(), 0).getDate()
    start.setDate(1)
    start.setMonth(start.getMonth() - 1)
    start.setDate(Math.min(end.getDate(), lastDay))
  }
  return { startDate: dateValue(start), endDate: dateValue(end) }
}

export function getStatsRangeUnit(range: StatsRange): 'day' | 'month' {
  const bounds = getStatsRangeBounds(range)
  if (!bounds) return 'day'
  // UTC chỉ dùng để đếm số ngày lịch, không bị lệch ở ngày đổi giờ mùa hè.
  const calendarDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return calendarDay(bounds.end) - calendarDay(bounds.start) < 62 * 86400000 ? 'day' : 'month'
}

export function formatStatsRange(range: StatsRange) {
  const bounds = getStatsRangeBounds(range)
  const format = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return bounds ? `${format.format(bounds.start)} – ${format.format(bounds.end)}` : ''
}

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

/** One definition for navigation badges, workspace progress and reports. */
export function buildWorkspaceSummary(notes: Note[], now: number) {
  const counts = { active: 0, todo: 0, doing: 0, done: 0, overdue: 0, pending: 0, conflict: 0, trash: 0 }
  let noteCount = 0
  let pendingNoteCount = 0
  for (const note of notes) {
    if (note.deleted === 1) counts.trash++
    else {
      counts.active++
      if (note.kind === 'note') noteCount++
      else {
        counts[getTaskStatus(note)!]++
        if (isOverdue(note, now)) counts.overdue++
      }
    }
    // Deletions still need to reach the server; conflicts require a choice first.
    if (note.synced === 0 && !note.conflict) {
      counts.pending++
      if (note.kind === 'note') pendingNoteCount++
    }
    if (note.conflict) counts.conflict++
  }
  const taskCount = counts.todo + counts.doing + counts.done
  return { counts, noteCount, pendingNoteCount, taskCount, completionRate: taskCount ? Math.round(counts.done / taskCount * 100) : 0 }
}

export type DeadlineFilter = 'all' | 'overdue' | 'week' | 'unscheduled'

export function matchesDeadline(note: Note, filter: DeadlineFilter, now: number) {
  if (filter === 'all') return true
  if (note.kind !== 'task' || note.deleted === 1) return false
  if (filter === 'overdue') return isOverdue(note, now)
  if (filter === 'unscheduled') return note.dueAt === null
  return getTaskStatus(note) !== 'done' && note.dueAt !== null && note.dueAt >= now && note.dueAt <= now + 7 * 86400000
}

export function buildTagDistribution(notes: Note[], contentType: StatsContentType) {
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (note.deleted === 1 || (contentType !== 'all' && note.kind !== contentType)) continue
    const tag = note.tag || 'chung'
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function groupTagDistribution(tags: { tag: string; count: number }[]) {
  if (tags.length <= 8) return tags
  return [...tags.slice(0, 7), { tag: 'Khác (các tag còn lại)', count: tags.slice(7).reduce((total, tag) => total + tag.count, 0) }]
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

function makeBuckets(range: StatsRange): StatsBucket[] {
  const bounds = getStatsRangeBounds(range)
  if (!bounds) return []
  const unit = getStatsRangeUnit(range)
  const buckets: StatsBucket[] = []
  const date = new Date(bounds.start)
  if (unit === 'month') date.setDate(1)
  while (date <= bounds.end) {
    buckets.push({
      key: unit === 'day' ? dayKey(date.getTime()) : monthKey(date.getTime()),
      label: unit === 'day'
        ? `${date.getDate()}/${date.getMonth() + 1}`
        : `${date.getMonth() + 1}/${date.getFullYear()}`,
      completed: 0,
      completedLate: 0,
      openOverdue: 0,
      notesCreated: 0,
      tasksCreated: 0
    })
    if (unit === 'day') date.setDate(date.getDate() + 1)
    else date.setMonth(date.getMonth() + 1)
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
    else if (getTaskStatus(note) !== 'done' && note.dueAt < now) openOverdue++
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
    if (getTaskStatus(note) === 'done') {
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
 * Khoảng ngày tùy chọn, gồm cả ngày đầu và ngày cuối theo giờ địa phương.
 * Khoảng dài hơn 62 ngày được nhóm theo tháng; vẫn lọc đúng hai biên ngày.
 * Việc hoàn thành được xếp theo completedAt; hai nhóm quá hạn theo dueAt.
 */
export function buildStatsSeries(notes: Note[], range: StatsRange | 'days14' | 'months6', now = Date.now(), contentType: StatsContentType = 'all'): StatsSeries {
  // Dashboard vẫn dùng chuỗi 14 ngày cố định; giữ nguyên các caller hiện có.
  let dates: StatsRange
  if (typeof range === 'string') {
    const end = new Date(now)
    const start = range === 'days14'
      ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 13)
      : new Date(end.getFullYear(), end.getMonth() - 5, 1)
    dates = { startDate: dateValue(start), endDate: dateValue(end) }
  } else dates = range
  const buckets = makeBuckets(dates)
  const bounds = getStatsRangeBounds(dates)
  const index = new Map(buckets.map((bucket, position) => [bucket.key, position]))
  const keyOf = getStatsRangeUnit(dates) === 'day' ? dayKey : monthKey
  const inRange = (time: number) => bounds !== null && time >= bounds.start.getTime() && time < bounds.endExclusive.getTime()

  for (const note of notes) {
    if (note.deleted === 1 || (contentType !== 'all' && note.kind !== contentType)) continue

    if (note.createdAt !== null && note.createdAt <= now && inRange(note.createdAt)) {
      const createdIndex = index.get(keyOf(note.createdAt))
      if (createdIndex !== undefined) {
        if (note.kind === 'note') buckets[createdIndex].notesCreated++
        else buckets[createdIndex].tasksCreated++
      }
    }

    if (note.kind !== 'task') continue

    if (getTaskStatus(note) === 'done' && note.completedAt !== null && note.completedAt <= now && inRange(note.completedAt)) {
      const completedIndex = index.get(keyOf(note.completedAt))
      if (completedIndex !== undefined) buckets[completedIndex].completed++
    }

    if (note.dueAt === null || !inRange(note.dueAt)) continue
    const completedLate = isCompletedLate(note)
    const isOpenOverdue = getTaskStatus(note) !== 'done' && note.dueAt < now
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
