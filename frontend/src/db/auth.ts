import { API_ROOT, getToken, setToken, clearToken, AUTH_CHANGE_EVENT } from './api'
import { clearLocalData } from './database'
import { dropBrowserSubscription } from '../lib/pushSubscription'

export type UserRole = 'user' | 'admin' | 'root'
export interface AuthUser { id: number; username: string; displayName?: string; email?: string | null; role?: UserRole }

const USER_KEY = 'pwa-notes-user'
const LAST_USER_KEY = 'pwa-notes-last-user'

export class AuthError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'AuthError' }
}

async function apiFetch(path: string, options: RequestInit, token: string | null) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: controller.signal, cache: 'no-store'
    })
  } catch {
    if (controller.signal.aborted) throw new AuthError('Máy chủ không phản hồi sau 15 giây.')
    throw new AuthError('Không kết nối được tới máy chủ. Kiểm tra backend đang chạy.')
  } finally { clearTimeout(timeout) }
  let body: unknown
  try { body = await response.json() } catch { throw new AuthError('Phản hồi máy chủ không phải JSON hợp lệ.') }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error : `Máy chủ trả lỗi HTTP ${response.status}.`
    throw new AuthError(message, response.status)
  }
  return body
}

// Dùng cho đăng ký/đăng nhập - chưa có token, không cần đính kèm.
async function authFetch(path: string, options?: RequestInit) {
  return apiFetch(path, options ?? {}, null)
}

// Dùng cho các API cần đăng nhập (vd đổi mật khẩu, các API /admin/*). Khác
// request() dùng chung ở api.ts: KHÔNG tự đăng xuất khi gặp 401 - ở đây 401
// có thể chỉ nghĩa là "sai mật khẩu hiện tại" hoặc "không đủ quyền", không
// hẳn là "hết hạn phiên đăng nhập". Export để db/admin.ts dùng chung logic.
export async function authenticatedFetch(path: string, options?: RequestInit) {
  return apiFetch(path, options ?? {}, getToken())
}

async function saveSession(token: string, user: AuthUser) {
  // Thiết bị/trình duyệt có thể được nhiều tài khoản dùng chung lần lượt
  // (vd. máy demo). Nếu tài khoản vừa đăng nhập khác tài khoản dùng lần
  // trước trên máy này, dọn sạch cache ghi chú local trước - tránh dữ liệu
  // của tài khoản cũ lẫn vào hoặc bị đẩy nhầm lên tài khoản mới khi đồng bộ.
  let lastUser: string | null = null
  try { lastUser = localStorage.getItem(LAST_USER_KEY) } catch { /* ignore */ }
  // Đăng ký nhắc việc (Web Push) của trình duyệt cũng thuộc tài khoản cũ -
  // hủy luôn, nếu không thiết bị này tiếp tục nhận thông báo công việc của
  // người trước (trường hợp phiên cũ hết hạn nên không đi qua nút Đăng xuất).
  if (lastUser !== null && lastUser !== user.username) {
    await clearLocalData()
    await dropBrowserSubscription()
  }
  // Ghi thông tin user trước khi setToken (setToken phát sự kiện đồng bộ,
  // listener đọc user ngay lập tức nên phải sẵn dữ liệu trước).
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    localStorage.setItem(LAST_USER_KEY, user.username)
  } catch { /* ignore */ }
  setToken(token)
}

// Làm mới profile từ server để quyền, tên hiển thị và email không bị giữ ở
// bản cache của lần đăng nhập cũ. Mất mạng thì caller bỏ qua và app vẫn dùng
// cache offline; 401 mới thật sự xóa phiên không còn hợp lệ.
export async function refreshCurrentUser() {
  const sessionToken = getToken()
  if (!sessionToken) throw new AuthError('Chưa đăng nhập.', 401)
  try {
    const body = await apiFetch('/auth/me', {}, sessionToken) as { user: AuthUser }
    // Người dùng có thể đăng xuất/đổi tài khoản trong lúc request đang bay.
    // Không cho response của phiên cũ ghi đè profile của phiên mới.
    if (getToken() !== sessionToken) throw new AuthError('Phiên đăng nhập đã thay đổi; bỏ qua phản hồi cũ.')
    if (!body.user || typeof body.user.id !== 'number' || typeof body.user.username !== 'string') {
      throw new AuthError('Phản hồi thông tin tài khoản không hợp lệ.')
    }
    localStorage.setItem(USER_KEY, JSON.stringify(body.user))
    localStorage.setItem(LAST_USER_KEY, body.user.username)
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
    return body.user
  } catch (error) {
    if (error instanceof AuthError && error.status === 401 && getToken() === sessionToken) logout()
    throw error
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) as AuthUser : null
  } catch { return null }
}

export function isAuthenticated() { return getToken() !== null }

export async function login(username: string, password: string) {
  const body = await authFetch('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
  }) as { token: string; user: AuthUser }
  await saveSession(body.token, body.user)
  return body.user
}

export async function register(username: string, password: string, displayName?: string, email?: string) {
  const body = await authFetch('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, displayName, email })
  }) as { token: string; user: AuthUser }
  await saveSession(body.token, body.user)
  return body.user
}

export function logout() {
  clearToken()
  try { localStorage.removeItem(USER_KEY) } catch { /* ignore */ }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await authenticatedFetch('/auth/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  })
}

// Cập nhật email khôi phục của tài khoản đang đăng nhập - dùng cho luồng
// quên mật khẩu qua email (mục 4 README). Cập nhật luôn cache local để
// giao diện phản ánh ngay, không cần gọi lại /auth/me.
export async function updateEmail(email: string) {
  const sessionToken = getToken()
  await authenticatedFetch('/auth/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  })
  if (getToken() !== sessionToken) return
  const user = getStoredUser()
  if (user) {
    try { localStorage.setItem(USER_KEY, JSON.stringify({ ...user, email })) } catch { /* ignore */ }
  }
  // Không đổi token nên request() sẽ không tự phát AUTH_CHANGE_EVENT - phát
  // thủ công để useAuth() và mọi nơi hiển thị email cập nhật ngay lập tức,
  // không phải chờ tới lần đăng nhập kế tiếp.
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

// Chưa đăng nhập nên dùng authFetch (không đính kèm token). Luôn trả về
// cùng một thông báo chung dù email có tồn tại hay không - đây là hành vi
// cố ý của backend để tránh lộ email nào đã đăng ký (xem app.js).
export async function forgotPassword(email: string) {
  const body = await authFetch('/auth/forgot-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  }) as { message: string }
  return body.message
}

export async function resetPassword(token: string, newPassword: string) {
  await authFetch('/auth/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword })
  })
}
