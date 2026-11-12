import './env.js'
import { createApp } from './app.js'
import * as store from './store.js'
import * as push from './push.js'
import * as ai from './ai.js'
import { access } from 'node:fs/promises'

const port = Number(process.env.PORT || 4000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ')
const host = process.env.HOST || '127.0.0.1'

try {
  await store.checkDatabase()
  const serveFrontend = process.env.NODE_ENV === 'production'
  if (serveFrontend) await access(new URL('../../frontend/dist/index.html', import.meta.url))
  const server = createApp(store, { serveFrontend }).listen(port, host, () => {
    console.log(`Backend sẵn sàng tại http://${host}:${port}`)
  })
  // Quét nhắc việc mỗi phút (chỉ khi đã cấu hình VAPID - xem push.js).
  const stopReminders = push.isConfigured() ? push.startReminderScheduler(store, push) : () => {}
  if (!push.isConfigured()) console.log('Nhắc việc (Web Push) đang tắt: chưa đặt VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.')
  // Nạp sẵn model AI vào RAM ngay khi backend chạy (không chờ, Ollama chưa chạy thì bỏ qua).
  void ai.warmUp()
  server.on('error', async error => {
    console.error('Không thể mở HTTP server:', error.code)
    stopReminders()
    await store.closeDatabase()
    process.exitCode = 1
  })
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    stopReminders()
    const timeout = setTimeout(() => process.exit(1), 15000)
    timeout.unref()
    server.close(async () => {
      await store.closeDatabase()
      clearTimeout(timeout)
    })
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
} catch (error) {
  console.error('Backend chưa sẵn sàng:', error.code || error.name, 'Kiểm tra kết nối SQL và chạy npm run migrate.')
  await store.closeDatabase()
  process.exitCode = 1
}
