import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPassword, verifyPassword, signToken, verifyToken, createRequireAuth, validUsername, validPassword,
  validEmail, createResetToken, hashResetToken, createRequireAdmin, requireRoot
} from './auth.js'

test('validUsername chấp nhận 3-50 ký tự chữ/số/._-', () => {
  assert.equal(validUsername('ab'), false)
  assert.equal(validUsername('abc'), true)
  assert.equal(validUsername('a'.repeat(50)), true)
  assert.equal(validUsername('a'.repeat(51)), false)
  assert.equal(validUsername('user name'), false)
  assert.equal(validUsername('user.name-1_2'), true)
})

test('validPassword yêu cầu độ dài 6-200', () => {
  assert.equal(validPassword('12345'), false)
  assert.equal(validPassword('123456'), true)
  assert.equal(validPassword('a'.repeat(200)), true)
  assert.equal(validPassword('a'.repeat(201)), false)
})

test('hashPassword/verifyPassword round-trip', async () => {
  const hash = await hashPassword('mat-khau-thu')
  assert.notEqual(hash, 'mat-khau-thu')
  assert.equal(await verifyPassword('mat-khau-thu', hash), true)
  assert.equal(await verifyPassword('sai-mat-khau', hash), false)
})

test('signToken/verifyToken round-trip giữ đúng thông tin user', () => {
  const token = signToken({ id: 42, username: 'tester' })
  const payload = verifyToken(token)
  assert.equal(payload.sub, 42)
  assert.equal(payload.username, 'tester')
})

test('verifyToken từ chối token giả mạo', () => {
  assert.throws(() => verifyToken('token-khong-hop-le'))
})

function fakeReqRes(headers = {}) {
  const req = { get: name => headers[name] }
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  return { req, res }
}

function fakeAuthStore(user) {
  return { async getUserById() { return user } }
}

test('requireAuth từ chối khi không có header Authorization', async () => {
  const { req, res } = fakeReqRes()
  let nextCalled = false
  await createRequireAuth(fakeAuthStore(null))(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
})

test('requireAuth từ chối token sai định dạng', async () => {
  const { req, res } = fakeReqRes({ Authorization: 'NotBearer xyz' })
  let nextCalled = false
  await createRequireAuth(fakeAuthStore(null))(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
})

test('requireAuth cho qua và gắn req.user khi token hợp lệ và tài khoản chưa bị khóa', async () => {
  const token = signToken({ id: 7, username: 'ok' })
  const { req, res } = fakeReqRes({ Authorization: `Bearer ${token}` })
  let nextCalled = false
  await createRequireAuth(fakeAuthStore({ Id: 7, Username: 'ok', Disabled: false }))(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, true)
  assert.equal(req.user.username, 'ok')
  assert.equal(req.authUser.Id, 7)
})

// Hồi quy: đây là hành vi cốt lõi của phần "thu hồi quyền truy cập ngay khi
// admin khóa tài khoản" - trước đây requireAuth chỉ xác minh chữ ký JWT, một
// tài khoản bị khóa (Disabled=1) vẫn dùng được token cũ cho tới khi token tự
// hết hạn (7 ngày). Giờ requireAuth tra DB mỗi request nên khóa có hiệu lực
// ngay từ request tiếp theo, không cần đợi hết hạn token.
test('requireAuth từ chối (401) ngay cả khi chữ ký JWT hợp lệ nếu tài khoản đã bị khóa', async () => {
  const token = signToken({ id: 7, username: 'bi-khoa' })
  const { req, res } = fakeReqRes({ Authorization: `Bearer ${token}` })
  let nextCalled = false
  await createRequireAuth(fakeAuthStore({ Id: 7, Username: 'bi-khoa', Disabled: true }))(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
  assert.match(res.body.error, /vô hiệu hóa/)
})

test('requireAuth từ chối (401) khi tài khoản trong token không còn tồn tại trong DB', async () => {
  const token = signToken({ id: 999, username: 'da-xoa' })
  const { req, res } = fakeReqRes({ Authorization: `Bearer ${token}` })
  let nextCalled = false
  await createRequireAuth(fakeAuthStore(null))(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
})

test('requireAuth từ chối token giả mạo/sai chữ ký (không gọi tới store)', async () => {
  const { req, res } = fakeReqRes({ Authorization: 'Bearer token-khong-hop-le' })
  let storeCalled = false
  let nextCalled = false
  const store = { async getUserById() { storeCalled = true; return null } }
  await createRequireAuth(store)(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
  assert.equal(storeCalled, false)
})

test('validEmail chấp nhận địa chỉ email hợp lệ, từ chối chuỗi thiếu @ hoặc domain', () => {
  assert.equal(validEmail('a@b.com'), true)
  assert.equal(validEmail('24tx610008@student.hcmute.edu.vn'), true)
  assert.equal(validEmail('khong-phai-email'), false)
  assert.equal(validEmail('a@b'), false)
  assert.equal(validEmail(''), false)
  assert.equal(validEmail('a'.repeat(256) + '@b.com'), false)
})

test('createResetToken sinh chuỗi ngẫu nhiên khác nhau mỗi lần gọi', () => {
  const a = createResetToken()
  const b = createResetToken()
  assert.notEqual(a, b)
  assert.equal(a.length, 64) // 32 byte hex
})

test('hashResetToken là hàm băm xác định (cùng input ra cùng output) để tra cứu bằng WHERE', () => {
  const token = createResetToken()
  assert.equal(hashResetToken(token), hashResetToken(token))
  assert.notEqual(hashResetToken(token), token)
  assert.notEqual(hashResetToken(token), hashResetToken(createResetToken()))
})

function fakeReqResAdmin(user) {
  const req = { user: { sub: 1 } }
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  const store = { async getUserById() { return user } }
  return { req, res, store }
}

test('requireAdmin từ chối (403) khi user không tồn tại hoặc Role=user', async () => {
  const { req, res, store } = fakeReqResAdmin({ Id: 1, Role: 'user', Disabled: false })
  let nextCalled = false
  await createRequireAdmin(store)(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
})

test('requireAdmin từ chối (401) khi tài khoản admin đã bị vô hiệu hóa', async () => {
  const { req, res, store } = fakeReqResAdmin({ Id: 1, Role: 'admin', Disabled: true })
  let nextCalled = false
  await createRequireAdmin(store)(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
})

test('requireAdmin cho qua và gắn req.actingAdmin khi Role=admin và chưa bị khóa', async () => {
  const { req, res, store } = fakeReqResAdmin({ Id: 1, Role: 'admin', Disabled: false })
  let nextCalled = false
  await createRequireAdmin(store)(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, true)
  assert.equal(req.actingAdmin.Role, 'admin')
})

test('requireAdmin cho qua khi Role=root và chưa bị khóa', async () => {
  const { req, res, store } = fakeReqResAdmin({ Id: 1, Role: 'root', Disabled: false })
  let nextCalled = false
  await createRequireAdmin(store)(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, true)
})

test('requireAdmin tái dùng authUser do requireAuth đã tải, không query DB lần hai', async () => {
  const req = { user: { sub: 1 }, authUser: { Id: 1, Role: 'admin', Disabled: false } }
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  let storeCalled = false
  let nextCalled = false
  await createRequireAdmin({ async getUserById() { storeCalled = true } })(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, true)
  assert.equal(storeCalled, false)
})

function fakeReqRoot(role) {
  const req = { actingAdmin: { Role: role } }
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  return { req, res }
}

test('requireRoot từ chối (403) khi actingAdmin là admin thường', () => {
  const { req, res } = fakeReqRoot('admin')
  let nextCalled = false
  requireRoot(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
})

test('requireRoot cho qua khi actingAdmin là root', () => {
  const { req, res } = fakeReqRoot('root')
  let nextCalled = false
  requireRoot(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, true)
})
