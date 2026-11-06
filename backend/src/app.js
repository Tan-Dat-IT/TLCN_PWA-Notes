import './env.js'
import express from 'express'
import cors from 'cors'
import { validNote } from './validation.js'
import {
  hashPassword, verifyPassword, signToken, createRequireAuth, validUsername, validPassword,
  validEmail, createResetToken, hashResetToken, createRequireAdmin, requireRoot
} from './auth.js'
import { createFailureTracker, createIpLimiter, LOGIN_POLICY } from './rateLimit.js'
import * as defaultAi from './ai.js'
import { basicDraft } from './ai.js'
import * as defaultKnowledge from './knowledge.js'
import * as defaultPlanner from './planner.js'
import * as defaultMailer from './mailer.js'
import * as defaultPush from './push.js'
import { validSubscription, sendToUser } from './push.js'
import { fileURLToPath } from 'node:url'

const RESET_TOKEN_TTL_MS = (Number(process.env.RESET_TOKEN_TTL_MIN) || 30) * 60 * 1000
export const SYNC_VERSION = 3
const NOTES_PAGE_SIZE = 500
// Các lựa chọn "nhắc trước hạn" (phút) - khớp REMINDER_LEAD_OPTIONS ở frontend.
export const REMINDER_LEAD_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440]

export function createApp(store, {
  serveFrontend = false, ai = defaultAi, knowledge = defaultKnowledge, planner = defaultPlanner, mailer = defaultMailer, push = defaultPush,
  loginLimiterOptions, registerLimiterOptions, forgotPasswordLimiterOptions
} = {}) {
  const app = express()
  app.disable('x-powered-by')
  // Chỉ tin header X-Forwarded-For khi thật sự chạy sau reverse proxy đã cấu
  // hình (mục 6 README, đặt TRUST_PROXY=true). Mặc định KHÔNG tin - nếu
  // backend lộ trực tiếp (không qua proxy) mà tin header này, ai cũng có thể
  // giả header để né rate limit theo IP.
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false)
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    next()
  })
  app.use(cors({ origin: allowedOrigins, allowedHeaders: ['Content-Type', 'X-Sync-Version', 'Authorization'] }))
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  const loginPolicy = { ...LOGIN_POLICY, ...loginLimiterOptions }
  const unknownUserFailures = createFailureTracker(loginPolicy)
  const lockedMessage = (lockedUntil, now) => {
    const minutes = Math.max(1, Math.ceil((lockedUntil - now) / 60000))
    return `Tài khoản tạm bị chặn đăng nhập do nhập sai mật khẩu ${loginPolicy.maxAttempts} lần. Thử lại sau ${minutes} phút, hoặc liên hệ quản trị viên để được mở chặn.`
  }
  const registerLimiter = createIpLimiter(registerLimiterOptions)
  const forgotPasswordLimiter = createIpLimiter({ maxRequests: 5, windowMs: 60 * 60 * 1000, ...forgotPasswordLimiterOptions })
  const requireAuth = createRequireAuth(store)
  const requireAdmin = createRequireAdmin(store)

  app.post('/api/auth/register', registerLimiter, async (req, res, next) => {
    const { username, password, displayName, email } = req.body || {}
    const normalizedEmail = typeof email === 'string' ? email.trim() : email
    const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : displayName
    if (!validUsername(username) || !validPassword(password) || !validEmail(normalizedEmail) ||
        (normalizedDisplayName !== undefined && (typeof normalizedDisplayName !== 'string' || normalizedDisplayName.length > 100))) {
      return res.status(400).json({ error: 'Tên đăng nhập (3-50 ký tự chữ/số/._-), mật khẩu (>=6 ký tự) hoặc email không hợp lệ - email là bắt buộc khi đăng ký.' })
    }
    try {
      const user = await store.createUser({ username, passwordHash: await hashPassword(password), displayName: normalizedDisplayName, email: normalizedEmail })
      res.status(201).json({ token: signToken({ id: user.Id, username: user.Username }), user: { id: user.Id, username: user.Username, displayName: user.DisplayName, email: user.Email || null, role: user.Role } })
    } catch (error) {
      if (error.number === 50002) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' })
      if (error.number === 50003) return res.status(409).json({ error: 'Email này đã được dùng cho tài khoản khác.' })
      next(error)
    }
  })

  // Đăng nhập sai: báo số lượt còn lại; hết lượt thì chặn đăng nhập tài khoản
  // (LOGIN_POLICY: 5 lượt, tự mở sau 15 phút; admin quản lý tài khoản hoặc root
  // mở sớm được - POST /api/admin/users/:id/unlock-login). Đếm theo TÀI KHOẢN
  // trong SQL. Tên đăng nhập không tồn tại được đếm y hệt trong RAM để câu trả
  // lời không để lộ tên nào có thật.
  app.post('/api/auth/login', async (req, res, next) => {
    const { username, password } = req.body || {}
    // Tên đăng nhập sai định dạng thì không thể là tài khoản nào -> không cần đếm.
    if (!validUsername(username) || typeof password !== 'string' || password.length > 200) {
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' })
    }
    const now = Date.now()
    const ghostKey = username.toLowerCase()
    try {
      const user = await store.getUserByUsername(username)
      const lockedUntil = user ? (user.LoginLockedUntil === null || user.LoginLockedUntil === undefined ? null : Number(user.LoginLockedUntil)) : unknownUserFailures.lockedUntil(ghostKey, now)
      // Đang bị chặn: từ chối luôn, không kiểm tra mật khẩu (đoán đúng cũng không vào được).
      if (lockedUntil !== null && lockedUntil > now) return res.status(429).json({ error: lockedMessage(lockedUntil, now), lockedUntil })
      // Mật khẩu quá ngắn cũng tính là 1 lần sai như mọi lần sai khác.
      if (!user || !validPassword(password) || !(await verifyPassword(password, user.PasswordHash))) {
        const result = user ? await store.recordFailedLogin(user.Id, now, loginPolicy) : unknownUserFailures.fail(ghostKey, now)
        if (result.lockedUntil) return res.status(429).json({ error: lockedMessage(result.lockedUntil, now), lockedUntil: result.lockedUntil })
        const remaining = loginPolicy.maxAttempts - result.count
        return res.status(401).json({
          error: `Sai tên đăng nhập hoặc mật khẩu. Bạn còn ${remaining} lượt thử trước khi tài khoản bị tạm chặn đăng nhập.`,
          remainingAttempts: remaining
        })
      }
      if (user.Disabled) {
        return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.' })
      }
      if (user.FailedLoginCount > 0 || lockedUntil !== null) await store.clearLoginLock(user.Id)
      res.json({ token: signToken({ id: user.Id, username: user.Username }), user: { id: user.Id, username: user.Username, displayName: user.DisplayName, email: user.Email || null, role: user.Role } })
    } catch (error) { next(error) }
  })

  app.get('/api/auth/me', requireAuth, async (req, res, next) => {
    try {
      // requireAuth đã tải user hiện tại từ DB; dùng chính dữ liệu đó để trả
      // email/role/displayName mới nhất và tránh thêm một query trùng lặp.
      const user = req.authUser
      res.json({ user: { id: user.Id, username: user.Username, displayName: user.DisplayName, email: user.Email || null, role: user.Role || 'user' } })
    } catch (error) { next(error) }
  })

  app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
    const { currentPassword, newPassword } = req.body || {}
    if (!validPassword(currentPassword) || !validPassword(newPassword)) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại/mới không hợp lệ (>=6 ký tự).' })
    }
    try {
      const user = await store.getUserById(req.user.sub)
      if (!user || !(await verifyPassword(currentPassword, user.PasswordHash))) {
        return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' })
      }
      await store.updatePassword(user.Id, await hashPassword(newPassword))
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.post('/api/auth/email', requireAuth, async (req, res, next) => {
    const { email } = req.body || {}
    const normalizedEmail = typeof email === 'string' ? email.trim() : email
    if (!validEmail(normalizedEmail)) return res.status(400).json({ error: 'Email không hợp lệ.' })
    try {
      // Store kiểm tra trùng và UPDATE trong cùng transaction có khóa dải,
      // tránh race giữa một câu SELECT trước và câu UPDATE sau.
      await store.updateEmail(req.user.sub, normalizedEmail)
      res.json({ ok: true })
    } catch (error) {
      if (error.number === 50003) return res.status(409).json({ error: 'Email này đã được dùng cho tài khoản khác.' })
      next(error)
    }
  })

  // Quên mật khẩu: không tiết lộ email có tồn tại trong hệ thống hay không -
  // luôn trả cùng một thông báo, chỉ gửi mail thật khi tìm thấy tài khoản
  // khớp. Lỗi gửi mail (SMTP chưa cấu hình, sai app password...) chỉ log ở
  // server, không lộ ra response để tránh dò email hợp lệ qua sự khác biệt.
  app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
    const { email } = req.body || {}
    const normalizedEmail = typeof email === 'string' ? email.trim() : email
    if (!validEmail(normalizedEmail)) return res.status(400).json({ error: 'Email không hợp lệ.' })
    const genericResponse = { ok: true, message: 'Nếu email tồn tại trong hệ thống, một link đặt lại mật khẩu đã được gửi tới email đó (kiểm tra cả mục spam).' }
    try {
      const user = await store.getUserByEmail(normalizedEmail)
      if (user) {
        const token = createResetToken()
        await store.setResetToken(user.Id, hashResetToken(token), Date.now() + RESET_TOKEN_TTL_MS)
        const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:4000').replace(/\/$/, '')
        mailer.sendResetPasswordEmail(normalizedEmail, `${baseUrl}/?resetToken=${token}`)
          .catch(error => console.error('Gửi email đặt lại mật khẩu thất bại:', error.message))
      }
      res.json(genericResponse)
    } catch (error) { next(error) }
  })

  app.post('/api/auth/reset-password', async (req, res, next) => {
    const { token, newPassword } = req.body || {}
    if (typeof token !== 'string' || !token || token.length > 128 || !validPassword(newPassword)) {
      return res.status(400).json({ error: 'Token hoặc mật khẩu mới không hợp lệ.' })
    }
    try {
      const ok = await store.resetPasswordWithToken(hashResetToken(token), await hashPassword(newPassword), Date.now())
      if (!ok) return res.status(400).json({ error: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu link mới.' })
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  // Quản trị 2 cấp: 'root' (đúng 1 tài khoản, tạo qua `npm run make-admin`,
  // không có endpoint tự phong) toàn quyền trên mọi user; 'admin' (được root
  // phân quyền + gán thành viên) chỉ xem/sửa/khóa được user có
  // ManagedByAdminId đúng bằng chính họ - không tự mở rộng phạm vi được.
  // Cả 2 cấp đều View-only trên NỘI DUNG ghi chú của user khác - không có
  // route sửa/xóa từng ghi chú thay người dùng, giữ đúng ranh giới cô lập dữ
  // liệu đã thiết kế ở mục 23.1; admin chỉ quản lý TÀI KHOẢN.

  // true nếu actingAdmin được thao tác trên targetUser: root luôn được; admin
  // thường chỉ khi targetUser đang do chính họ quản lý (root gán từ trước).
  function canManage(actingAdmin, targetUser) {
    return actingAdmin.Role === 'root' || targetUser.ManagedByAdminId === actingAdmin.Id
  }

  // Dùng chung cho các route /admin/users/:id/* cần kiểm tra phạm vi quản lý
  // trước khi cho thao tác - trả về target user nếu hợp lệ, tự trả response
  // lỗi (404/403) và trả về null nếu không, để route handler return sớm.
  async function loadManagedTarget(req, res) {
    const userId = Number(req.params.id)
    if (!Number.isInteger(userId) || userId < 1) { res.status(400).json({ error: 'Id user không hợp lệ.' }); return null }
    const target = await store.getUserById(userId)
    if (!target) { res.status(404).json({ error: 'Không tìm thấy user.' }); return null }
    if (!canManage(req.actingAdmin, target)) { res.status(403).json({ error: 'Bạn không quản lý tài khoản này.' }); return null }
    return target
  }

  // Ghi nhật ký sau khi 1 hành động quản trị đã THÀNH CÔNG - cố ý không
  // await/chặn response chính vì việc log thất bại (ví dụ SQL tạm gián đoạn)
  // không được làm hỏng hành động đã thực hiện xong, chỉ log ra console để
  // biết mà xử lý riêng (giống cách xử lý lỗi gửi mail ở forgot-password).
  function logAction(req, action, target, details = null) {
    try {
      Promise.resolve(store.logAdminAction({
        actorId: req.actingAdmin.Id, actorUsername: req.actingAdmin.Username,
        targetId: target?.Id ?? target?.id ?? null, targetUsername: target?.Username ?? target?.username ?? null,
        action, details
      })).catch(error => console.error('Ghi nhật ký quản trị thất bại:', error.message))
    } catch (error) { console.error('Ghi nhật ký quản trị thất bại:', error.message) }
  }

  app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const scopeAdminId = req.actingAdmin.Role === 'root' ? null : req.actingAdmin.Id
      res.json({ users: await store.getAllUsersWithStats(scopeAdminId) })
    } catch (error) { next(error) }
  })

  app.get('/api/admin/users/:id/notes', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const target = await loadManagedTarget(req, res)
      if (!target) return
      res.json({ notes: await store.getAllNotes(target.Id) })
    } catch (error) { next(error) }
  })

  // Chỉ root tạo được tài khoản mới qua trang quản trị - admin thường chỉ
  // quản lý thành viên đã được root gán sẵn, không tự thêm người được.
  app.post('/api/admin/users', requireAuth, requireAdmin, requireRoot, async (req, res, next) => {
    const { username, password, displayName, email } = req.body || {}
    const normalizedEmail = typeof email === 'string' ? email.trim() : email
    const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : displayName
    if (!validUsername(username) || !validPassword(password) || !validEmail(normalizedEmail) ||
        (normalizedDisplayName !== undefined && (typeof normalizedDisplayName !== 'string' || normalizedDisplayName.length > 100))) {
      return res.status(400).json({ error: 'Tên đăng nhập, mật khẩu hoặc email không hợp lệ - email là bắt buộc.' })
    }
    try {
      const user = await store.createUser({ username, passwordHash: await hashPassword(password), displayName: normalizedDisplayName, email: normalizedEmail })
      logAction(req, 'create_user', user)
      res.status(201).json({ user: { id: user.Id, username: user.Username, displayName: user.DisplayName, email: user.Email || null } })
    } catch (error) {
      if (error.number === 50002) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' })
      if (error.number === 50003) return res.status(409).json({ error: 'Email này đã được dùng cho tài khoản khác.' })
      next(error)
    }
  })

  app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
    const { displayName, email } = req.body || {}
    const normalizedEmail = typeof email === 'string' ? email.trim() : email
    const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : displayName
    if (!validEmail(normalizedEmail) || typeof normalizedDisplayName !== 'string' || !normalizedDisplayName || normalizedDisplayName.length > 100) {
      return res.status(400).json({ error: 'Tên hiển thị hoặc email không hợp lệ.' })
    }
    try {
      const target = await loadManagedTarget(req, res)
      if (!target) return
      await store.updateUserByAdmin(target.Id, { displayName: normalizedDisplayName, email: normalizedEmail })
      logAction(req, 'edit_user', target, `Tên hiển thị: "${normalizedDisplayName}", Email: "${normalizedEmail}"`)
      res.json({ ok: true })
    } catch (error) {
      if (error.number === 50003) return res.status(409).json({ error: 'Email này đã được dùng cho tài khoản khác.' })
      next(error)
    }
  })

  app.post('/api/admin/users/:id/disable', requireAuth, requireAdmin, async (req, res, next) => {
    const userId = Number(req.params.id)
    if (userId === req.user.sub) return res.status(400).json({ error: 'Không thể tự khóa chính tài khoản admin đang đăng nhập.' })
    try {
      const target = await loadManagedTarget(req, res)
      if (!target) return
      await store.setUserDisabled(target.Id, true)
      logAction(req, 'disable_user', target)
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.post('/api/admin/users/:id/enable', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const target = await loadManagedTarget(req, res)
      if (!target) return
      await store.setUserDisabled(target.Id, false)
      logAction(req, 'enable_user', target)
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  // Mở chặn đăng nhập do nhập sai mật khẩu nhiều lần (khác 'enable' - mở khóa thủ
  // công Disabled). Admin thường chỉ mở cho tài khoản do mình quản lý, root mở
  // mọi tài khoản (kể cả admin) - dùng chung kiểm tra phạm vi loadManagedTarget.
  app.post('/api/admin/users/:id/unlock-login', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const target = await loadManagedTarget(req, res)
      if (!target) return
      await store.clearLoginLock(target.Id)
      logAction(req, 'unlock_login', target)
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res, next) => {
    const { newPassword } = req.body || {}
    if (!validPassword(newPassword)) return res.status(400).json({ error: 'Mật khẩu mới không hợp lệ.' })
    try {
      const target = await loadManagedTarget(req, res)
      if (!target) return
      await store.updatePassword(target.Id, await hashPassword(newPassword))
      logAction(req, 'reset_password', target) // KHÔNG log mật khẩu mới, chỉ log hành động + đối tượng
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  // --- Chỉ root: phân/hạ quyền admin, gán/bỏ gán user cho admin quản lý ---

  app.post('/api/admin/users/:id/promote', requireAuth, requireAdmin, requireRoot, async (req, res, next) => {
    const userId = Number(req.params.id)
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Id user không hợp lệ.' })
    try {
      const ok = await store.promoteToAdmin(userId)
      if (!ok) return res.status(400).json({ error: 'Chỉ phân quyền được cho tài khoản đang là user thường.' })
      logAction(req, 'promote', await store.getUserById(userId))
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.post('/api/admin/users/:id/demote', requireAuth, requireAdmin, requireRoot, async (req, res, next) => {
    const userId = Number(req.params.id)
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Id user không hợp lệ.' })
    if (userId === req.user.sub) return res.status(400).json({ error: 'Không thể tự hạ quyền chính tài khoản admin gốc đang đăng nhập.' })
    try {
      const target = await store.getUserById(userId) // lấy username để log TRƯỚC khi hạ quyền (sau demote vẫn cùng username, chỉ đổi Role/ManagedBy)
      const ok = await store.demoteToUser(userId)
      if (!ok) return res.status(400).json({ error: 'Chỉ hạ quyền được tài khoản đang là admin thường.' })
      logAction(req, 'demote', target, 'Đã bỏ gán mọi thành viên tài khoản này từng quản lý')
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.post('/api/admin/users/:id/assign', requireAuth, requireAdmin, requireRoot, async (req, res, next) => {
    const userId = Number(req.params.id)
    const adminId = Number(req.body?.adminId)
    if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(adminId) || adminId < 1) {
      return res.status(400).json({ error: 'Id user hoặc id admin không hợp lệ.' })
    }
    try {
      const ok = await store.assignUserToAdmin(userId, adminId)
      if (!ok) return res.status(400).json({ error: 'Chỉ gán được user thường cho một tài khoản đang là admin.' })
      const [target, admin] = await Promise.all([store.getUserById(userId), store.getUserById(adminId)])
      logAction(req, 'assign', target, `Gán cho admin "${admin?.Username}" quản lý`)
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.post('/api/admin/users/:id/unassign', requireAuth, requireAdmin, requireRoot, async (req, res, next) => {
    const userId = Number(req.params.id)
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Id user không hợp lệ.' })
    try {
      const target = await store.getUserById(userId)
      if (!target) return res.status(404).json({ error: 'Không tìm thấy user.' })
      const ok = await store.unassignUser(userId)
      if (!ok) return res.status(400).json({ error: 'Chỉ bỏ gán được user thường đang có admin quản lý.' })
      logAction(req, 'unassign', target)
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  // Nhật ký hành động quản trị - chỉ root xem được (admin thường không thấy
  // kể cả hành động do chính họ làm, tránh mở thêm 1 route cần lọc phạm vi
  // nữa cho một tính năng phụ; root vẫn thấy đầy đủ hành động của mọi admin).
  app.get('/api/admin/audit-log', requireAuth, requireAdmin, requireRoot, async (req, res, next) => {
    try { res.json({ entries: await store.getAdminAuditLog() }) }
    catch (error) { next(error) }
  })

  // Giao thức đồng bộ v3: khóa lạc quan theo Version (baseVersion) + tải delta
  // theo con trỏ RowVer. Client v2 cũ (không gửi baseVersion) bị chặn bằng 409
  // ở /sync để không ghi đè kiểu "timestamp mới nhất thắng" như trước.
  app.get('/api/notes/protocol', requireAuth, (req, res) => res.json({ version: SYNC_VERSION }))
  // ?since=<con trỏ> (chuỗi số, mặc định '0' = từ đầu). Trả tối đa
  // NOTES_PAGE_SIZE ghi chú/trang kèm con trỏ mới; hasMore=true thì client
  // gọi tiếp với con trỏ đó.
  app.get('/api/notes', requireAuth, async (req, res, next) => {
    const since = req.query.since === undefined ? '0' : req.query.since
    if (typeof since !== 'string' || !/^\d{1,19}$/.test(since) || BigInt(since) > 9223372036854775807n) {
      return res.status(400).json({ error: 'Con trỏ đồng bộ không hợp lệ.' })
    }
    try { res.json(await store.getNotesSince(req.user.sub, String(BigInt(since)), NOTES_PAGE_SIZE)) }
    catch (error) { next(error) }
  })
  app.post('/api/notes/sync', requireAuth, async (req, res, next) => {
    if (req.get('X-Sync-Version') !== String(SYNC_VERSION)) {
      return res.status(409).json({ error: 'Ứng dụng cũ. Hãy tải lại trang để cập nhật trước khi đồng bộ.' })
    }
    const notes = req.body?.notes
    if (!Array.isArray(notes) || notes.length > 100 || !notes.every(validNote) ||
        new Set(notes.map(n => n.id)).size !== notes.length ||
        new Set(notes.map(n => n.serverId)).size !== notes.length) {
      return res.status(400).json({ error: 'Dữ liệu ghi chú không hợp lệ (tối đa 100 ghi chú/lần).' })
    }
    try {
      // Mỗi kết quả: applied (+ version mới), conflict (+ bản đang có trên
      // server để người dùng chọn), rejected (ServerId trùng của tài khoản
      // khác - client đổi ServerId rồi gửi lại).
      const results = []
      for (const note of notes) {
        results.push({ localId: note.id, serverId: note.serverId, ...await store.upsertNote(note, req.user.sub) })
      }
      res.json({ results, version: SYNC_VERSION })
    } catch (error) { next(error) }
  })

  // Nhắc việc bằng Web Push (push.js). Đăng ký gắn với tài khoản đang đăng
  // nhập; mọi route chỉ thao tác trên đăng ký của chính người gọi.
  const PUSH_DISABLED = 'Máy chủ chưa cấu hình khóa VAPID nên chưa bật được nhắc việc (xem README mục Nhắc việc).'
  const validEndpointParam = value => typeof value === 'string' && value.length > 0 && value.length <= 1000

  app.get('/api/push/config', requireAuth, async (req, res, next) => {
    const endpoint = validEndpointParam(req.query.endpoint) ? req.query.endpoint : ''
    try {
      const settings = await store.getReminderSettings(req.user.sub, endpoint)
      res.json({ enabled: push.isConfigured(), publicKey: push.publicKey(), leadMinutes: settings.leadMinutes, subscribed: settings.subscribed })
    } catch (error) { next(error) }
  })

  app.post('/api/push/subscribe', requireAuth, async (req, res, next) => {
    if (!push.isConfigured()) return res.status(503).json({ error: PUSH_DISABLED })
    const subscription = req.body?.subscription
    if (!validSubscription(subscription)) return res.status(400).json({ error: 'Đăng ký nhận thông báo không hợp lệ hoặc không thuộc dịch vụ push được hỗ trợ.' })
    try {
      await store.savePushSubscription(req.user.sub, { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth })
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.post('/api/push/unsubscribe', requireAuth, async (req, res, next) => {
    const endpoint = req.body?.endpoint
    if (!validEndpointParam(endpoint)) return res.status(400).json({ error: 'Endpoint không hợp lệ.' })
    try {
      await store.deletePushSubscription(req.user.sub, endpoint)
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  app.put('/api/push/settings', requireAuth, async (req, res, next) => {
    const leadMinutes = req.body?.leadMinutes
    if (!REMINDER_LEAD_OPTIONS.includes(leadMinutes)) return res.status(400).json({ error: 'Thời gian nhắc trước không hợp lệ.' })
    try {
      await store.setReminderLeadMinutes(req.user.sub, leadMinutes)
      res.json({ ok: true, leadMinutes })
    } catch (error) { next(error) }
  })

  // Gửi thử 1 thông báo tới mọi thiết bị đã bật của người gọi - để kiểm tra
  // quyền thông báo/hệ điều hành ngay, không phải chờ tới hạn công việc.
  app.post('/api/push/test', requireAuth, async (req, res, next) => {
    if (!push.isConfigured()) return res.status(503).json({ error: PUSH_DISABLED })
    try {
      const result = await sendToUser(store, push, req.user.sub, { type: 'test', tag: 'reminder-test' })
      if (result.total === 0) return res.status(400).json({ error: 'Chưa có thiết bị nào bật nhắc việc cho tài khoản này.' })
      res.json(result)
    } catch (error) { next(error) }
  })

  // Trợ lý AI: phân tích ngôn ngữ tự nhiên thành bản nháp ghi chú/công việc
  // bằng model chạy local qua Ollama. Không tự lưu - client phải xác nhận áp dụng.
  app.post('/api/ai/draft', requireAuth, async (req, res, next) => {
    const text = req.body?.text
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
      return res.status(400).json({ error: 'Nội dung yêu cầu AI phải là chuỗi từ 1 đến 2000 ký tự.' })
    }
    // Không bắt buộc đúng định dạng: existingTags chỉ là gợi ý giúp AI tái sử
    // dụng tag đã có, sai định dạng thì bỏ qua thay vì chặn cả request.
    const existingTags = Array.isArray(req.body?.existingTags) ? req.body.existingTags : []
    // Người dùng bấm Hủy/đóng trang -> kết nối đóng trước khi trả lời xong ->
    // hủy luôn yêu cầu tới Ollama (model chạy CPU rất tốn tài nguyên).
    const cancel = new AbortController()
    res.on('close', () => { if (!res.writableFinished) cancel.abort() })
    const now = Date.now()
    try {
      const draft = await ai.draftFromText(text.trim(), now, existingTags, { signal: cancel.signal })
      res.json({ draft })
    } catch (error) {
      if (error.name !== 'AiFailure') return next(error)
      if (error.code === 'cancelled') return
      // AI không dùng được (timeout, Ollama chưa chạy, trả sai định dạng...):
      // vẫn trả bản nháp cơ bản dựng bằng quy tắc (tiêu đề + ngày giờ đã phân
      // tích) kèm cảnh báo, để người dùng sửa và lưu tiếp thay vì trắng tay.
      res.json({ draft: basicDraft(text.trim(), now, existingTags), fallback: true, warning: error.message, code: error.code })
    }
  })

  // Nạp sẵn model vào RAM khi người dùng bắt đầu gõ yêu cầu - lần tạo bản
  // nháp ngay sau đó không phải chờ nạp model. Trả về ngay, không chờ nạp xong.
  app.post('/api/ai/warmup', requireAuth, (req, res) => {
    void Promise.resolve(ai.warmUp?.()).catch(() => {})
    res.status(202).json({ ok: true })
  })

  // Trợ lý tri thức: tìm các ghi chú gần nghĩa bằng embedding rồi yêu cầu
  // Ollama trả lời chỉ dựa trên các nguồn đó. Store luôn lọc bằng UserId lấy
  // từ JWT; client không thể hỏi hoặc nhận nguồn của tài khoản khác.
  app.post('/api/ai/knowledge/query', requireAuth, async (req, res, next) => {
    const question = req.body?.question
    const requestedTopK = req.body?.topK
    if (typeof question !== 'string' || question.trim().length < 2 || question.length > 1000) {
      return res.status(400).json({ error: 'Câu hỏi phải có từ 2 đến 1000 ký tự.' })
    }
    if (requestedTopK !== undefined && (!Number.isInteger(requestedTopK) || requestedTopK < 1 || requestedTopK > 8)) {
      return res.status(400).json({ error: 'Số nguồn phải là số nguyên từ 1 đến 8.' })
    }
    const cancel = new AbortController()
    res.on('close', () => { if (!res.writableFinished) cancel.abort() })
    try {
      const result = await knowledge.answerQuestion({
        store,
        userId: req.user.sub,
        question: question.trim(),
        topK: requestedTopK ?? 5,
        signal: cancel.signal
      })
      res.json(result)
    } catch (error) {
      if (error.name !== 'KnowledgeFailure') return next(error)
      if (error.code === 'cancelled') return
      res.status(503).json({ error: error.message, code: error.code })
    }
  })

  // AI ước lượng khối lượng/độ ưu tiên; thuật toán xác định phân bổ công việc
  // theo năng lực mỗi ngày và mô phỏng ba kịch bản. Không sửa dữ liệu gốc.
  app.post('/api/ai/planner/simulate', requireAuth, async (req, res, next) => {
    const dailyCapacityMinutes = req.body?.dailyCapacityMinutes
    const horizonDays = req.body?.horizonDays
    const timezoneOffsetMinutes = req.body?.timezoneOffsetMinutes
    const goal = req.body?.goal ?? ''
    if (!Number.isInteger(dailyCapacityMinutes) || dailyCapacityMinutes < 30 || dailyCapacityMinutes > 720) {
      return res.status(400).json({ error: 'Năng lực mỗi ngày phải là số phút nguyên từ 30 đến 720.' })
    }
    if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 60) {
      return res.status(400).json({ error: 'Khoảng mô phỏng phải từ 1 đến 60 ngày.' })
    }
    if (!Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -840 || timezoneOffsetMinutes > 840) {
      return res.status(400).json({ error: 'Múi giờ thiết bị không hợp lệ.' })
    }
    if (typeof goal !== 'string' || goal.length > 500) {
      return res.status(400).json({ error: 'Mục tiêu lập kế hoạch tối đa 500 ký tự.' })
    }
    const cancel = new AbortController()
    res.on('close', () => { if (!res.writableFinished) cancel.abort() })
    try {
      const result = await planner.createPlan({
        store,
        userId: req.user.sub,
        dailyCapacityMinutes,
        horizonDays,
        timezoneOffsetMinutes,
        goal: goal.trim(),
        signal: cancel.signal
      })
      res.json(result)
    } catch (error) {
      if (error.name === 'PlannerFailure' && error.code === 'cancelled') return
      next(error)
    }
  })

  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }))
  if (serveFrontend) {
    const frontendPath = fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
    app.use(express.static(frontendPath, {
      setHeaders: (res, filePath) => res.set('Cache-Control', /[\\/]assets[\\/]/.test(filePath)
        ? 'public, max-age=31536000, immutable' : 'no-cache')
    }))
  }
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ.' })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu quá lớn.' })
    console.error('API error:', error.message)
    res.status(503).json({ error: 'Không thể truy cập cơ sở dữ liệu. Vui lòng thử lại.' })
  })
  return app
}
