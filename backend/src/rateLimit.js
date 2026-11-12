// Chính sách chặn đăng nhập sau nhiều lần sai mật khẩu - dùng chung cho tài
// khoản có thật (đếm trong SQL, xem store.recordFailedLogin) và tên đăng nhập
// không tồn tại (đếm trong RAM, bên dưới).
export const LOGIN_POLICY = { maxAttempts: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 }

// Bộ đếm trong RAM cho tên đăng nhập KHÔNG tồn tại. Cùng quy tắc với bộ đếm
// SQL (đếm lượt còn lại, chặn khi hết, tự mở sau lockMs) để phản hồi cho tên
// không tồn tại giống hệt tài khoản có thật - không để lộ tên nào đã đăng ký.
// Mất khi restart backend là chấp nhận được: không có tài khoản thật nào để bảo vệ.
export function createFailureTracker({ maxAttempts, windowMs, lockMs } = LOGIN_POLICY) {
  const entries = new Map()

  function cleanup(now) {
    for (const [key, e] of entries) {
      if ((!e.lockedUntil || e.lockedUntil <= now) && now - e.lastFailedAt > windowMs) entries.delete(key)
    }
  }

  return {
    lockedUntil(key, now) {
      const e = entries.get(key)
      return e?.lockedUntil && e.lockedUntil > now ? e.lockedUntil : null
    },
    fail(key, now) {
      cleanup(now)
      const prev = entries.get(key)
      const reset = !prev || (prev.lockedUntil && prev.lockedUntil <= now) || now - prev.lastFailedAt > windowMs
      const count = reset ? 1 : prev.count + 1
      const e = { count, lastFailedAt: now, lockedUntil: count >= maxAttempts ? now + lockMs : null }
      entries.set(key, e)
      return { count, lockedUntil: e.lockedUntil }
    }
  }
}

// Giới hạn đơn giản theo IP, dùng cho đăng ký (chặn tạo tài khoản hàng loạt
// tự động) - không cần theo dõi username vì chưa có tài khoản để tra cứu.
export function createIpLimiter({ maxRequests = 10, windowMs = 60 * 60 * 1000 } = {}) {
  const hits = new Map()

  function cleanup(now) {
    for (const [key, entry] of hits) {
      if (now - entry.firstAt > windowMs) hits.delete(key)
    }
  }

  return function ipLimiter(req, res, next) {
    const key = req.ip
    const now = Date.now()
    cleanup(now)
    const entry = hits.get(key) ?? { count: 0, firstAt: now }
    entry.count += 1
    hits.set(key, entry)
    if (entry.count > maxRequests) {
      const waitSec = Math.ceil((entry.firstAt + windowMs - now) / 1000)
      return res.status(429).json({ error: `Quá nhiều yêu cầu. Vui lòng thử lại sau ${Math.max(waitSec, 1)} giây.` })
    }
    next()
  }
}
