import './env.js'
import webpush from 'web-push'

// Nhắc việc bằng Web Push chuẩn (RFC 8030 + VAPID). Backend ký thông báo bằng
// khóa VAPID rồi gửi tới dịch vụ push của trình duyệt (Google FCM cho
// Chrome/Edge trên nhiều nền tảng, Microsoft WNS, Mozilla, Apple); dịch vụ đó
// chuyển tới thiết bị kể cả khi đã đóng tab ứng dụng. Nội dung được mã hóa
// đầu-cuối bằng khóa của trình duyệt, dịch vụ push không đọc được.
// Không đặt VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY thì tính năng tắt (như SMTP).

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
let configured = false
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    configured = true
  } catch (error) {
    console.error('Cấu hình VAPID không hợp lệ, tắt nhắc việc:', error.message)
  }
}

export function isConfigured() { return configured }
export function publicKey() { return configured ? VAPID_PUBLIC_KEY : null }

// Endpoint do trình duyệt gửi lên, backend sẽ gửi HTTP POST tới đó. Chỉ nhận
// đúng các máy chủ push chính thức qua HTTPS - nếu nhận URL bất kỳ, kẻ gian có
// thể bắt backend gọi vào địa chỉ nội bộ (SSRF, vd http://127.0.0.1:1433).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com', '.push.services.mozilla.com']
export function allowedEndpoint(value) {
  if (typeof value !== 'string' || value.length > 1000) return false
  let url
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/
export function validSubscription(sub) {
  return Boolean(sub && typeof sub === 'object' && allowedEndpoint(sub.endpoint) && sub.keys && typeof sub.keys === 'object' &&
    typeof sub.keys.p256dh === 'string' && sub.keys.p256dh.length <= 200 && BASE64URL.test(sub.keys.p256dh) &&
    typeof sub.keys.auth === 'string' && sub.keys.auth.length <= 100 && BASE64URL.test(sub.keys.auth))
}

// Trả 'sent' | 'gone' (đăng ký hết hiệu lực, cần xóa) | 'failed' (lỗi tạm thời).
export async function send(subscription, payload) {
  if (!configured) return 'failed'
  try {
    // TTL: dịch vụ push giữ tối đa 1 giờ nếu thiết bị đang tắt máy/mất mạng.
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' })
    return 'sent'
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) return 'gone'
    console.error('Gửi Web Push thất bại:', error.statusCode || '', error.message)
    return 'failed'
  }
}

// Gửi 1 payload tới mọi thiết bị của 1 người; tự dọn đăng ký đã hết hiệu lực.
export async function sendToUser(store, push, userId, payload) {
  const subscriptions = await store.getPushSubscriptions(userId)
  let sent = 0, failed = 0
  for (const sub of subscriptions) {
    const status = await push.send(sub, payload)
    if (status === 'sent') sent++
    else if (status === 'gone') await store.deletePushSubscriptionByEndpoint(sub.endpoint)
    else failed++
  }
  return { sent, failed, total: subscriptions.length }
}

export const REMINDER_INTERVAL_MS = 60 * 1000
export const REMINDER_GRACE_MS = 60 * 60 * 1000
const CLAIM_LIMIT = 200
// Quá ngưỡng này trong 1 lượt thì gộp thành 1 thông báo tóm tắt cho người đó,
// tránh dồn hàng loạt thông báo (vd. vừa bật nhắc việc khi đang có nhiều việc sắp hạn).
const SUMMARY_THRESHOLD = 3

export function reminderPayload(items) {
  if (items.length === 1) {
    const [item] = items
    return { type: 'reminder', title: item.title, dueAt: item.dueAt, tag: `reminder-${item.serverId}` }
  }
  return { type: 'summary', count: items.length, titles: items.slice(0, 3).map(i => i.title), dueAt: items[0].dueAt, tag: 'reminder-summary' }
}

// 1 lượt quét: nhận các nhắc việc đến hạn, gom theo người dùng, gửi. Không gửi
// được tới BẤT KỲ thiết bị nào vì lỗi tạm thời -> trả lại để lượt sau thử
// lại; đăng ký hết hiệu lực thì đã dọn, không thử lại vô ích.
export async function runReminderPass(store, push, now = Date.now()) {
  if (!push.isConfigured()) return { users: 0, reminders: 0 }
  const claimed = await store.claimDueReminders(now, REMINDER_GRACE_MS, CLAIM_LIMIT)
  const byUser = new Map()
  for (const item of claimed) byUser.set(item.userId, [...(byUser.get(item.userId) || []), item])
  for (const [userId, items] of byUser) {
    const payloads = items.length > SUMMARY_THRESHOLD ? [reminderPayload(items)] : items.map(item => reminderPayload([item]))
    let delivered = 0, transient = 0
    for (const payload of payloads) {
      const result = await sendToUser(store, push, userId, payload)
      delivered += result.sent
      transient += result.failed
    }
    if (delivered === 0 && transient > 0) {
      for (const item of items) await store.releaseReminder(item.serverId, item.dueAt)
    }
  }
  return { users: byUser.size, reminders: claimed.length }
}

// Chạy nền mỗi phút trong tiến trình backend (server.js). Lượt trước chưa xong
// thì bỏ qua lượt này; lỗi (vd. SQL tạm gián đoạn) chỉ log, lượt sau thử lại.
export function startReminderScheduler(store, push, intervalMs = REMINDER_INTERVAL_MS) {
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try { await runReminderPass(store, push) }
    catch (error) { console.error('Quét nhắc việc thất bại:', error.message) }
    finally { busy = false }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  void tick()
  return () => clearInterval(timer)
}
