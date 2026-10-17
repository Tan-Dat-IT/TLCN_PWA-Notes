// Thao tác Web Push thuần phía trình duyệt (không gọi API backend) - tách
// riêng để cả db/push.ts lẫn db/auth.ts (dọn khi đổi tài khoản) dùng được mà
// không import vòng qua nhau.

export type PushSupport = 'supported' | 'unsupported' | 'insecure'

// Web Push chỉ chạy trong "secure context" (HTTPS hoặc localhost) và cần
// Service Worker + Push API + Notification API.
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || !window.isSecureContext) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'supported'
}

// Service Worker chỉ được đăng ký ở bản build (preview/production), không có
// khi chạy `npm run dev` -> trả null thay vì chờ mãi navigator.serviceWorker.ready.
export async function getServiceWorkerRegistration() {
  if (pushSupport() !== 'supported') return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function getBrowserSubscription() {
  const registration = await getServiceWorkerRegistration()
  return registration ? registration.pushManager.getSubscription() : null
}

// Hủy đăng ký ở trình duyệt: dịch vụ push vô hiệu hóa endpoint, lần gửi sau
// server nhận 404/410 và tự xóa bản ghi. Không bao giờ ném lỗi - chỉ dùng để dọn.
export async function dropBrowserSubscription() {
  try { await (await getBrowserSubscription())?.unsubscribe() } catch { /* bỏ qua: chỉ là bước dọn dẹp */ }
}

// Khóa công khai VAPID dạng base64url -> Uint8Array cho pushManager.subscribe().
export function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}

// Đăng ký hiện có được tạo bằng đúng khóa VAPID này chưa (server đổi khóa thì
// đăng ký cũ vô dụng, phải tạo lại).
export function sameApplicationServerKey(subscription: PushSubscription, publicKey: string) {
  const current = subscription.options?.applicationServerKey
  if (!current) return false
  const a = new Uint8Array(current), b = urlBase64ToUint8Array(publicKey)
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}
