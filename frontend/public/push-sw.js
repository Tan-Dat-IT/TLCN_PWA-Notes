/* Xử lý Web Push trong Service Worker - được Workbox nạp vào sw.js qua
   importScripts (vite.config.ts). Chạy cả khi đã đóng tab ứng dụng.
   Server chỉ gửi dữ liệu thô (tiêu đề, hạn dạng epoch); thời gian được định
   dạng tại đây theo múi giờ của chính thiết bị. */

function formatDue(value) {
  return new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

function describe(data) {
  if (data.type === 'test') {
    return { title: 'Nhắc việc đã hoạt động', body: 'Thiết bị này sẽ nhận thông báo khi công việc sắp đến hạn.' }
  }
  if (data.type === 'summary') {
    const more = data.count > data.titles.length ? ` và ${data.count - data.titles.length} việc khác` : ''
    return { title: `${data.count} công việc sắp đến hạn`, body: `${data.titles.join(', ')}${more}` }
  }
  const overdue = typeof data.dueAt === 'number' && data.dueAt < Date.now()
  return {
    title: overdue ? 'Công việc đang quá hạn' : 'Công việc sắp đến hạn',
    body: `${data.title || 'Công việc'} - hạn ${formatDue(data.dueAt)}`
  }
}

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const { title, body } = describe(data)
  const icon = new URL('icons/icon-192.png', self.registration.scope).href
  event.waitUntil(self.registration.showNotification(title, {
    body, icon, badge: icon, lang: 'vi',
    tag: data.tag || 'reminder', renotify: true,
    data: { url: self.registration.scope }
  }))
})

// Bấm vào thông báo: đưa cửa sổ ứng dụng đang mở lên trước, chưa mở thì mở mới.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => client.url.startsWith(self.registration.scope))
    if (existing) return existing.focus()
    return self.clients.openWindow(url)
  })())
})
