import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlan, fallbackEstimate, simulate } from './planner.js'

const NOW = Date.parse('2026-09-28T08:00:00.000Z')

function task(serverId, title, options = {}) {
  return {
    serverId, title, content: options.content || '', tag: options.tag || 'công việc',
    kind: 'task', done: false, deleted: 0, startAt: options.startAt ?? null,
    dueAt: options.dueAt ?? null, updatedAt: NOW
  }
}

test('fallbackEstimate ưu tiên việc quá hạn và giữ ước lượng trong biên', () => {
  const result = fallbackEstimate(task('a', 'Nộp báo cáo', { dueAt: NOW - 1 }), NOW)
  assert.equal(result.priority, 5)
  assert.equal(result.estimatedMinutes % 15, 0)
  assert.match(result.reason, /quá hạn/)
})

test('simulate phân bổ không vượt năng lực và cảnh báo phần ngoài kỳ', () => {
  const tasks = [task('a', 'Việc gấp', { dueAt: NOW + 86400000 }), task('b', 'Việc dài')]
  const result = simulate(tasks, [
    { serverId: 'a', estimatedMinutes: 90, priority: 1, reason: 'AI đánh giá thấp' },
    { serverId: 'b', estimatedMinutes: 240, priority: 2, reason: 'Dài' }
  ], { dailyCapacityMinutes: 120, horizonDays: 2, timezoneOffsetMinutes: 0, now: NOW })
  assert.equal(result.days.every(day => day.usedMinutes <= 120), true)
  assert.equal(result.tasks.find(item => item.serverId === 'a').scheduledMinutes, 90)
  assert.equal(result.tasks.find(item => item.serverId === 'a').priority, 5)
  assert.equal(result.unscheduledTasks, 1)
  assert.equal(result.projectedFinishDate, null)
  assert.equal(result.totalEstimatedMinutes, 330)
})

test('simulate tôn trọng ngày bắt đầu và đánh dấu trễ hạn theo ngày', () => {
  const startAt = NOW + 2 * 86400000
  const dueAt = NOW + 86400000
  const result = simulate([task('a', 'Bắt đầu muộn', { startAt, dueAt })], [
    { serverId: 'a', estimatedMinutes: 30, priority: 4, reason: 'Có lịch' }
  ], { dailyCapacityMinutes: 60, horizonDays: 4, timezoneOffsetMinutes: 0, now: NOW })
  assert.equal(result.days[0].usedMinutes, 0)
  assert.equal(result.days[1].usedMinutes, 0)
  assert.equal(result.tasks[0].projectedFinishDate, '2026-09-30')
  assert.equal(result.tasks[0].status, 'at_risk')
})

test('createPlan dùng AI để ước lượng, giữ userId và trả ba kịch bản', async () => {
  const originalFetch = globalThis.fetch
  let receivedUserId
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { response: JSON.stringify({ tasks: [{ serverId: 'a', estimatedMinutes: 75, priority: 4, reason: 'Cần tập trung' }] }) }
    }
  })
  try {
    const result = await createPlan({
      store: { async getPlanningTasks(userId) { receivedUserId = userId; return [task('a', 'Làm slide')] } },
      userId: 9, dailyCapacityMinutes: 120, horizonDays: 7, timezoneOffsetMinutes: 0, now: NOW
    })
    assert.equal(receivedUserId, 9)
    assert.equal(result.aiUsed, true)
    assert.equal(result.tasks[0].estimatedMinutes, 75)
    assert.deepEqual(result.scenarios.map(item => item.key), ['reduced', 'base', 'increased'])
  } finally { globalThis.fetch = originalFetch }
})

test('createPlan dùng ước lượng dự phòng khi Ollama không kết nối', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline') }
  try {
    const result = await createPlan({
      store: { async getPlanningTasks() { return [task('a', 'Làm báo cáo')] } },
      userId: 1, dailyCapacityMinutes: 120, horizonDays: 7, timezoneOffsetMinutes: 0, now: NOW
    })
    assert.equal(result.aiUsed, false)
    assert.match(result.warning, /Không kết nối/)
    assert.equal(result.tasks.length, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('createPlan không gọi Ollama khi không có công việc đang mở', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('unexpected') }
  try {
    const result = await createPlan({
      store: { async getPlanningTasks() { return [] } },
      userId: 1, dailyCapacityMinutes: 120, horizonDays: 7, timezoneOffsetMinutes: 0, now: NOW
    })
    assert.equal(called, false)
    assert.equal(result.sourceTaskCount, 0)
    assert.deepEqual(result.scenarios, [])
  } finally { globalThis.fetch = originalFetch }
})
