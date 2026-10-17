import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFailureTracker, createIpLimiter, LOGIN_POLICY } from './rateLimit.js'

function fakeReqRes({ ip = '127.0.0.1', username = 'demo' } = {}) {
  const req = { ip, body: { username } }
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  return { req, res }
}

test('LOGIN_POLICY mặc định: 5 lượt, chặn 15 phút', () => {
  assert.deepEqual(LOGIN_POLICY, { maxAttempts: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 })
})

test('failureTracker đếm tăng dần, đủ số lượt thì chặn tới now + lockMs', () => {
  const tracker = createFailureTracker({ maxAttempts: 3, windowMs: 60000, lockMs: 30000 })
  assert.deepEqual(tracker.fail('a', 1000), { count: 1, lockedUntil: null })
  assert.deepEqual(tracker.fail('a', 2000), { count: 2, lockedUntil: null })
  assert.deepEqual(tracker.fail('a', 3000), { count: 3, lockedUntil: 33000 })
  assert.equal(tracker.lockedUntil('a', 4000), 33000)
  assert.equal(tracker.lockedUntil('b', 4000), null) // tên khác không bị chặn lây
})

test('failureTracker: hết thời gian chặn thì tự mở và đếm lại từ 1', () => {
  const tracker = createFailureTracker({ maxAttempts: 2, windowMs: 60000, lockMs: 10000 })
  tracker.fail('a', 0)
  tracker.fail('a', 1)
  assert.equal(tracker.lockedUntil('a', 10002), null)
  assert.deepEqual(tracker.fail('a', 10002), { count: 1, lockedUntil: null })
})

test('failureTracker: lần sai trước đã quá cửa sổ thời gian thì đếm lại từ 1', () => {
  const tracker = createFailureTracker({ maxAttempts: 3, windowMs: 1000, lockMs: 10000 })
  tracker.fail('a', 0)
  tracker.fail('a', 500)
  assert.deepEqual(tracker.fail('a', 2000), { count: 1, lockedUntil: null })
})

test('ipLimiter chặn khi vượt số request cho phép trong cùng IP', () => {
  const limiter = createIpLimiter({ maxRequests: 2, windowMs: 60000 })
  for (let i = 0; i < 2; i++) {
    const { req, res } = fakeReqRes()
    let nextCalled = false
    limiter(req, res, () => { nextCalled = true })
    assert.equal(nextCalled, true)
  }
  const { req, res } = fakeReqRes()
  let nextCalled = false
  limiter(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 429)
})

test('ipLimiter không ảnh hưởng IP khác', () => {
  const limiter = createIpLimiter({ maxRequests: 1, windowMs: 60000 })
  const { req: req1, res: res1 } = fakeReqRes({ ip: '10.0.0.1' })
  limiter(req1, res1, () => {})
  const { req: req2, res: res2 } = fakeReqRes({ ip: '10.0.0.2' })
  let nextCalled = false
  limiter(req2, res2, () => { nextCalled = true })
  assert.equal(nextCalled, true)
})
