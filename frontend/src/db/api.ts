// PWA cài từ dev/preview vẫn phải đồng bộ khi Vite đã dừng nhưng API còn chạy.
// Chỉ dùng cổng API local cho hai origin phát triển đã định nghĩa.
export function resolveApiUrl(configured: string | undefined, location: Pick<Location, 'hostname' | 'protocol' | 'port'>) {
  if (configured?.trim()) return configured.trim().replace(/\/$/, '')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  if (local && location.protocol === 'http:' && ['4173', '5173'].includes(location.port)) {
    return `http://${location.hostname}:4000/api/notes`
  }
  return '/api/notes'
}

export const API_URL = resolveApiUrl(import.meta.env?.VITE_API_URL, window.location)
// API_URL luôn kết thúc bằng /notes (quy ước ở .env.example) - suy ra gốc /api
// dùng chung cho các nhóm endpoint khác (auth, ai).
export const API_ROOT = API_URL.replace(/\/notes\/?$/, '')

const TOKEN_KEY = 'pwa-notes-token'
export const AUTH_CHANGE_EVENT = 'pwa-notes-auth-change'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* ignore: quota/private mode */ }
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

export class SyncFailure extends Error {
  constructor(message: string, readonly retryable: boolean = true) { super(message); this.name = 'SyncFailure' }
}

export async function request(url: string, options?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  const token = getToken()
  const headers = { ...(options?.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) {
      if (response.status === 401) {
        clearToken()
        // 401 giờ không chỉ có nghĩa "hết hạn phiên" - từ khi requireAuth tra
        // DB mỗi request (auth.js), tài khoản bị admin khóa giữa chừng cũng
        // trả 401 kèm thông điệp riêng ("Tài khoản đã bị vô hiệu hóa..."). Đọc
        // đúng message từ backend thay vì luôn hiện chữ "hết hạn phiên" chung
        // chung - tránh người dùng hiểu nhầm rồi đăng nhập lại vô ích.
        let message = 'Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại.'
        try {
          const body = await response.json()
          if (body && typeof body === 'object' && typeof body.error === 'string') message = body.error
        } catch { /* giữ message mặc định nếu phản hồi không phải JSON hợp lệ */ }
        throw new SyncFailure(message, false)
      }
      if (response.status === 404 || response.status === 409) throw new SyncFailure('API chưa đúng phiên bản hoặc sai địa chỉ. Khởi động lại backend mới và tải lại ứng dụng khi online.', false)
      if (response.status === 400) throw new SyncFailure('Server từ chối dữ liệu ghi chú. Kiểm tra lại nội dung và thời gian; thay đổi vẫn được giữ trên thiết bị.', false)
      if (response.status === 413) throw new SyncFailure('Dữ liệu gửi quá lớn. Hãy giảm nội dung ghi chú rồi thử lại.', false)
      if (response.status === 403) throw new SyncFailure('API từ chối quyền truy cập. Kiểm tra cấu hình máy chủ.', false)
      if (response.status === 503) throw new SyncFailure('Backend đang lỗi hoặc chưa truy cập được SQL Server. Ứng dụng sẽ tự thử lại.')
      throw new SyncFailure(`Máy chủ trả lỗi HTTP ${response.status}. Ứng dụng sẽ tự thử lại.`)
    }
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) throw new SyncFailure('Địa chỉ API đang trả trang HTML thay vì dữ liệu. Kiểm tra VITE_API_URL hoặc proxy và khởi động lại server.', false)
    try { return await response.json() }
    catch { throw new SyncFailure('Phản hồi API không phải JSON hợp lệ. Kiểm tra phiên bản backend.', false) }
  } catch (error) {
    if (error instanceof SyncFailure) throw error
    if (controller.signal.aborted) throw new SyncFailure('API chưa phản hồi sau 15 giây. Dữ liệu vẫn ở thiết bị; ứng dụng sẽ tự thử lại.')
    const endpoint = new URL(url, window.location.href)
    throw new SyncFailure(`Có mạng nhưng chưa kết nối được API tại ${endpoint.origin}. Kiểm tra backend đang chạy và cấu hình CORS. Dữ liệu vẫn ở thiết bị.`)
  } finally { clearTimeout(timeout) }
}
