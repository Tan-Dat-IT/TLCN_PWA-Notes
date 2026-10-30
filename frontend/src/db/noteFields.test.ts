import { describe, it, expect } from 'vitest'
import { validTime, validSchedule, isCompletedLate, isOverdue, taskDisplayStatus, toDateInput, fromDateInput } from './noteFields'
import type { Note } from './database'

function task(overrides: Partial<Note> = {}): Note {
  return {
    id: 1, serverId: 's1', kind: 'task', createdAt: 0, startAt: null, dueAt: null,
    completedAt: null, deletedAt: null, title: 't', content: '', tag: 'chung',
    done: false, updatedAt: 0, synced: 1, deleted: 0, ...overrides
  }
}

describe('validTime', () => {
  it('chấp nhận null và số nguyên an toàn không âm', () => {
    expect(validTime(null)).toBe(true)
    expect(validTime(0)).toBe(true)
    expect(validTime(8640000000000000)).toBe(true)
  })
  it('từ chối số âm, số thập phân hoặc vượt giới hạn', () => {
    expect(validTime(-1)).toBe(false)
    expect(validTime(1.5)).toBe(false)
    expect(validTime(8640000000000001)).toBe(false)
    expect(validTime('123')).toBe(false)
  })
})

describe('validSchedule', () => {
  it('chấp nhận khi không có startAt/dueAt', () => {
    expect(validSchedule({ kind: 'note', startAt: null, dueAt: null })).toBe(true)
  })
  it('từ chối khi dueAt trước startAt', () => {
    expect(validSchedule({ kind: 'task', startAt: 2000, dueAt: 1000 })).toBe(false)
  })
  it('chấp nhận khi dueAt bằng hoặc sau startAt', () => {
    expect(validSchedule({ kind: 'task', startAt: 1000, dueAt: 1000 })).toBe(true)
    expect(validSchedule({ kind: 'task', startAt: 1000, dueAt: 2000 })).toBe(true)
  })
  it('từ chối kind không hợp lệ', () => {
    // @ts-expect-error kiểm tra giá trị runtime sai kiểu
    expect(validSchedule({ kind: 'other', startAt: null, dueAt: null })).toBe(false)
  })
})

describe('isOverdue', () => {
  const now = 10000
  it('chỉ true cho task chưa hoàn thành, chưa xóa, có dueAt đã qua', () => {
    expect(isOverdue(task({ dueAt: 9999 }), now)).toBe(true)
  })
  it('false nếu là note', () => {
    expect(isOverdue(task({ kind: 'note', dueAt: 9999, done: false }), now)).toBe(false)
  })
  it('false nếu đã hoàn thành', () => {
    expect(isOverdue(task({ dueAt: 9999, done: true }), now)).toBe(false)
    expect(isCompletedLate(task({ dueAt: 9999, done: true, completedAt: 10001 }))).toBe(true)
    expect(isCompletedLate(task({ dueAt: 9999, done: true, completedAt: 9999 }))).toBe(false)
    expect(isCompletedLate(task({ dueAt: 9999, done: false, completedAt: null }))).toBe(false)
  })
  it('false nếu đã xóa', () => {
    expect(isOverdue(task({ dueAt: 9999, deleted: 1 }), now)).toBe(false)
  })
  it('false nếu chưa tới hạn', () => {
    expect(isOverdue(task({ dueAt: 10001 }), now)).toBe(false)
  })
  it('false nếu không có dueAt', () => {
    expect(isOverdue(task({ dueAt: null }), now)).toBe(false)
  })
})

describe('taskDisplayStatus', () => {
  const now = 10000
  it('trả đúng bốn nhãn trạng thái loại trừ nhau', () => {
    expect(taskDisplayStatus(task({ dueAt: 10001 }), now)).toBe('in_progress')
    expect(taskDisplayStatus(task({ dueAt: 9999 }), now)).toBe('overdue')
    expect(taskDisplayStatus(task({ dueAt: 10001, done: true, completedAt: 10000 }), now)).toBe('completed')
    expect(taskDisplayStatus(task({ dueAt: 9999, done: true, completedAt: 10000 }), now)).toBe('completed_late')
  })
})

describe('toDateInput / fromDateInput', () => {
  it('round-trip giữ nguyên epoch tới độ chính xác phút', () => {
    const original = new Date(2026, 5, 15, 14, 30, 0, 0).getTime()
    const input = toDateInput(original)
    expect(fromDateInput(input)).toBe(original)
  })
  it('trả chuỗi rỗng cho null và null cho chuỗi rỗng', () => {
    expect(toDateInput(null)).toBe('')
    expect(fromDateInput('')).toBe(null)
  })
})
