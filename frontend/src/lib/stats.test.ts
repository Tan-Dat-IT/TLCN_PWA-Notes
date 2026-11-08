import { describe, expect, it } from 'vitest'
import type { Note } from '../db/database'
import { buildOverdueReport, buildStatsSeries, buildTaskStatusReport, buildWorkspaceSummary, matchesDeadline, buildTagDistribution, groupTagDistribution } from './stats'

const now = new Date(2026, 8, 30, 12).getTime()

function task(changes: Partial<Note> = {}): Note {
  return {
    kind: 'task', createdAt: now, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
    title: 'Việc', content: '', tag: 'chung', done: false, updatedAt: now,
    synced: 1, deleted: 0, ...changes
  }
}

describe('shared workspace metrics', () => {
  it('uses workflow status, excludes deleted content and includes pending deletions without counting conflicts twice', () => {
    const server = { ...task(), serverId: 'conflict', version: 2 }
    const notes = [task({ status: 'doing', dueAt: now - 1 }), task({ status: 'done', done: false, completedAt: null }), task({ deleted: 1, synced: 0 }), task({ kind: 'note', status: null }), task({ conflict: server, synced: 0 })]
    const summary = buildWorkspaceSummary(notes, now)
    expect(summary).toMatchObject({ taskCount: 3, noteCount: 1, completionRate: 33, counts: { active: 4, todo: 1, doing: 1, done: 1, overdue: 1, pending: 1, conflict: 1, trash: 1 } })
    const report = buildTaskStatusReport(notes, now)
    expect(report.total).toBe(summary.taskCount)
    expect(report.openOverdue).toBe(summary.counts.overdue)
    expect(report.completedOnTime + report.completedLate).toBe(summary.counts.done)
    expect(buildStatsSeries(notes, 'days14', now).completed).toBe(0)
  })
  it('returns a zero completion rate for an empty workspace', () => {
    expect(buildWorkspaceSummary([], now).completionRate).toBe(0)
  })
  it('includes unsynced note deletions in the note-specific pending count', () => {
    const summary = buildWorkspaceSummary([task({ kind: 'note', status: null, deleted: 1, synced: 0 })], now)
    expect(summary.noteCount).toBe(0)
    expect(summary.pendingNoteCount).toBe(1)
    expect(summary.counts.pending).toBe(1)
  })
  it('changes overdue at the deadline boundary and keeps the seven-day window inclusive', () => {
    const note = task({ dueAt: now })
    expect(matchesDeadline(note, 'overdue', now)).toBe(false)
    expect(matchesDeadline(note, 'overdue', now + 1)).toBe(true)
    expect(matchesDeadline(task({ dueAt: now + 7 * 86400000 }), 'week', now)).toBe(true)
    expect(matchesDeadline(task({ status: 'done', dueAt: now + 1 }), 'week', now)).toBe(false)
    expect(matchesDeadline(task({ kind: 'note', dueAt: now + 1 }), 'week', now)).toBe(false)
    expect(matchesDeadline(task({ deleted: 1, dueAt: now - 1 }), 'overdue', now)).toBe(false)
  })
  it('retains the full tag total when more than eight tags are present', () => {
    const tags = buildTagDistribution(Array.from({ length: 10 }, (_, i) => task({ tag: `tag-${i}` })), 'all')
    const grouped = groupTagDistribution(tags)
    expect(grouped).toHaveLength(8)
    expect(grouped[grouped.length - 1]).toEqual({ tag: 'Khác (các tag còn lại)', count: 3 })
    expect(grouped.reduce((sum, tag) => sum + tag.count, 0)).toBe(10)
  })
})

describe('buildOverdueReport', () => {
  it('phân biệt hoàn thành trễ và vẫn chưa hoàn thành', () => {
    const augustDue = new Date(2026, 7, 10).getTime()
    const septemberDue = new Date(2026, 8, 20).getTime()
    const report = buildOverdueReport([
      task({ dueAt: augustDue, done: true, completedAt: augustDue + 60_000 }),
      task({ dueAt: septemberDue }),
      task({ dueAt: augustDue, done: true, completedAt: augustDue - 60_000 }),
      task({ dueAt: septemberDue, deleted: 1 }),
      task({ kind: 'note', dueAt: septemberDue })
    ], now)
    const months = buildStatsSeries([
      task({ dueAt: augustDue, done: true, completedAt: augustDue + 60_000 }),
      task({ dueAt: septemberDue })
    ], 'months6', now)

    expect(report.completedLate).toBe(1)
    expect(report.openOverdue).toBe(1)
    expect(months.buckets.find(month => month.label === '8/2026')).toMatchObject({ completedLate: 1, openOverdue: 0 })
    expect(months.buckets.find(month => month.label === '9/2026')).toMatchObject({ completedLate: 0, openOverdue: 1 })
  })

  it('không xem việc hoàn thành đúng hạn là quá hạn khi dueAt đã qua', () => {
    const dueAt = now - 60_000
    const report = buildOverdueReport([task({ dueAt, done: true, completedAt: dueAt })], now)
    const series = buildStatsSeries([task({ dueAt, done: true, completedAt: dueAt })], 'days14', now)
    expect(report.completedLate).toBe(0)
    expect(report.openOverdue).toBe(0)
    expect(series.completed).toBe(1)
    expect(series.completedLate).toBe(0)
  })

  it('tạo đúng 14 cột ngày hoặc 6 cột tháng và loại deadline ngoài khoảng', () => {
    const oldDue = new Date(2025, 11, 1).getTime()
    const recentDue = new Date(2026, 8, 29, 8).getTime()
    const completedAt = new Date(2026, 8, 30, 9).getTime()
    const notes = [
      task({ dueAt: oldDue }),
      task({ dueAt: recentDue, done: true, completedAt }),
      task({ kind: 'note', title: 'Ghi chú mới' })
    ]
    const days = buildStatsSeries(notes, 'days14', now)
    const months = buildStatsSeries(notes, 'months6', now)
    const noteDays = buildStatsSeries(notes, 'days14', now, 'note')
    const taskDays = buildStatsSeries(notes, 'days14', now, 'task')

    expect(days.buckets).toHaveLength(14)
    expect(months.buckets).toHaveLength(6)
    expect(days).toMatchObject({ created: 3, completed: 1, completedLate: 1, openOverdue: 0 })
    expect(months).toMatchObject({ created: 3, completed: 1, completedLate: 1, openOverdue: 0 })
    expect(noteDays).toMatchObject({ created: 1, completed: 0, completedLate: 0, openOverdue: 0 })
    expect(taskDays).toMatchObject({ created: 2, completed: 1, completedLate: 1, openOverdue: 0 })
  })
})

describe('buildTaskStatusReport', () => {
  it('thống kê hoàn thành từ status và vẫn tách quá hạn khỏi công việc mở', () => {
    const notes = [
      task({ status: 'todo' }),
      task({ status: 'doing', dueAt: now - 60_000 }),
      task({ status: 'done', done: false, completedAt: now, dueAt: now + 60_000 })
    ]
    expect(buildTaskStatusReport(notes, now)).toEqual({ total: 3, inProgress: 1, openOverdue: 1, completedOnTime: 1, completedLate: 0 })
    expect(buildStatsSeries(notes, 'days14', now)).toMatchObject({ completed: 1, openOverdue: 1 })
  })
  it('phân mỗi công việc vào đúng một trạng thái và tổng luôn khớp', () => {
    const pastDue = now - 60_000
    const futureDue = now + 60_000
    const report = buildTaskStatusReport([
      task(),
      task({ dueAt: futureDue }),
      task({ dueAt: pastDue }),
      task({ dueAt: futureDue, done: true, completedAt: now }),
      task({ dueAt: pastDue, done: true, completedAt: now }),
      task({ done: true, completedAt: now }),
      task({ deleted: 1 }),
      task({ kind: 'note' })
    ], now)

    expect(report).toEqual({
      total: 6,
      inProgress: 2,
      openOverdue: 1,
      completedOnTime: 2,
      completedLate: 1
    })
    expect(report.inProgress + report.openOverdue + report.completedOnTime + report.completedLate).toBe(report.total)
  })
})
