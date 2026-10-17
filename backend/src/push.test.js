import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedEndpoint, validSubscription, runReminderPass, sendToUser, reminderPayload, REMINDER_GRACE_MS } from './push.js'

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPx-_aa', auth: 'xyz_-1' } }

test('allowedEndpoint chỉ nhận máy chủ push chính thức qua HTTPS (chống SSRF)', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://wns2-par02p.notify.windows.com/w/?token=1',
    'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/abc', 'https://api.push.apple.com/x']) {
    assert.equal(allowedEndpoint(ok), true, ok)
  }
  for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'http://localhost:1433', 'https://evil.com/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.com/x', 'https://notify.windows.com.evil.com/', 'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x', 'file:///etc/passwd', 'không phải url', 42, null, 'https://fcm.googleapis.com/' + 'a'.repeat(1000)]) {
    assert.equal(allowedEndpoint(bad), false, String(bad).slice(0, 60))
  }
})

test('validSubscription kiểm tra khóa base64url và độ dài', () => {
  assert.equal(validSubscription(SUB), true)
  assert.equal(validSubscription({ ...SUB, keys: { p256dh: 'có dấu', auth: 'x' } }), false)
  assert.equal(validSubscription({ ...SUB, keys: { p256dh: 'a'.repeat(201), auth: 'x' } }), false)
  assert.equal(validSubscription({ endpoint: SUB.endpoint }), false)
  assert.equal(validSubscription(null), false)
})

test('reminderPayload: 1 việc gửi tiêu đề + hạn; nhiều việc gửi tóm tắt', () => {
  assert.deepEqual(reminderPayload([{ serverId: 'a', title: 'Nộp bài', dueAt: 5 }]), { type: 'reminder', title: 'Nộp bài', dueAt: 5, tag: 'reminder-a' })
  const summary = reminderPayload([1, 2, 3, 4].map(i => ({ serverId: `s${i}`, title: `T${i}`, dueAt: i })))
  assert.deepEqual(summary, { type: 'summary', count: 4, titles: ['T1', 'T2', 'T3'], dueAt: 1, tag: 'reminder-summary' })
})

function fakeStore(claimed, subsByUser) {
  const calls = { released: [], deleted: [], claimArgs: null }
  return {
    calls,
    async claimDueReminders(now, grace, limit) { calls.claimArgs = [now, grace, limit]; return claimed },
    async getPushSubscriptions(userId) { return subsByUser[userId] || [] },
    async deletePushSubscriptionByEndpoint(endpoint) { calls.deleted.push(endpoint) },
    async releaseReminder(serverId, dueAt) { calls.released.push([serverId, dueAt]) }
  }
}
function fakePush(statusByEndpoint = {}, configured = true) {
  const sent = []
  return { sent, isConfigured: () => configured, async send(sub, payload) { sent.push([sub.endpoint, payload]); return statusByEndpoint[sub.endpoint] || 'sent' } }
}
const sub = endpoint => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } })

test('runReminderPass không làm gì khi chưa cấu hình VAPID', async () => {
  const store = fakeStore([{ serverId: 'a', userId: 1, title: 'x', dueAt: 1 }], { 1: [sub('e1')] })
  const push = fakePush({}, false)
  assert.deepEqual(await runReminderPass(store, push, 1000), { users: 0, reminders: 0 })
  assert.equal(store.calls.claimArgs, null)
  assert.equal(push.sent.length, 0)
})

test('runReminderPass gửi mỗi việc 1 thông báo tới mọi thiết bị của đúng chủ sở hữu', async () => {
  const store = fakeStore([
    { serverId: 'a', userId: 1, title: 'Việc A', dueAt: 10 },
    { serverId: 'b', userId: 2, title: 'Việc B', dueAt: 20 }
  ], { 1: [sub('u1-laptop'), sub('u1-phone')], 2: [sub('u2')] })
  const push = fakePush()
  assert.deepEqual(await runReminderPass(store, push, 1000), { users: 2, reminders: 2 })
  assert.deepEqual(store.calls.claimArgs, [1000, REMINDER_GRACE_MS, 200])
  assert.deepEqual(push.sent.map(([e, p]) => [e, p.title]), [['u1-laptop', 'Việc A'], ['u1-phone', 'Việc A'], ['u2', 'Việc B']])
  assert.deepEqual(store.calls.released, [])
})

test('runReminderPass gộp thành 1 thông báo tóm tắt khi 1 người có > 3 việc cùng lúc', async () => {
  const items = [1, 2, 3, 4, 5].map(i => ({ serverId: `s${i}`, userId: 1, title: `T${i}`, dueAt: i }))
  const push = fakePush()
  await runReminderPass(fakeStore(items, { 1: [sub('e')] }), push, 1000)
  assert.equal(push.sent.length, 1)
  assert.equal(push.sent[0][1].type, 'summary')
  assert.equal(push.sent[0][1].count, 5)
})

test('runReminderPass: đăng ký hết hiệu lực (410) bị dọn, lỗi tạm thời trên mọi thiết bị thì trả lại để thử lại', async () => {
  const store = fakeStore([{ serverId: 'a', userId: 1, title: 'x', dueAt: 7 }], { 1: [sub('gone'), sub('flaky')] })
  await runReminderPass(store, fakePush({ gone: 'gone', flaky: 'failed' }), 1000)
  assert.deepEqual(store.calls.deleted, ['gone'])
  assert.deepEqual(store.calls.released, [['a', 7]])
})

test('runReminderPass: đã tới được ít nhất 1 thiết bị thì không gửi lại dù thiết bị khác lỗi tạm thời', async () => {
  const store = fakeStore([{ serverId: 'a', userId: 1, title: 'x', dueAt: 7 }], { 1: [sub('ok'), sub('flaky')] })
  await runReminderPass(store, fakePush({ flaky: 'failed' }), 1000)
  assert.deepEqual(store.calls.released, [])
})

test('runReminderPass: mọi đăng ký đều hết hiệu lực thì không trả lại (không còn thiết bị nào để thử)', async () => {
  const store = fakeStore([{ serverId: 'a', userId: 1, title: 'x', dueAt: 7 }], { 1: [sub('gone')] })
  await runReminderPass(store, fakePush({ gone: 'gone' }), 1000)
  assert.deepEqual(store.calls.released, [])
  assert.deepEqual(store.calls.deleted, ['gone'])
})

test('sendToUser đếm đúng sent/failed/total', async () => {
  const store = fakeStore([], { 3: [sub('a'), sub('b'), sub('c')] })
  assert.deepEqual(await sendToUser(store, fakePush({ b: 'failed', c: 'gone' }), 3, { type: 'test' }), { sent: 1, failed: 1, total: 3 })
})
