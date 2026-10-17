import './env.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'

// Bí mật ký JWT: bắt buộc đặt JWT_SECRET khi chạy production, tránh dùng giá trị
// mặc định dễ đoán cho môi trường có dữ liệu thật.
const secret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('JWT_SECRET bắt buộc phải đặt khi NODE_ENV=production') })()
  : 'dev-only-insecure-secret-change-me')
const expiresIn = process.env.JWT_EXPIRES_IN || '7d'

export function validUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,50}$/.test(value)
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 200
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

// Token đặt lại mật khẩu: sinh ngẫu nhiên, chỉ lưu bản băm SHA-256 trong DB
// (không cần bcrypt - token đã đủ entropy ngẫu nhiên, và cần tra cứu trực
// tiếp bằng WHERE ResetTokenHash = @hash nên phải băm không kèm salt).
export function createResetToken() {
  return randomBytes(32).toString('hex')
}

export function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, secret, { expiresIn })
}

export function verifyToken(token) {
  return jwt.verify(token, secret)
}

// Middleware: chặn request thiếu/token sai, gắn req.user khi hợp lệ. Tra
// thẳng DB mỗi request thay vì chỉ tin chữ ký JWT - lý do: nếu chỉ xác minh
// chữ ký, một tài khoản bị admin khóa (Disabled=1) vẫn dùng được token đã
// cấp trước đó cho tới khi token tự hết hạn (JWT_EXPIRES_IN, mặc định 7
// ngày) - "Khóa đăng nhập" khi đó chỉ chặn được LẦN ĐĂNG NHẬP TIẾP THEO, không
// có hiệu lực ngay với phiên đang mở. Đổi lại: route nào cũng thêm 1 query
// theo khóa chính (`Users.Id`, đã là PRIMARY KEY - có index) mỗi request,
// không còn hoàn toàn stateless nhưng vẫn rẻ ở quy mô demo hiện tại.
export function createRequireAuth(store) {
  return async function requireAuth(req, res, next) {
    const header = req.get('Authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' })
    try {
      const payload = verifyToken(token)
      const user = await store.getUserById(payload.sub)
      if (!user) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.' })
      if (user.Disabled) return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.' })
      req.user = payload
      // Giữ dòng Users vừa đọc để middleware/route phía sau không phải truy
      // vấn lại cùng khóa chính trong chính request này.
      req.authUser = user
      next()
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.' })
      }
      next(error)
    }
  }
}

// Middleware quản trị: chạy SAU requireAuth. Dùng dòng user requireAuth vừa
// đọc từ DB thay vì tin role đóng sẵn trong JWT - token có thể sống tới 7
// ngày, nên cách này bảo đảm thu hồi/hạ quyền admin có hiệu lực ngay mà không
// query cùng user lần thứ hai. Fallback query chỉ phục vụ cách gọi độc lập.
// Cho qua cả Role='admin' (admin thường, chỉ quản lý user được root gán) lẫn
// Role='root' (admin gốc, không giới hạn phạm vi) - route handler tự phân
// biệt 2 vai trò này qua req.actingAdmin.Role khi cần (ví dụ lọc danh sách
// theo phạm vi quản lý, hoặc chặn hành động chỉ root mới được làm).
export function createRequireAdmin(store) {
  return async function requireAdmin(req, res, next) {
    try {
      // requireAuth chạy trước trên các route quản trị và đã kiểm tra trạng
      // thái Disabled. Fallback giữ middleware dùng độc lập được trong test.
      const user = req.authUser ?? await store.getUserById(req.user.sub)
      if (!user || user.Role === 'user') return res.status(403).json({ error: 'Chỉ tài khoản quản trị mới truy cập được.' })
      if (user.Disabled) return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa.' })
      req.actingAdmin = user
      next()
    } catch (error) { next(error) }
  }
}

// Chạy SAU requireAdmin (cần req.actingAdmin). Một số hành động (phân/hạ
// quyền admin, gán/bỏ gán user cho admin quản lý, tạo tài khoản mới) chỉ
// admin GỐC được làm - admin thường dù quản lý được thành viên của mình vẫn
// không có các quyền này, tránh admin thường tự mở rộng phạm vi của chính họ.
export function requireRoot(req, res, next) {
  if (req.actingAdmin?.Role !== 'root') return res.status(403).json({ error: 'Chỉ tài khoản admin gốc mới thực hiện được thao tác này.' })
  next()
}
