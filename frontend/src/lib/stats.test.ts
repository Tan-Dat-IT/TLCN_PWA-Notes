import { describe, expect, it } from 'vitest'
import type { Note } from '../db/database'
import { buildOverdueReport, buildStatsSeries, buildTaskStatusReport } from './stats'

const now = new Date(2026, 8, 30, 12).getTime()

function task(changes: Partial<Note> = {}): Note {
  return {
    kind: 'task', createdAt: now, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
    title: 'Việc', content: '', tag: 'chung', done: false, updatedAt: now,
    synced: 1, deleted: 0, ...changes
  }
}

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
