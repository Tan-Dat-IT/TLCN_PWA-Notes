import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validTime, validNote } from './validation.js'

function baseNote(overrides = {}) {
  return {
    id: 1, serverId: 'abc-123', title: 'Việc cần làm', content: 'nội dung',
    tag: 'chung', done: false, deleted: 0, updatedAt: 1000, kind: 'task',
    createdAt: 900, startAt: null, dueAt: null, completedAt: null, deletedAt: null, baseVersion: null,
    ...overrides
  }
}

test('validTime chấp nhận null và số nguyên an toàn trong khoảng hợp lệ', () => {
  assert.equal(validTime(null), true)
  assert.equal(validTime(0), true)
  assert.equal(validTime(8640000000000000), true)
  assert.equal(validTime(-1), false)
  assert.equal(validTime(8640000000000001), false)
  assert.equal(validTime(1.5), false)
  assert.equal(validTime('1000'), false)
})

test('validNote chấp nhận note hợp lệ tối thiểu', () => {
  assert.equal(validNote(baseNote()), true)
})

test('validNote từ chối id không phải số nguyên dương', () => {
  assert.equal(validNote(baseNote({ id: 0 })), false)
  assert.equal(validNote(baseNote({ id: -1 })), false)
  assert.equal(validNote(baseNote({ id: 1.5 })), false)
})

test('validNote từ chối tiêu đề rỗng hoặc chỉ khoảng trắng', () => {
  assert.equal(validNote(baseNote({ title: '' })), false)
  assert.equal(validNote(baseNote({ title: '   ' })), false)
})

test('validNote từ chối tiêu đề vượt quá 255 ký tự', () => {
  assert.equal(validNote(baseNote({ title: 'a'.repeat(256) })), false)
  assert.equal(validNote(baseNote({ title: 'a'.repeat(255) })), true)
})

test('validNote từ chối kind không hợp lệ', () => {
  assert.equal(validNote(baseNote({ kind: 'other' })), false)
})

test('validNote: ghi chú (kind=note) không được đánh dấu done', () => {
  assert.equal(validNote(baseNote({ kind: 'note', done: true })), false)
  assert.equal(validNote(baseNote({ kind: 'note', done: false })), true)
})

test('validNote: dueAt phải >= startAt khi cả hai đều có giá trị', () => {
  assert.equal(validNote(baseNote({ startAt: 2000, dueAt: 1000 })), false)
  assert.equal(validNote(baseNote({ startAt: 1000, dueAt: 2000 })), true)
  assert.equal(validNote(baseNote({ startAt: 1000, dueAt: 1000 })), true)
})

test('validNote: completedAt chỉ hợp lệ khi done=true', () => {
  assert.equal(validNote(baseNote({ kind: 'task', done: false, completedAt: 1000 })), false)
  assert.equal(validNote(baseNote({ kind: 'task', done: true, completedAt: 1000 })), true)
})

test('validNote: deletedAt chỉ hợp lệ khi deleted=1', () => {
  assert.equal(validNote(baseNote({ deleted: 0, deletedAt: 1000 })), false)
  assert.equal(validNote(baseNote({ deleted: 1, deletedAt: 1000 })), true)
})

test('validNote từ chối object thiếu trường hoặc null', () => {
  assert.equal(validNote(null), false)
  assert.equal(validNote(undefined), false)
  assert.equal(validNote({}), false)
})

test('validNote: baseVersion phải là null (ghi chú mới) hoặc số nguyên >= 1', () => {
  assert.equal(validNote(baseNote({ baseVersion: 1 })), true)
  assert.equal(validNote(baseNote({ baseVersion: 42 })), true)
  assert.equal(validNote(baseNote({ baseVersion: 0 })), false)
  assert.equal(validNote(baseNote({ baseVersion: 1.5 })), false)
  assert.equal(validNote(baseNote({ baseVersion: '1' })), false)
  assert.equal(validNote(baseNote({ baseVersion: undefined })), false) // client v2 cũ không gửi trường này
  assert.equal(validNote(baseNote({ baseVersion: 2147483648 })), false) // vượt INT của SQL Server
})
