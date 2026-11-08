import { authenticatedFetch, AuthError } from './auth'
import {
  getBrowserSubscription, getServiceWorkerRegistration, sameApplicationServerKey, urlBase64ToUint8Array
} from '../lib/pushSubscription'

// Nhắc việc bằng Web Push - gọi các API /api/push/* (backend/src/app.js).
// Khớp REMINDER_LEAD_OPTIONS ở backend.
export const REMINDER_LEAD_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440] as const

export interface PushConfig { enabled: boolean; publicKey: string | null; leadMinutes: number; subscribed: boolean }

export async function getPushConfig(endpoint?: string) {
  const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''
  return await authenticatedFetch(`/push/config${query}`) as PushConfig
}

async function saveSubscription(subscription: PushSubscription) {
  await authenticatedFetch('/push/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() })
  })
}

// Bật nhắc việc cho thiết bị này: xin quyền thông báo, tạo (hoặc dùng lại)
// đăng ký push bằng khóa VAPID của server, gửi đăng ký lên server.
export async function enableReminders(publicKey: string) {
  const registration = await getServiceWorkerRegistration()
  if (!registration) throw new AuthError('Service Worker chưa sẵn sàng. Nhắc việc chỉ chạy ở bản build (npm run build rồi mở bản preview/production), không chạy ở chế độ dev.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new AuthError('Trình duyệt chưa cho phép hiển thị thông báo. Bấm biểu tượng ổ khóa cạnh thanh địa chỉ → cho phép Thông báo, rồi thử lại.')
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameApplicationServerKey(subscription, publicKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
  await saveSubscription(subscription)
}

// Tắt nhắc việc cho thiết bị này: xóa trên server rồi hủy ở trình duyệt.
export async function disableReminders() {
  const subscription = await getBrowserSubscription()
  if (!subscription) return
  await authenticatedFetch('/push/unsubscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint })
  })
  await subscription.unsubscribe()
}

export async function setReminderLeadMinutes(leadMinutes: number) {
  await authenticatedFetch('/push/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadMinutes })
  })
}

export async function sendTestNotification() {
  return await authenticatedFetch('/push/test', { method: 'POST' }) as { sent: number; failed: number; total: number }
}

// Gọi khi mở app đã đăng nhập: trình duyệt vẫn còn đăng ký + đã cho phép
// thông báo nhưng server không còn bản ghi (vd. server bị khôi phục DB, hoặc
// bản ghi bị dọn nhầm) -> gửi lại để tiếp tục nhận nhắc việc. Không tự bật khi
// người dùng chưa từng bật. Không ném lỗi (chỉ là bước tự phục hồi).
export async function restoreReminderSubscription() {
  try {
    const subscription = await getBrowserSubscription()
    if (!subscription || Notification.permission !== 'granted') return
    const config = await getPushConfig(subscription.endpoint)
    if (config.enabled && config.publicKey && !config.subscribed && sameApplicationServerKey(subscription, config.publicKey)) {
      await saveSubscription(subscription)
    }
  } catch { /* offline hoặc server lỗi: lần mở app sau thử lại */ }
}

// Đăng xuất: gỡ đăng ký của thiết bị này khỏi tài khoản (khi token còn hiệu
// lực) rồi hủy ở trình duyệt, để người dùng tiếp theo trên máy này không nhận
// thông báo công việc của người trước. Giới hạn 5 giây, không ném lỗi - đăng
// xuất không được kẹt vì mạng; kể cả khi gọi server thất bại, việc hủy ở trình
// duyệt vẫn làm endpoint vô hiệu và server tự dọn ở lần gửi sau (410).
export async function removeReminderSubscriptionOnLogout() {
  const subscription = await getBrowserSubscription().catch(() => null)
  if (!subscription) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    authenticatedFetch('/push/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint })
    }).catch(() => undefined),
    new Promise(resolve => { timer = setTimeout(resolve, 5000) })
  ])
  clearTimeout(timer)
  try { await subscription.unsubscribe() } catch { /* bỏ qua */ }
}
