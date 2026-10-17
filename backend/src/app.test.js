import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { hashPassword, signToken, verifyToken } from './auth.js'
import { AiFailure } from './ai.js'
import { KnowledgeFailure } from './knowledge.js'

function fakeStore(overrides = {}) {
  return {
    async getAllNotes() { return [] },
    async upsertNote() { return { status: 'applied', version: 1 } },
    async getNotesSince(userId, since) { return { notes: [], cursor: since, hasMore: false, reset: false } },
    async createUser({ username, passwordHash, displayName }) {
      return { Id: 1, Username: username, PasswordHash: passwordHash, DisplayName: displayName || username }
    },
    async getUserByUsername() { return null },
    // requireAuth tra DB mỗi request (xem auth.js) - mặc định trả về một user
    // hợp lệ, chưa bị khóa khớp đúng id trong token, để các test hiện có chỉ
    // cần token hợp lệ là qua được requireAuth như trước, không cần override
    // getUserById ở từng test không liên quan tới khóa tài khoản.
    async getUserById(id) { return { Id: id, Username: 'tester', DisplayName: 'Tester', Disabled: false, Role: 'user' } },
    async updatePassword() {},
    async updateEmail() {},
    async getUserByEmail() { return null },
    async setResetToken() {},
    async resetPasswordWithToken() { return false },
    async getAllUsersWithStats() { return [] },
    async setUserDisabled() {},
    async updateUserByAdmin() {},
    async promoteToAdmin() { return true },
    async demoteToUser() { return true },
    async assignUserToAdmin() { return true },
    async unassignUser() { return true },
    async logAdminAction() {},
    async getAdminAuditLog() { return [] },
    async recordFailedLogin() { return { count: 1, lockedUntil: null } },
    async clearLoginLock() {},
    ...overrides
  }
}

function fakeAi(overrides = {}) {
  return {
    async draftFromText() { return { title: 'Nháp AI', content: '', tag: '', kind: 'note', startAt: null, dueAt: null } },
    ...overrides
  }
}

function fakeKnowledge(overrides = {}) {
  return {
    async answerQuestion() { return { answer: 'Trả lời [1]', sources: [], indexed: 0 } },
    ...overrides
  }
}

function fakePlanner(overrides = {}) {
  return {
    async createPlan() { return { sourceTaskCount: 0, tasks: [], days: [], scenarios: [], insights: [] } },
    ...overrides
  }
}

function fakeMailer(overrides = {}) {
  return {
    async sendResetPasswordEmail() {},
    ...overrides
  }
}

async function withServer(app, run) {
  const server = app.listen(0)
  const port = server.address().port
  try { await run(`http://127.0.0.1:${port}`) }
  finally { await new Promise(resolve => server.close(resolve)) }
}

function authHeaders(token) { return { Authorization: `Bearer ${token}` } }

test('GET /api/notes trả 401 khi thiếu token', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/notes`)
    assert.equal(res.status, 401)
  })
})

test('GET /api/notes trả danh sách khi có token hợp lệ', async () => {
  const app = createApp(fakeStore({ async getNotesSince() { return { notes: [{ serverId: 'a' }], cursor: '5', hasMore: false, reset: false } } }), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/notes`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.notes.length, 1)
  })
})

// Kịch bản thật của tính năng "khóa tài khoản có hiệu lực ngay": user thường
// đang có token hợp lệ (đã đăng nhập từ trước) gọi /api/notes bình thường,
// admin khóa tài khoản đó, request /api/notes TIẾP THEO bằng CHÍNH token cũ
// đó phải bị từ chối ngay lập tức - không cần đợi token hết hạn hay đăng
// nhập lại. Không riêng gì route notes: mọi route dùng requireAuth đều vậy.
test('GET /api/notes bị từ chối ngay bằng token cũ sau khi tài khoản bị admin khóa giữa chừng (không đợi token hết hạn)', async () => {
  let disabled = false
  const store = fakeStore({
    async getNotesSince() { return { notes: [{ serverId: 'a' }], cursor: '5', hasMore: false, reset: false } },
    async getUserById(id) { return { Id: id, Username: 'thuong', Disabled: disabled, Role: 'user' } }
  })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 5, username: 'thuong' })
  await withServer(app, async (base) => {
    const before = await fetch(`${base}/api/notes`, { headers: authHeaders(token) })
    assert.equal(before.status, 200)

    disabled = true // admin vừa bấm "Khóa" cho tài khoản này

    const after = await fetch(`${base}/api/notes`, { headers: authHeaders(token) })
    assert.equal(after.status, 401)
    const body = await after.json()
    assert.match(body.error, /vô hiệu hóa/)
  })
})

test('GET /api/notes gọi store với đúng userId lấy từ token (cô lập theo tài khoản)', async () => {
  let receivedUserId
  const store = fakeStore({ async getNotesSince(userId, since) { receivedUserId = userId; return { notes: [], cursor: since, hasMore: false, reset: false } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 42, username: 'user42' })
  await withServer(app, async (base) => {
    await fetch(`${base}/api/notes`, { headers: authHeaders(token) })
    assert.equal(receivedUserId, 42)
  })
})

test('GET /api/auth/me trả profile mới nhất và chỉ đọc user một lần trong requireAuth', async () => {
  let calls = 0
  const store = fakeStore({ async getUserById(id) {
    calls++
    return { Id: id, Username: 'ten-moi', DisplayName: 'Tên mới', Email: 'moi@vidu.com', Role: 'admin', Disabled: false }
  } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 7, username: 'ten-cu' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/me`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.deepEqual((await res.json()).user, { id: 7, username: 'ten-moi', displayName: 'Tên mới', email: 'moi@vidu.com', role: 'admin' })
    assert.equal(calls, 1)
  })
})

test('POST /api/notes/sync gọi upsertNote với đúng userId của người gửi request', async () => {
  let receivedUserId
  const store = fakeStore({ async upsertNote(note, userId) { receivedUserId = userId; return { status: 'applied', version: 1 } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 7, username: 'user7' })
  const note = { id: 1, serverId: 's1', title: 'T', content: '', tag: 'chung', done: false, deleted: 0,
    updatedAt: 1000, kind: 'note', createdAt: 900, startAt: null, dueAt: null, completedAt: null, deletedAt: null, baseVersion: null }
  await withServer(app, async (base) => {
    await fetch(`${base}/api/notes/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Version': '3', ...authHeaders(token) },
      body: JSON.stringify({ notes: [note] })
    })
    assert.equal(receivedUserId, 7)
  })
})

test('POST /api/auth/register tạo user mới và trả token', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newuser', password: '123456', email: 'newuser@vidu.com' })
    })
    assert.equal(res.status, 201)
    const body = await res.json()
    assert.ok(body.token)
    assert.equal(body.user.username, 'newuser')
  })
})

// Hồi quy: signToken() từng được gọi với object có key viết hoa (Id/Username
// từ kết quả SQL) trong khi signToken cần key viết thường (id/username), nên
// token cấp ra lúc đăng ký/đăng nhập luôn có sub=undefined - chỉ lộ ra khi
// dùng sub làm UserId cho các bảng khác. Test này giải mã token THẬT (không
// tự signToken trong test) để bắt đúng lỗi đó.
test('Token từ /api/auth/register giải mã ra đúng sub khớp id user thật', async () => {
  const store = fakeStore({ async createUser({ username, displayName, email }) {
    return { Id: 55, Username: username, DisplayName: displayName || username, Email: email }
  } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regress1', password: '123456', email: 'regress1@vidu.com' })
    })
    const body = await res.json()
    const payload = verifyToken(body.token)
    assert.equal(payload.sub, 55)
    assert.equal(payload.username, 'regress1')
  })
})

test('Token từ /api/auth/login giải mã ra đúng sub khớp id user thật', async () => {
  const passwordHash = await hashPassword('matkhau123')
  const store = fakeStore({ async getUserByUsername() { return { Id: 77, Username: 'regress2', PasswordHash: passwordHash, DisplayName: 'Regress2' } } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regress2', password: 'matkhau123' })
    })
    const body = await res.json()
    const payload = verifyToken(body.token)
    assert.equal(payload.sub, 77)
    assert.equal(payload.username, 'regress2')
  })
})

// Hồi quy: đăng nhập/đăng ký từng chỉ trả id/username/displayName, không có
// email - vì vậy mỗi lần đăng nhập lại, saveSession() ở frontend ghi đè cache
// user cục bộ và XÓA MẤT email đã lưu trước đó (dù DB server vẫn còn đúng),
// khiến dialog "Thêm/Đổi email khôi phục" hiển thị sai trạng thái sau khi
// đăng nhập lại. Phải trả email ngay trong response login/register.
test('POST /api/auth/login trả kèm email đã lưu của tài khoản trong response user', async () => {
  const passwordHash = await hashPassword('matkhau123')
  const store = fakeStore({ async getUserByUsername() {
    return { Id: 77, Username: 'regress2', PasswordHash: passwordHash, DisplayName: 'Regress2', Email: 'regress2@vidu.com' }
  } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regress2', password: 'matkhau123' })
    })
    const body = await res.json()
    assert.equal(body.user.email, 'regress2@vidu.com')
  })
})

test('POST /api/auth/register từ chối username/password không hợp lệ', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ab', password: '123', email: 'ab@vidu.com' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/register trả 409 khi username đã tồn tại', async () => {
  const store = fakeStore({ async createUser() { const e = new Error('Tên đăng nhập đã tồn tại'); e.number = 50002; throw e } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'trung', password: '123456', email: 'trung@vidu.com' })
    })
    assert.equal(res.status, 409)
  })
})

// Hồi quy: store.createUser đã hỗ trợ tham số email từ trước, nhưng route
// /api/auth/register quên đọc/truyền field này - form đăng ký gửi email lên
// vẫn bị lờ đi hoàn toàn, tài khoản mới luôn tạo ra với Email=NULL bất kể
// người dùng có điền email lúc đăng ký hay không.
test('POST /api/auth/register nhận và lưu đúng email điền lúc đăng ký', async () => {
  let received
  const store = fakeStore({ async createUser(args) {
    received = args
    return { Id: 1, Username: args.username, DisplayName: args.displayName || args.username, Email: args.email }
  } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'moiemail', password: '123456', email: 'moiemail@vidu.com' })
    })
    assert.equal(res.status, 201)
    assert.equal(received.email, 'moiemail@vidu.com')
    const body = await res.json()
    assert.equal(body.user.email, 'moiemail@vidu.com')
  })
})

test('POST /api/auth/register chuẩn hóa khoảng trắng email và tên hiển thị', async () => {
  let received
  const store = fakeStore({ async createUser(args) {
    received = args
    return { Id: 1, Username: args.username, DisplayName: args.displayName || args.username, Email: args.email }
  } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'chuanhoa', password: '123456', displayName: '  Tên đẹp  ', email: '  user@vidu.com  ' })
    })
    assert.equal(res.status, 201)
    assert.equal(received.displayName, 'Tên đẹp')
    assert.equal(received.email, 'user@vidu.com')
  })
})

test('POST /api/auth/register trả 400 khi email đăng ký sai định dạng', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'saiemail', password: '123456', email: 'khong-hop-le' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/register trả 409 khi email đã dùng cho tài khoản khác', async () => {
  const store = fakeStore({ async createUser() { const e = new Error('Email đã được dùng cho tài khoản khác'); e.number = 50003; throw e } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'trung2', password: '123456', email: 'trung@vidu.com' })
    })
    assert.equal(res.status, 409)
  })
})

// Từ bản cập nhật email-bắt-buộc: đăng ký thiếu email (hoặc chuỗi rỗng) phải
// bị từ chối ngay ở bước validate, không được tạo tài khoản với Email=NULL
// nữa (khác hành vi cũ khi email còn là tùy chọn).
test('POST /api/auth/register trả 400 khi thiếu email (email nay là bắt buộc)', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'khongemail', password: '123456' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/register trả 400 khi email để trống', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'emailrong', password: '123456', email: '' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/login trả token khi đúng mật khẩu', async () => {
  const passwordHash = await hashPassword('matkhau123')
  const store = fakeStore({ async getUserByUsername() { return { Id: 1, Username: 'demo', PasswordHash: passwordHash, DisplayName: 'Demo' } } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'matkhau123' })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.token)
  })
})

test('POST /api/auth/login trả 401 khi sai mật khẩu', async () => {
  const passwordHash = await hashPassword('matkhau123')
  const store = fakeStore({ async getUserByUsername() { return { Id: 1, Username: 'demo', PasswordHash: passwordHash, DisplayName: 'Demo' } } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'sai' })
    })
    assert.equal(res.status, 401)
  })
})

test('POST /api/auth/login từ chối (401) tài khoản đã bị admin vô hiệu hóa dù đúng mật khẩu', async () => {
  const passwordHash = await hashPassword('matkhau123')
  const store = fakeStore({ async getUserByUsername() {
    return { Id: 1, Username: 'demo', PasswordHash: passwordHash, DisplayName: 'Demo', Disabled: true }
  } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'matkhau123' })
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.match(body.error, /vô hiệu hóa/)
  })
})

test('POST /api/auth/login trả kèm role đúng giá trị trong response user', async () => {
  const passwordHash = await hashPassword('matkhau123')
  const store = fakeStore({ async getUserByUsername() {
    return { Id: 1, Username: 'boss', PasswordHash: passwordHash, DisplayName: 'Boss', Role: 'root' }
  } })
  const app = createApp(store, { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'boss', password: 'matkhau123' })
    })
    const body = await res.json()
    assert.equal(body.user.role, 'root')
  })
})

test('POST /api/notes/sync trả 409 khi thiếu header X-Sync-Version', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/notes/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ notes: [] })
    })
    assert.equal(res.status, 409)
  })
})

test('POST /api/notes/sync trả 400 khi note không hợp lệ', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/notes/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Version': '3', ...authHeaders(token) },
      body: JSON.stringify({ notes: [{ id: 1 }] })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/notes/sync đồng bộ thành công với note hợp lệ', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  const note = { id: 1, serverId: 's1', title: 'T', content: '', tag: 'chung', done: false, deleted: 0,
    updatedAt: 1000, kind: 'note', createdAt: 900, startAt: null, dueAt: null, completedAt: null, deletedAt: null, baseVersion: null }
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/notes/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Version': '3', ...authHeaders(token) },
      body: JSON.stringify({ notes: [note] })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.results, [{ localId: 1, serverId: 's1', status: 'applied', version: 1 }])
  })
})

test('POST /api/auth/change-password trả 401 khi thiếu token', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: '123456', newPassword: 'abcdef' })
    })
    assert.equal(res.status, 401)
  })
})

test('POST /api/auth/change-password đổi thành công khi đúng mật khẩu hiện tại', async () => {
  const currentHash = await hashPassword('matkhaucu')
  let savedHash = null
  const store = fakeStore({
    async getUserById(id) { return { Id: id, Username: 'demo', PasswordHash: currentHash, DisplayName: 'Demo' } },
    async updatePassword(userId, passwordHash) { savedHash = { userId, passwordHash } }
  })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'demo' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ currentPassword: 'matkhaucu', newPassword: 'matkhaumoi' })
    })
    assert.equal(res.status, 200)
    assert.equal(savedHash.userId, 9)
    assert.notEqual(savedHash.passwordHash, currentHash)
  })
})

test('POST /api/auth/change-password trả 401 khi sai mật khẩu hiện tại, không gọi updatePassword', async () => {
  const currentHash = await hashPassword('matkhaucu')
  let updateCalled = false
  const store = fakeStore({
    async getUserById(id) { return { Id: id, Username: 'demo', PasswordHash: currentHash, DisplayName: 'Demo' } },
    async updatePassword() { updateCalled = true }
  })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'demo' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ currentPassword: 'sai-roi', newPassword: 'matkhaumoi' })
    })
    assert.equal(res.status, 401)
    assert.equal(updateCalled, false)
  })
})

test('POST /api/auth/change-password trả 400 khi mật khẩu mới quá ngắn', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'demo' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ currentPassword: '123456', newPassword: '123' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/email trả 401 khi thiếu token', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), mailer: fakeMailer() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com' })
    })
    assert.equal(res.status, 401)
  })
})

test('POST /api/auth/email trả 400 khi email sai định dạng', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), mailer: fakeMailer() })
  const token = signToken({ id: 1, username: 'demo' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ email: 'khong-hop-le' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/email lưu email khi hợp lệ và chưa ai dùng', async () => {
  let saved = null
  const store = fakeStore({ async updateEmail(userId, email) { saved = { userId, email } } })
  const app = createApp(store, { ai: fakeAi(), mailer: fakeMailer() })
  const token = signToken({ id: 9, username: 'demo' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ email: 'demo@vidu.com' })
    })
    assert.equal(res.status, 200)
    assert.deepEqual(saved, { userId: 9, email: 'demo@vidu.com' })
  })
})

test('POST /api/auth/email trả 409 khi email đã thuộc tài khoản khác', async () => {
  const store = fakeStore({ async updateEmail() { throw Object.assign(new Error('trùng email'), { number: 50003 }) } })
  const app = createApp(store, { ai: fakeAi(), mailer: fakeMailer() })
  const token = signToken({ id: 9, username: 'demo' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ email: 'demo@vidu.com' })
    })
    assert.equal(res.status, 409)
  })
})

test('POST /api/auth/forgot-password luôn trả cùng thông báo dù email có tồn tại hay không (chống dò email)', async () => {
  const app = createApp(fakeStore({ async getUserByEmail() { return null } }), { ai: fakeAi(), mailer: fakeMailer() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/forgot-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'khong-ton-tai@vidu.com' })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
  })
})

test('POST /api/auth/forgot-password tạo token + gửi mail khi email khớp tài khoản', async () => {
  let tokenSaved = null
  let mailSentTo = null
  const store = fakeStore({
    async getUserByEmail(email) { return { Id: 5, Email: email } },
    async setResetToken(userId, tokenHash, expiresAt) { tokenSaved = { userId, tokenHash, expiresAt } }
  })
  const mailer = fakeMailer({ async sendResetPasswordEmail(to) { mailSentTo = to } })
  const app = createApp(store, { ai: fakeAi(), mailer })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/forgot-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@vidu.com' })
    })
    assert.equal(res.status, 200)
    // sendResetPasswordEmail không được await bởi route (không giữ request chờ SMTP) - đợi 1 tick để mailer chạy.
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(tokenSaved.userId, 5)
    assert.ok(tokenSaved.expiresAt > Date.now())
    assert.equal(mailSentTo, 'demo@vidu.com')
  })
})

test('POST /api/auth/forgot-password trả 400 khi email sai định dạng', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), mailer: fakeMailer() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/forgot-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sai' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/reset-password đặt mật khẩu mới thành công khi token hợp lệ', async () => {
  let received = null
  const store = fakeStore({
    async resetPasswordWithToken(tokenHash, passwordHash) { received = { tokenHash, passwordHash }; return true }
  })
  const app = createApp(store, { ai: fakeAi(), mailer: fakeMailer() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-gia-lap', newPassword: 'matkhaumoi' })
    })
    assert.equal(res.status, 200)
    assert.ok(received.tokenHash)
    assert.notEqual(received.tokenHash, 'token-gia-lap') // phải băm, không lưu token gốc
  })
})

test('POST /api/auth/reset-password trả 400 khi token không hợp lệ hoặc đã hết hạn', async () => {
  const store = fakeStore({ async resetPasswordWithToken() { return false } })
  const app = createApp(store, { ai: fakeAi(), mailer: fakeMailer() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-het-han', newPassword: 'matkhaumoi' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/reset-password trả 400 khi mật khẩu mới quá ngắn', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), mailer: fakeMailer() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-gia-lap', newPassword: '123' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/auth/login đăng nhập đúng sau khi sai vài lần (chưa chạm ngưỡng) vẫn thành công', async () => {
  const passwordHash = await hashPassword('dungmatkhau')
  const store = fakeStore({ async getUserByUsername() {
    return { Id: 1, Username: 'target', PasswordHash: passwordHash, DisplayName: 'Target' }
  } })
  const app = createApp(store, { ai: fakeAi(), loginLimiterOptions: { maxAttempts: 5, windowMs: 60000, lockMs: 60000 } })
  await withServer(app, async (base) => {
    await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'target', password: 'sai' })
    })
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'target', password: 'dungmatkhau' })
    })
    assert.equal(res.status, 200)
  })
})

test('POST /api/auth/register bị chặn 429 khi vượt giới hạn theo IP', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), registerLimiterOptions: { maxRequests: 1, windowMs: 60000 } })
  await withServer(app, async (base) => {
    const attempt = (username) => fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: '123456', email: `${username}@vidu.com` })
    })
    assert.equal((await attempt('user1')).status, 201)
    assert.equal((await attempt('user2')).status, 429)
  })
})

test('POST /api/ai/draft trả 401 khi thiếu token', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' })
    })
    assert.equal(res.status, 401)
  })
})

test('POST /api/ai/draft trả bản nháp khi có token hợp lệ', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi({ async draftFromText(text) { return { title: text, content: '', tag: '', kind: 'note', startAt: null, dueAt: null } } }) })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ text: 'nhắc tôi ăn cơm' })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.draft.title, 'nhắc tôi ăn cơm')
  })
})

test('POST /api/ai/draft: AI lỗi/timeout vẫn trả bản nháp cơ bản (tiêu đề + hạn đã phân tích) kèm cảnh báo', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi({ async draftFromText() { throw new AiFailure('Model AI local chưa trả lời sau 60 giây', 'timeout') } }) })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ text: 'Nhắc tôi nộp báo cáo vào 5h chiều ngày 25/09/2026' })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.fallback, true)
    assert.equal(body.code, 'timeout')
    assert.match(body.warning, /60 giây/)
    assert.equal(body.draft.title, 'Nộp báo cáo')
    assert.equal(body.draft.kind, 'task')
    assert.equal(body.draft.dueAt, new Date(2026, 8, 25, 17, 0).getTime())
  })
})

test('POST /api/ai/draft truyền signal hủy xuống AI (đóng kết nối thì dừng yêu cầu tới Ollama)', async () => {
  let receivedSignal
  const app = createApp(fakeStore(), { ai: fakeAi({ async draftFromText(text, now, tags, options) { receivedSignal = options?.signal; return { title: 'X', content: '', tag: '', kind: 'note', startAt: null, dueAt: null } } }) })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ text: 'x' })
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).fallback, undefined)
  })
  assert.ok(receivedSignal instanceof AbortSignal)
  assert.equal(receivedSignal.aborted, false) // trả lời xong bình thường thì không bị hủy
})

test('POST /api/ai/warmup cần đăng nhập, trả 202 ngay và gọi nạp sẵn model', async () => {
  let warmed = 0
  const app = createApp(fakeStore(), { ai: fakeAi({ async warmUp() { warmed++; return true } }) })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/ai/warmup`, { method: 'POST' })).status, 401)
    const res = await fetch(`${base}/api/ai/warmup`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 202)
  })
  assert.equal(warmed, 1)
})

test('POST /api/ai/draft trả 400 khi text rỗng', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ text: '' })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/ai/knowledge/query yêu cầu đăng nhập và validate câu hỏi', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), knowledge: fakeKnowledge() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/ai/knowledge/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'x' })
    })).status, 401)
    assert.equal((await fetch(`${base}/api/ai/knowledge/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ question: 'x' })
    })).status, 400)
  })
})

test('POST /api/ai/knowledge/query dùng userId từ JWT và trả câu trả lời có nguồn', async () => {
  let received
  const knowledge = fakeKnowledge({
    async answerQuestion(options) {
      received = options
      return { answer: 'Hoàn thiện slide [1].', sources: [{ number: 1, serverId: 'n1', title: 'Bảo vệ' }], indexed: 1 }
    }
  })
  const app = createApp(fakeStore(), { ai: fakeAi(), knowledge })
  const token = signToken({ id: 7, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/knowledge/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ question: 'Tôi cần làm gì?', topK: 4 })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.sources[0].serverId, 'n1')
  })
  assert.equal(received.userId, 7)
  assert.equal(received.topK, 4)
  assert.ok(received.signal instanceof AbortSignal)
})

test('POST /api/ai/knowledge/query trả 503 với lỗi Ollama có kiểm soát', async () => {
  const knowledge = fakeKnowledge({ async answerQuestion() { throw new KnowledgeFailure('Thiếu model embedding', 'model_error') } })
  const app = createApp(fakeStore(), { ai: fakeAi(), knowledge })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/knowledge/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ question: 'Tìm ghi chú liên quan' })
    })
    assert.equal(res.status, 503)
    assert.equal((await res.json()).code, 'model_error')
  })
})

test('POST /api/ai/planner/simulate yêu cầu đăng nhập và validate tham số', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), planner: fakePlanner() })
  const token = signToken({ id: 1, username: 'tester' })
  const invalid = { dailyCapacityMinutes: 10, horizonDays: 0, timezoneOffsetMinutes: 0 }
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/ai/planner/simulate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalid)
    })).status, 401)
    assert.equal((await fetch(`${base}/api/ai/planner/simulate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify(invalid)
    })).status, 400)
  })
})

test('POST /api/ai/planner/simulate dùng userId JWT và truyền đủ cấu hình', async () => {
  let received
  const planner = fakePlanner({
    async createPlan(options) {
      received = options
      return { sourceTaskCount: 1, completedTasks: 1, tasks: [{ serverId: 't1' }], days: [], scenarios: [], insights: [] }
    }
  })
  const app = createApp(fakeStore(), { ai: fakeAi(), planner })
  const token = signToken({ id: 12, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/planner/simulate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ dailyCapacityMinutes: 180, horizonDays: 14, timezoneOffsetMinutes: -420, goal: 'Ưu tiên bảo vệ' })
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).tasks[0].serverId, 't1')
  })
  assert.equal(received.userId, 12)
  assert.equal(received.dailyCapacityMinutes, 180)
  assert.equal(received.timezoneOffsetMinutes, -420)
  assert.equal(received.goal, 'Ưu tiên bảo vệ')
  assert.ok(received.signal instanceof AbortSignal)
})

test('POST /api/ai/planner/simulate từ chối mục tiêu quá dài', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), planner: fakePlanner() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/ai/planner/simulate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ dailyCapacityMinutes: 180, horizonDays: 14, timezoneOffsetMinutes: 0, goal: 'x'.repeat(501) })
    })
    assert.equal(res.status, 400)
  })
})

test('Route API không tồn tại trả 404', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/khong-ton-tai`, { headers: authHeaders(token) })
    assert.equal(res.status, 404)
  })
})

// --- /api/admin/* -----------------------------------------------------

// Root: không giới hạn phạm vi quản lý (canManage() luôn true), dùng cho các
// test hành vi "quản trị không giới hạn" đã có từ trước. Test riêng cho admin
// thường bị giới hạn phạm vi xem ở khối "phân quyền + gán quản lý" bên dưới.
function adminStore(overrides = {}) {
  return fakeStore({ async getUserById(id) { return { Id: id, Username: 'admin', Role: 'root', Disabled: false } }, ...overrides })
}

test('GET /api/admin/users trả 401 khi thiếu token', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`)
    assert.equal(res.status, 401)
  })
})

test('GET /api/admin/users trả 403 khi user thường (không phải admin) gọi', async () => {
  const store = fakeStore({ async getUserById(id) { return { Id: id, Username: 'thuong', Role: 'user' } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`, { headers: authHeaders(token) })
    assert.equal(res.status, 403)
  })
})

test('GET /api/admin/users trả danh sách khi là admin', async () => {
  const store = adminStore({ async getAllUsersWithStats() { return [{ id: 2, username: 'user2', noteCount: 3 }] } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.users.length, 1)
    assert.equal(body.users[0].noteCount, 3)
  })
})

test('GET /api/admin/users/:id/notes trả ghi chú của đúng user được yêu cầu (view-only)', async () => {
  let receivedId
  const store = adminStore({ async getAllNotes(userId) { receivedId = userId; return [{ serverId: 'x' }] } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/notes`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.equal(receivedId, 42)
    const body = await res.json()
    assert.equal(body.notes.length, 1)
  })
})

test('POST /api/admin/users tạo user mới thành công', async () => {
  const store = adminStore()
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ username: 'nhanvien1', password: '123456', email: 'nhanvien1@vidu.com' })
    })
    assert.equal(res.status, 201)
  })
})

test('PUT /api/admin/users/:id sửa displayName/email của user khác', async () => {
  let received
  const store = adminStore({ async updateUserByAdmin(userId, data) { received = { userId, ...data } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/7`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ displayName: 'Tên mới', email: 'moi@vidu.com' })
    })
    assert.equal(res.status, 200)
    assert.deepEqual(received, { userId: 7, displayName: 'Tên mới', email: 'moi@vidu.com' })
  })
})

test('POST /api/admin/users/:id/disable khóa được user khác', async () => {
  let received
  const store = adminStore({ async setUserDisabled(userId, disabled) { received = { userId, disabled } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/7/disable`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.deepEqual(received, { userId: 7, disabled: true })
  })
})

test('POST /api/admin/users/:id/disable từ chối (400) khi admin tự khóa chính mình', async () => {
  const store = adminStore()
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/1/disable`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 400)
  })
})

test('POST /api/admin/users/:id/enable mở khóa được user khác', async () => {
  let received
  const store = adminStore({ async setUserDisabled(userId, disabled) { received = { userId, disabled } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/7/enable`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.deepEqual(received, { userId: 7, disabled: false })
  })
})

test('POST /api/admin/users/:id/reset-password đặt mật khẩu mới cho user khác không cần biết mật khẩu cũ', async () => {
  let received
  const store = adminStore({ async updatePassword(userId, passwordHash) { received = { userId, passwordHash } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/7/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ newPassword: 'matkhaumoi' })
    })
    assert.equal(res.status, 200)
    assert.equal(received.userId, 7)
    assert.ok(received.passwordHash)
  })
})

test('/api/admin/* trả 401 khi admin đã bị Disabled (thu hồi quyền có hiệu lực ngay, không đợi token hết hạn)', async () => {
  const store = fakeStore({ async getUserById(id) { return { Id: id, Username: 'admin', Role: 'root', Disabled: true } } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'admin' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`, { headers: authHeaders(token) })
    assert.equal(res.status, 401)
  })
})

// --- Phân quyền admin thường + gán user để quản lý (chỉ root làm được) ----

// Admin thường (Id=9) - user Id=42 được root gán cho admin này quản lý
// (ManagedByAdminId=9), user Id=99 KHÔNG do admin này quản lý.
function scopedAdminStore(overrides = {}) {
  return fakeStore({
    async getUserById(id) {
      if (id === 9) return { Id: 9, Username: 'admin-thuong', Role: 'admin', Disabled: false }
      if (id === 42) return { Id: 42, Username: 'thanh-vien', Role: 'user', ManagedByAdminId: 9, Disabled: false }
      if (id === 99) return { Id: 99, Username: 'nguoi-la', Role: 'user', ManagedByAdminId: null, Disabled: false }
      return null
    },
    ...overrides
  })
}

test('GET /api/admin/users: admin thường chỉ thấy danh sách đã lọc theo phạm vi quản lý của mình', async () => {
  let receivedScope
  const store = scopedAdminStore({ async getAllUsersWithStats(scopeAdminId) { receivedScope = scopeAdminId; return [] } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.equal(receivedScope, 9)
  })
})

test('GET /api/admin/users: root thấy toàn bộ (không lọc phạm vi)', async () => {
  let receivedScope = 'chua-goi'
  const store = adminStore({ async getAllUsersWithStats(scopeAdminId) { receivedScope = scopeAdminId; return [] } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.equal(receivedScope, null)
  })
})

test('GET /api/admin/users/:id/notes: admin thường xem được ghi chú của user được giao quản lý', async () => {
  const store = scopedAdminStore({ async getAllNotes() { return [{ serverId: 'x' }] } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/notes`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
  })
})

test('GET /api/admin/users/:id/notes: admin thường bị chặn (403) khi xem user KHÔNG do mình quản lý', async () => {
  const store = scopedAdminStore()
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/99/notes`, { headers: authHeaders(token) })
    assert.equal(res.status, 403)
  })
})

test('GET /api/admin/users/:id/notes: trả 404 khi user không tồn tại', async () => {
  const store = scopedAdminStore()
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/12345/notes`, { headers: authHeaders(token) })
    assert.equal(res.status, 404)
  })
})

test('PUT /api/admin/users/:id: admin thường sửa được user do mình quản lý', async () => {
  const store = scopedAdminStore({ async updateUserByAdmin() {} })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ displayName: 'Tên mới', email: 'moi@vidu.com' })
    })
    assert.equal(res.status, 200)
  })
})

test('PUT /api/admin/users/:id: admin thường bị chặn (403) khi sửa user KHÔNG do mình quản lý', async () => {
  const store = scopedAdminStore({ async updateUserByAdmin() {} })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/99`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ displayName: 'Tên mới', email: 'moi@vidu.com' })
    })
    assert.equal(res.status, 403)
  })
})

test('POST /api/admin/users/:id/disable: admin thường khóa được user do mình quản lý, bị chặn với user khác', async () => {
  const store = scopedAdminStore({ async setUserDisabled() {} })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const ok = await fetch(`${base}/api/admin/users/42/disable`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(ok.status, 200)
    const blocked = await fetch(`${base}/api/admin/users/99/disable`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(blocked.status, 403)
  })
})

test('POST /api/admin/users: admin thường bị chặn (403) - chỉ root tạo được user mới qua trang quản trị', async () => {
  const store = scopedAdminStore()
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ username: 'moi', password: '123456', email: 'moi@vidu.com' })
    })
    assert.equal(res.status, 403)
  })
})

test('POST /api/admin/users/:id/promote: root phân quyền admin cho user thường thành công', async () => {
  let receivedId
  const store = adminStore({ async promoteToAdmin(userId) { receivedId = userId; return true } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/promote`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.equal(receivedId, 42)
  })
})

test('POST /api/admin/users/:id/promote: trả 400 khi target không phải user thường (store trả false)', async () => {
  const store = adminStore({ async promoteToAdmin() { return false } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/promote`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 400)
  })
})

test('POST /api/admin/users/:id/promote: admin thường bị chặn (403), không phải root', async () => {
  const store = scopedAdminStore({ async promoteToAdmin() { return true } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/promote`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 403)
  })
})

test('POST /api/admin/users/:id/demote: root hạ quyền admin thường về user, bỏ gán mọi user đang quản lý (do store xử lý)', async () => {
  let receivedId
  const store = adminStore({ async demoteToUser(userId) { receivedId = userId; return true } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/9/demote`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.equal(receivedId, 9)
  })
})

test('POST /api/admin/users/:id/demote: root không tự hạ quyền chính mình (400)', async () => {
  const store = adminStore()
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/1/demote`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 400)
  })
})

test('POST /api/admin/users/:id/assign: root gán user cho admin quản lý thành công', async () => {
  let received
  const store = adminStore({ async assignUserToAdmin(userId, adminId) { received = { userId, adminId }; return true } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ adminId: 9 })
    })
    assert.equal(res.status, 200)
    assert.deepEqual(received, { userId: 42, adminId: 9 })
  })
})

test('POST /api/admin/users/:id/assign: trả 400 khi gán không hợp lệ (target không phải user, hoặc adminId không phải admin - store trả false)', async () => {
  const store = adminStore({ async assignUserToAdmin() { return false } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ adminId: 9 })
    })
    assert.equal(res.status, 400)
  })
})

test('POST /api/admin/users/:id/assign: admin thường bị chặn (403), không phải root', async () => {
  const store = scopedAdminStore({ async assignUserToAdmin() { return true } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ adminId: 9 })
    })
    assert.equal(res.status, 403)
  })
})

test('POST /api/admin/users/:id/unassign: root bỏ gán user khỏi admin đang quản lý', async () => {
  let receivedId
  const store = adminStore({ async unassignUser(userId) { receivedId = userId; return true } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/unassign`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.equal(receivedId, 42)
  })
})

test('POST /api/admin/users/:id/unassign trả 404 nếu user không tồn tại và 400 nếu user không được gán', async () => {
  const token = signToken({ id: 1, username: 'root' })
  const missing = adminStore({ async getUserById(id) {
    return id === 1 ? { Id: 1, Username: 'root', Role: 'root', Disabled: false } : null
  } })
  await withServer(createApp(missing, { ai: fakeAi() }), async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/unassign`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 404)
  })

  const notAssigned = adminStore({ async unassignUser() { return false } })
  await withServer(createApp(notAssigned, { ai: fakeAi() }), async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/unassign`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 400)
  })
})

// --- Nhật ký hành động quản trị -------------------------------------------

test('POST /api/admin/users/:id/disable ghi đúng nhật ký (actor, target, action)', async () => {
  let logged
  const store = adminStore({ async logAdminAction(entry) { logged = entry } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/disable`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 200)
    assert.equal(logged.actorId, 1)
    assert.equal(logged.targetId, 42)
    assert.equal(logged.action, 'disable_user')
  })
})

test('POST /api/admin/users/:id/reset-password ghi nhật ký KHÔNG kèm mật khẩu mới', async () => {
  let logged
  const store = adminStore({ async logAdminAction(entry) { logged = entry } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    await fetch(`${base}/api/admin/users/42/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ newPassword: 'mat-khau-bi-mat-123' })
    })
    assert.equal(logged.action, 'reset_password')
    assert.equal(JSON.stringify(logged).includes('mat-khau-bi-mat-123'), false)
  })
})

test('POST /api/admin/users/:id/assign ghi nhật ký kèm tên admin được gán trong details', async () => {
  let logged
  const store = adminStore({
    async getUserById(id) {
      if (id === 1) return { Id: 1, Username: 'root', Role: 'root', Disabled: false } // chính actor đang gọi request
      if (id === 9) return { Id: 9, Username: 'admin-b', Role: 'admin' }
      return { Id: id, Username: 'thanh-vien-c', Role: 'user' }
    },
    async logAdminAction(entry) { logged = entry }
  })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    await fetch(`${base}/api/admin/users/42/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ adminId: 9 })
    })
    assert.equal(logged.action, 'assign')
    assert.match(logged.details, /admin-b/)
  })
})

test('Ghi nhật ký thất bại (store.logAdminAction ném lỗi) KHÔNG làm hỏng response chính đã thành công', async () => {
  const store = adminStore({ async setUserDisabled() {}, async logAdminAction() { throw new Error('DB nhật ký tạm lỗi') } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/users/42/disable`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(res.status, 200) // hành động chính vẫn thành công dù ghi log lỗi
  })
})

test('GET /api/admin/audit-log: root xem được nhật ký', async () => {
  const entries = [{ id: 1, actorUsername: 'root', targetUsername: 'x', action: 'disable_user', createdAt: Date.now() }]
  const store = adminStore({ async getAdminAuditLog() { return entries } })
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'root' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/audit-log`, { headers: authHeaders(token) })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.entries.length, 1)
  })
})

test('GET /api/admin/audit-log: admin thường bị chặn (403), chỉ root xem được', async () => {
  const store = scopedAdminStore()
  const app = createApp(store, { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/audit-log`, { headers: authHeaders(token) })
    assert.equal(res.status, 403)
  })
})

// --- Giao thức đồng bộ v3: xung đột theo Version + tải delta theo con trỏ ---

function syncNote(overrides = {}) {
  return { id: 1, serverId: 's1', title: 'T', content: '', tag: 'chung', done: false, deleted: 0,
    updatedAt: 1000, kind: 'note', createdAt: 900, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
    baseVersion: null, ...overrides }
}

async function postSync(base, token, notes, version = '3') {
  return fetch(`${base}/api/notes/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Version': version, ...authHeaders(token) },
    body: JSON.stringify({ notes })
  })
}

test('GET /api/notes/protocol trả version 3', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/notes/protocol`, { headers: authHeaders(token) })
    assert.deepEqual(await res.json(), { version: 3 })
  })
})

test('POST /api/notes/sync chặn client v2 cũ (không có baseVersion) bằng 409', async () => {
  let called = false
  const app = createApp(fakeStore({ async upsertNote() { called = true; return { status: 'applied', version: 1 } } }), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await postSync(base, token, [syncNote()], '2')
    assert.equal(res.status, 409)
    assert.equal(called, false)
  })
})

test('POST /api/notes/sync trả 400 khi thiếu baseVersion dù header đúng v3', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  const { baseVersion, ...withoutBase } = syncNote()
  await withServer(app, async (base) => {
    const res = await postSync(base, token, [withoutBase])
    assert.equal(res.status, 400)
  })
})

test('POST /api/notes/sync chuyển đúng baseVersion xuống store và trả version mới', async () => {
  let received
  const app = createApp(fakeStore({ async upsertNote(note) { received = note.baseVersion; return { status: 'applied', version: 5 } } }), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await postSync(base, token, [syncNote({ baseVersion: 4 })])
    assert.equal(received, 4)
    assert.deepEqual((await res.json()).results, [{ localId: 1, serverId: 's1', status: 'applied', version: 5 }])
  })
})

test('POST /api/notes/sync trả conflict kèm bản trên server, không ghi đè', async () => {
  const server = { serverId: 's1', title: 'Bản thiết bị khác', content: '', tag: 'chung', kind: 'note', done: false, deleted: 0,
    createdAt: 900, startAt: null, dueAt: null, completedAt: null, deletedAt: null, updatedAt: 2000, version: 3 }
  const app = createApp(fakeStore({ async upsertNote() { return { status: 'conflict', server } } }), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await postSync(base, token, [syncNote({ baseVersion: 2 })])
    assert.equal(res.status, 200)
    assert.deepEqual((await res.json()).results, [{ localId: 1, serverId: 's1', status: 'conflict', server }])
  })
})

test('POST /api/notes/sync trả rejected khi ServerId thuộc tài khoản khác', async () => {
  const app = createApp(fakeStore({ async upsertNote() { return { status: 'rejected' } } }), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await postSync(base, token, [syncNote()])
    assert.deepEqual((await res.json()).results, [{ localId: 1, serverId: 's1', status: 'rejected' }])
  })
})

test('GET /api/notes truyền con trỏ since + kích thước trang xuống store, mặc định since=0', async () => {
  const calls = []
  const app = createApp(fakeStore({ async getNotesSince(userId, since, limit) { calls.push([userId, since, limit]); return { notes: [], cursor: since, hasMore: false, reset: false } } }), { ai: fakeAi() })
  const token = signToken({ id: 9, username: 'u9' })
  await withServer(app, async (base) => {
    await fetch(`${base}/api/notes`, { headers: authHeaders(token) })
    await fetch(`${base}/api/notes?since=12345`, { headers: authHeaders(token) })
    await fetch(`${base}/api/notes?since=007`, { headers: authHeaders(token) })
  })
  assert.deepEqual(calls, [[9, '0', 500], [9, '12345', 500], [9, '7', 500]])
})

test('GET /api/notes trả nguyên body delta (notes, cursor, hasMore, reset)', async () => {
  const page = { notes: [{ serverId: 'a' }], cursor: '99', hasMore: true, reset: false }
  const app = createApp(fakeStore({ async getNotesSince() { return page } }), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/notes?since=10`, { headers: authHeaders(token) })
    assert.deepEqual(await res.json(), page)
  })
})

test('GET /api/notes từ chối con trỏ since sai định dạng (400), không gọi store', async () => {
  let called = false
  const app = createApp(fakeStore({ async getNotesSince() { called = true; return { notes: [], cursor: '0', hasMore: false, reset: false } } }), { ai: fakeAi() })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    for (const q of ['since=abc', 'since=-1', 'since=1.5', 'since=', 'since=9223372036854775808', 'since=12345678901234567890', 'since=1&since=2']) {
      const res = await fetch(`${base}/api/notes?${q}`, { headers: authHeaders(token) })
      assert.equal(res.status, 400, q)
    }
  })
  assert.equal(called, false)
})

// --- Nhắc việc bằng Web Push ---

function fakePush(overrides = {}) {
  return { isConfigured: () => true, publicKey: () => 'PUBKEY', async send() { return 'sent' }, ...overrides }
}
const PUSH_SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPx-_aa', auth: 'xyz_-1' } }
async function jsonCall(base, token, path, method = 'GET', body) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: body && JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

test('các route /api/push/* đều yêu cầu đăng nhập', async () => {
  const app = createApp(fakeStore(), { ai: fakeAi(), push: fakePush() })
  await withServer(app, async (base) => {
    for (const [path, method] of [['/api/push/config', 'GET'], ['/api/push/subscribe', 'POST'], ['/api/push/unsubscribe', 'POST'], ['/api/push/settings', 'PUT'], ['/api/push/test', 'POST']]) {
      const res = await fetch(`${base}${path}`, { method })
      assert.equal(res.status, 401, path)
    }
  })
})

test('GET /api/push/config trả trạng thái bật, khóa công khai, số phút nhắc trước và thiết bị này đã đăng ký chưa', async () => {
  let args
  const store = fakeStore({ async getReminderSettings(userId, endpoint) { args = [userId, endpoint]; return { leadMinutes: 30, subscribed: true } } })
  const app = createApp(store, { ai: fakeAi(), push: fakePush() })
  const token = signToken({ id: 4, username: 'u4' })
  await withServer(app, async (base) => {
    const r = await jsonCall(base, token, `/api/push/config?endpoint=${encodeURIComponent(PUSH_SUB.endpoint)}`)
    assert.deepEqual(r.body, { enabled: true, publicKey: 'PUBKEY', leadMinutes: 30, subscribed: true })
  })
  assert.deepEqual(args, [4, PUSH_SUB.endpoint])
})

test('GET /api/push/config báo enabled=false khi chưa cấu hình VAPID', async () => {
  const store = fakeStore({ async getReminderSettings() { return { leadMinutes: 15, subscribed: false } } })
  const app = createApp(store, { ai: fakeAi(), push: fakePush({ isConfigured: () => false, publicKey: () => null }) })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(app, async (base) => {
    const r = await jsonCall(base, token, '/api/push/config')
    assert.equal(r.body.enabled, false)
    assert.equal(r.body.publicKey, null)
  })
})

test('POST /api/push/subscribe lưu đăng ký gắn đúng tài khoản trong token', async () => {
  let saved
  const store = fakeStore({ async savePushSubscription(userId, data) { saved = [userId, data] } })
  const app = createApp(store, { ai: fakeAi(), push: fakePush() })
  const token = signToken({ id: 8, username: 'u8' })
  await withServer(app, async (base) => {
    const r = await jsonCall(base, token, '/api/push/subscribe', 'POST', { subscription: PUSH_SUB })
    assert.equal(r.status, 200)
  })
  assert.deepEqual(saved, [8, { endpoint: PUSH_SUB.endpoint, p256dh: 'BPx-_aa', auth: 'xyz_-1' }])
})

test('POST /api/push/subscribe từ chối endpoint ngoài dịch vụ push (SSRF) và khi chưa cấu hình VAPID', async () => {
  let called = false
  const store = fakeStore({ async savePushSubscription() { called = true } })
  const token = signToken({ id: 1, username: 'tester' })
  await withServer(createApp(store, { ai: fakeAi(), push: fakePush() }), async (base) => {
    const r = await jsonCall(base, token, '/api/push/subscribe', 'POST', { subscription: { ...PUSH_SUB, endpoint: 'http://127.0.0.1:1433/' } })
    assert.equal(r.status, 400)
  })
  await withServer(createApp(store, { ai: fakeAi(), push: fakePush({ isConfigured: () => false }) }), async (base) => {
    const r = await jsonCall(base, token, '/api/push/subscribe', 'POST', { subscription: PUSH_SUB })
    assert.equal(r.status, 503)
    assert.match(r.body.error, /VAPID/)
  })
  assert.equal(called, false)
})

test('POST /api/push/unsubscribe chỉ xóa đăng ký của chính người gọi', async () => {
  let args
  const store = fakeStore({ async deletePushSubscription(userId, endpoint) { args = [userId, endpoint] } })
  const token = signToken({ id: 6, username: 'u6' })
  await withServer(createApp(store, { ai: fakeAi(), push: fakePush() }), async (base) => {
    assert.equal((await jsonCall(base, token, '/api/push/unsubscribe', 'POST', { endpoint: PUSH_SUB.endpoint })).status, 200)
    assert.equal((await jsonCall(base, token, '/api/push/unsubscribe', 'POST', {})).status, 400)
  })
  assert.deepEqual(args, [6, PUSH_SUB.endpoint])
})

test('PUT /api/push/settings chỉ nhận các mốc nhắc trước cho phép', async () => {
  const saved = []
  const store = fakeStore({ async setReminderLeadMinutes(userId, m) { saved.push([userId, m]) } })
  const token = signToken({ id: 2, username: 'u2' })
  await withServer(createApp(store, { ai: fakeAi(), push: fakePush() }), async (base) => {
    assert.equal((await jsonCall(base, token, '/api/push/settings', 'PUT', { leadMinutes: 30 })).status, 200)
    for (const bad of [7, -5, '15', null, 99999, 15.5]) {
      assert.equal((await jsonCall(base, token, '/api/push/settings', 'PUT', { leadMinutes: bad })).status, 400, String(bad))
    }
  })
  assert.deepEqual(saved, [[2, 30]])
})

test('POST /api/push/test gửi tới thiết bị của người gọi, 400 khi chưa có thiết bị nào', async () => {
  const sent = []
  const push = fakePush({ async send(sub, payload) { sent.push([sub.endpoint, payload.type]); return 'sent' } })
  const token = signToken({ id: 5, username: 'u5' })
  let subs = [{ endpoint: 'e1', keys: {} }]
  const store = fakeStore({ async getPushSubscriptions(userId) { assert.equal(userId, 5); return subs } })
  await withServer(createApp(store, { ai: fakeAi(), push }), async (base) => {
    const ok = await jsonCall(base, token, '/api/push/test', 'POST')
    assert.deepEqual(ok.body, { sent: 1, failed: 0, total: 1 })
    subs = []
    assert.equal((await jsonCall(base, token, '/api/push/test', 'POST')).status, 400)
  })
  assert.deepEqual(sent, [['e1', 'test']])
})

// --- Chặn đăng nhập theo tài khoản sau nhiều lần sai mật khẩu ---

// Store giả CÓ TRẠNG THÁI, cùng quy tắc với store.recordFailedLogin (SQL):
// đếm lại từ 1 khi lần sai trước quá cửa sổ hoặc lần chặn trước đã hết hạn.
async function lockingStore(overrides = {}) {
  const passwordHash = await hashPassword('dungmatkhau')
  const users = new Map([['target', { Id: 1, Username: 'target', PasswordHash: passwordHash, DisplayName: 'Target', Role: 'user', Disabled: false, FailedLoginCount: 0, LastFailedLoginAt: null, LoginLockedUntil: null }]])
  const byId = id => [...users.values()].find(u => u.Id === id)
  return {
    users,
    store: fakeStore({
      async getUserByUsername(username) { const u = users.get(username.toLowerCase()); return u ? { ...u } : null },
      async recordFailedLogin(userId, now, { maxAttempts, windowMs, lockMs }) {
        const u = byId(userId)
        const reset = (u.LoginLockedUntil !== null && u.LoginLockedUntil <= now) || u.LastFailedLoginAt === null || now - u.LastFailedLoginAt > windowMs
        u.FailedLoginCount = reset ? 1 : u.FailedLoginCount + 1
        u.LastFailedLoginAt = now
        u.LoginLockedUntil = u.FailedLoginCount >= maxAttempts ? now + lockMs : null
        return { count: u.FailedLoginCount, lockedUntil: u.LoginLockedUntil }
      },
      async clearLoginLock(userId) { Object.assign(byId(userId), { FailedLoginCount: 0, LastFailedLoginAt: null, LoginLockedUntil: null }) },
      ...overrides
    })
  }
}
const loginAs = (base, username, password) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
})

test('đăng nhập sai: báo số lượt còn lại giảm dần 4 -> 1, lần thứ 5 thì chặn (429)', async () => {
  const { store, users } = await lockingStore()
  await withServer(createApp(store, { ai: fakeAi() }), async (base) => {
    for (const remaining of [4, 3, 2, 1]) {
      const res = await loginAs(base, 'target', 'saimatkhau')
      assert.equal(res.status, 401)
      const body = await res.json()
      assert.equal(body.remainingAttempts, remaining)
      assert.match(body.error, new RegExp(`còn ${remaining} lượt`))
    }
    const locked = await loginAs(base, 'target', 'saimatkhau')
    assert.equal(locked.status, 429)
    const body = await locked.json()
    assert.match(body.error, /tạm bị chặn đăng nhập.*15 phút.*quản trị viên/)
    assert.ok(body.lockedUntil > Date.now())
  })
  assert.equal(users.get('target').FailedLoginCount, 5)
})

test('đang bị chặn thì nhập ĐÚNG mật khẩu cũng không vào được, không kiểm tra mật khẩu', async () => {
  const { store, users } = await lockingStore()
  users.get('target').LoginLockedUntil = Date.now() + 60000
  users.get('target').FailedLoginCount = 5
  await withServer(createApp(store, { ai: fakeAi() }), async (base) => {
    const res = await loginAs(base, 'target', 'dungmatkhau')
    assert.equal(res.status, 429)
  })
})

test('hết thời gian chặn thì tự mở, đăng nhập đúng được và bộ đếm về 0', async () => {
  const { store, users } = await lockingStore()
  await withServer(createApp(store, { ai: fakeAi(), loginLimiterOptions: { maxAttempts: 2, lockMs: 40 } }), async (base) => {
    await loginAs(base, 'target', 'saimatkhau')
    assert.equal((await loginAs(base, 'target', 'saimatkhau')).status, 429)
    await new Promise(r => setTimeout(r, 60))
    assert.equal((await loginAs(base, 'target', 'dungmatkhau')).status, 200)
  })
  assert.equal(users.get('target').FailedLoginCount, 0)
  assert.equal(users.get('target').LoginLockedUntil, null)
})

test('đăng nhập đúng khi chưa hết lượt thì thành công và đặt lại bộ đếm', async () => {
  const { store, users } = await lockingStore()
  await withServer(createApp(store, { ai: fakeAi() }), async (base) => {
    await loginAs(base, 'target', 'saimatkhau')
    await loginAs(base, 'target', 'saimatkhau')
    assert.equal((await loginAs(base, 'target', 'dungmatkhau')).status, 200)
    const res = await loginAs(base, 'target', 'saimatkhau')
    assert.equal((await res.json()).remainingAttempts, 4) // đếm lại từ đầu
  })
  assert.equal(users.get('target').FailedLoginCount, 1)
})

test('mật khẩu quá ngắn cũng tính là 1 lần sai', async () => {
  const { store } = await lockingStore()
  await withServer(createApp(store, { ai: fakeAi() }), async (base) => {
    const res = await loginAs(base, 'target', '123')
    assert.equal(res.status, 401)
    assert.equal((await res.json()).remainingAttempts, 4)
  })
})

test('tên đăng nhập KHÔNG tồn tại nhận phản hồi y hệt tài khoản thật (không lộ tên nào đã đăng ký)', async () => {
  const { store } = await lockingStore()
  await withServer(createApp(store, { ai: fakeAi() }), async (base) => {
    for (const remaining of [4, 3, 2, 1]) {
      const [real, ghost] = await Promise.all([loginAs(base, 'target', 'saimatkhau'), loginAs(base, 'khongco', 'saimatkhau')])
      const [a, b] = [await real.json(), await ghost.json()]
      assert.equal(real.status, ghost.status)
      assert.equal(a.error, b.error)
      assert.equal(b.remainingAttempts, remaining)
    }
    const [real, ghost] = await Promise.all([loginAs(base, 'target', 'saimatkhau'), loginAs(base, 'khongco', 'saimatkhau')])
    assert.equal(real.status, 429)
    assert.equal(ghost.status, 429)
    assert.equal((await real.json()).error, (await ghost.json()).error)
  })
})

test('bị chặn 1 tài khoản không ảnh hưởng tài khoản khác', async () => {
  const { store, users } = await lockingStore()
  users.set('khac', { ...users.get('target'), Id: 2, Username: 'khac' })
  await withServer(createApp(store, { ai: fakeAi() }), async (base) => {
    for (let i = 0; i < 5; i++) await loginAs(base, 'target', 'saimatkhau')
    assert.equal((await loginAs(base, 'target', 'dungmatkhau')).status, 429)
    assert.equal((await loginAs(base, 'khac', 'dungmatkhau')).status, 200)
  })
})

test('POST /api/admin/users/:id/unlock-login: admin mở chặn được user mình quản lý, ghi nhật ký', async () => {
  const cleared = [], logged = []
  const store = scopedAdminStore({ async clearLoginLock(id) { cleared.push(id) }, async logAdminAction(entry) { logged.push(entry.action) } })
  const token = signToken({ id: 9, username: 'admin-thuong' })
  await withServer(createApp(store, { ai: fakeAi() }), async (base) => {
    const ok = await fetch(`${base}/api/admin/users/42/unlock-login`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(ok.status, 200)
    const denied = await fetch(`${base}/api/admin/users/99/unlock-login`, { method: 'POST', headers: authHeaders(token) })
    assert.equal(denied.status, 403) // không phải user mình quản lý
  })
  assert.deepEqual(cleared, [42])
  assert.deepEqual(logged, ['unlock_login'])
})

test('POST /api/admin/users/:id/unlock-login: root mở chặn được mọi tài khoản; user thường bị 403', async () => {
  const cleared = []
  const rootStore = adminStore({ async clearLoginLock(id) { cleared.push(id) } })
  await withServer(createApp(rootStore, { ai: fakeAi() }), async (base) => {
    const res = await fetch(`${base}/api/admin/users/77/unlock-login`, { method: 'POST', headers: authHeaders(signToken({ id: 1, username: 'root' })) })
    assert.equal(res.status, 200)
  })
  assert.deepEqual(cleared, [77])
  await withServer(createApp(fakeStore(), { ai: fakeAi() }), async (base) => {
    const res = await fetch(`${base}/api/admin/users/77/unlock-login`, { method: 'POST', headers: authHeaders(signToken({ id: 5, username: 'thuong' })) })
    assert.equal(res.status, 403)
  })
})
