import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react'
import { enableReminders, disableReminders, getPushConfig, restoreReminderSubscription, removeReminderSubscriptionOnLogout } from './push'
import { pushSupport, urlBase64ToUint8Array, sameApplicationServerKey } from '../lib/pushSubscription'
import { login } from './auth'
import { clearToken, getToken, setToken } from './api'
import { db } from './database'
import { useAuth } from '../hooks/useAuth'
import ReminderDialog from '../components/ReminderDialog'

const PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

// --- Mô phỏng Web Push API của trình duyệt (jsdom không có) ---
class FakeSubscription {
  unsubscribed = false
  constructor(public endpoint: string, public key: string) {}
  get options() { return { applicationServerKey: urlBase64ToUint8Array(this.key).buffer } }
  toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } } }
  async unsubscribe() { this.unsubscribed = true; browser.subscription = null; return true }
}
const browser = {
  subscription: null as FakeSubscription | null,
  permission: 'default' as NotificationPermission,
  grantOnRequest: 'granted' as NotificationPermission,
  hasRegistration: true,
  subscribeCalls: 0
}
function installBrowserPush() {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  vi.stubGlobal('PushManager', function PushManager() {})
  vi.stubGlobal('Notification', {
    get permission() { return browser.permission },
    requestPermission: async () => { browser.permission = browser.grantOnRequest; return browser.permission }
  })
  const registration = {
    pushManager: {
      getSubscription: async () => browser.subscription,
      subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
        browser.subscribeCalls++
        const key = btoa(String.fromCharCode(...applicationServerKey)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        browser.subscription = new FakeSubscription(ENDPOINT, key)
        return browser.subscription
      }
    }
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { getRegistration: async () => (browser.hasRegistration ? registration : undefined) }, configurable: true
  })
}

type Call = { url: string; method: string; body: unknown; auth: string | null }
let calls: Call[] = []
function mockApi(handler: (call: Call) => { status?: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers || {}) as Record<string, string>
    const call = { url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization || null }
    calls.push(call)
    const { status = 200, body } = handler(call)
    return { ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body }
  }))
}
const configBody = (o = {}) => ({ enabled: true, publicKey: PUBLIC_KEY, leadMinutes: 15, subscribed: false, ...o })

beforeEach(() => {
  calls = []
  Object.assign(browser, { subscription: null, permission: 'default', grantOnRequest: 'granted', hasRegistration: true, subscribeCalls: 0 })
  installBrowserPush()
  setToken('tok')
})
afterEach(() => { vi.unstubAllGlobals(); clearToken() })

describe('lib/pushSubscription', () => {
  it('urlBase64ToUint8Array giải mã khóa VAPID 65 byte', () => {
    const bytes = urlBase64ToUint8Array(PUBLIC_KEY)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(4)
  })
  it('sameApplicationServerKey phân biệt khóa khác', () => {
    const sub = new FakeSubscription(ENDPOINT, PUBLIC_KEY) as unknown as PushSubscription
    expect(sameApplicationServerKey(sub, PUBLIC_KEY)).toBe(true)
    expect(sameApplicationServerKey(sub, PUBLIC_KEY.replace('B', 'C'))).toBe(false)
  })
  it('pushSupport: insecure khi không phải HTTPS/localhost, unsupported khi thiếu API', () => {
    expect(pushSupport()).toBe('supported')
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(pushSupport()).toBe('insecure')
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    vi.stubGlobal('PushManager', undefined)
    Reflect.deleteProperty(window, 'PushManager')
    expect(pushSupport()).toBe('unsupported')
  })
})

describe('db/push', () => {
  it('getPushConfig gửi kèm endpoint của thiết bị', async () => {
    mockApi(() => ({ body: configBody() }))
    await getPushConfig(ENDPOINT)
    expect(calls[0].url).toContain(`/push/config?endpoint=${encodeURIComponent(ENDPOINT)}`)
    expect(calls[0].auth).toBe('Bearer tok')
  })

  it('enableReminders xin quyền, đăng ký bằng khóa VAPID của server rồi gửi đăng ký lên', async () => {
    mockApi(() => ({ body: { ok: true } }))
    await enableReminders(PUBLIC_KEY)
    expect(browser.permission).toBe('granted')
    expect(browser.subscribeCalls).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'POST', body: { subscription: { endpoint: ENDPOINT } } })
  })

  it('enableReminders báo lỗi rõ ràng khi người dùng chặn thông báo, không gọi server', async () => {
    browser.grantOnRequest = 'denied'
    mockApi(() => ({ body: {} }))
    await expect(enableReminders(PUBLIC_KEY)).rejects.toThrow(/cho phép/)
    expect(calls).toHaveLength(0)
  })

  it('enableReminders báo lỗi khi chưa có Service Worker (chạy dev)', async () => {
    browser.hasRegistration = false
    mockApi(() => ({ body: {} }))
    await expect(enableReminders(PUBLIC_KEY)).rejects.toThrow(/bản build/)
  })

  it('enableReminders tạo lại đăng ký khi server đã đổi khóa VAPID', async () => {
    const old = new FakeSubscription(ENDPOINT, PUBLIC_KEY.replace('B', 'C'))
    browser.subscription = old
    mockApi(() => ({ body: { ok: true } }))
    await enableReminders(PUBLIC_KEY)
    expect(old.unsubscribed).toBe(true)
    expect(browser.subscribeCalls).toBe(1)
  })

  it('disableReminders xóa trên server rồi hủy ở trình duyệt', async () => {
    const sub = new FakeSubscription(ENDPOINT, PUBLIC_KEY)
    browser.subscription = sub
    mockApi(() => ({ body: { ok: true } }))
    await disableReminders()
    expect(calls[0]).toMatchObject({ method: 'POST', body: { endpoint: ENDPOINT } })
    expect(calls[0].url).toContain('/push/unsubscribe')
    expect(sub.unsubscribed).toBe(true)
  })

  it('restoreReminderSubscription gửi lại đăng ký khi server đã mất, không tự bật khi chưa từng bật', async () => {
    mockApi(call => ({ body: call.url.includes('/config') ? configBody({ subscribed: false }) : { ok: true } }))
    await restoreReminderSubscription()
    expect(calls).toHaveLength(0) // chưa có đăng ký ở trình duyệt

    browser.subscription = new FakeSubscription(ENDPOINT, PUBLIC_KEY)
    browser.permission = 'granted'
    await restoreReminderSubscription()
    expect(calls.map(c => c.url.replace(/^.*\/api/, ''))).toEqual([`/push/config?endpoint=${encodeURIComponent(ENDPOINT)}`, '/push/subscribe'])

    calls = []
    mockApi(() => ({ body: configBody({ subscribed: true }) }))
    await restoreReminderSubscription()
    expect(calls).toHaveLength(1) // đã có trên server -> không gửi lại
  })

  it('removeReminderSubscriptionOnLogout vẫn hủy ở trình duyệt dù server lỗi', async () => {
    const sub = new FakeSubscription(ENDPOINT, PUBLIC_KEY)
    browser.subscription = sub
    mockApi(() => ({ status: 503, body: { error: 'SQL lỗi' } }))
    await removeReminderSubscriptionOnLogout()
    expect(sub.unsubscribed).toBe(true)
  })
})

describe('dọn nhắc việc khi đổi tài khoản/đăng xuất', () => {
  beforeEach(async () => {
    try { localStorage.removeItem('pwa-notes-last-user'); localStorage.removeItem('pwa-notes-user') } catch { /* ignore */ }
    await db.notes.clear()
  })

  it('đăng nhập tài khoản KHÁC trên cùng trình duyệt hủy đăng ký push của tài khoản trước', async () => {
    mockApi(() => ({ body: { token: 'tok-a', user: { id: 1, username: 'nguoi-a' } } }))
    await login('nguoi-a', '123456')
    const sub = new FakeSubscription(ENDPOINT, PUBLIC_KEY)
    browser.subscription = sub
    mockApi(() => ({ body: { token: 'tok-a2', user: { id: 1, username: 'nguoi-a' } } }))
    await login('nguoi-a', '123456')
    expect(sub.unsubscribed).toBe(false) // cùng tài khoản: giữ nguyên
    mockApi(() => ({ body: { token: 'tok-b', user: { id: 2, username: 'nguoi-b' } } }))
    await login('nguoi-b', '123456')
    expect(sub.unsubscribed).toBe(true)
  })

  it('Đăng xuất gọi gỡ đăng ký trên server bằng token CŨ trước khi xóa token', async () => {
    mockApi(() => ({ body: { token: 'tok-a', user: { id: 1, username: 'nguoi-a' } } }))
    await login('nguoi-a', '123456')
    const sub = new FakeSubscription(ENDPOINT, PUBLIC_KEY)
    browser.subscription = sub
    calls = []
    mockApi(() => ({ body: { ok: true } }))
    const { result } = renderHook(() => useAuth())
    await act(async () => { await result.current.logout() })
    // useAuth có thể làm mới /auth/me lúc mount; thao tác unsubscribe vẫn
    // phải dùng token cũ và xảy ra trước khi phiên bị xóa.
    expect(calls.find(call => call.url.endsWith('/push/unsubscribe'))).toMatchObject({ method: 'POST', body: { endpoint: ENDPOINT }, auth: 'Bearer tok-a' })
    expect(sub.unsubscribed).toBe(true)
    expect(getToken()).toBe(null)
  })
})

describe('ReminderDialog', () => {
  function openDialog() {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    render(<ReminderDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Nhắc việc' }))
  }

  it('báo cần HTTPS/localhost khi không phải secure context, không gọi API', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    mockApi(() => ({ body: configBody() }))
    openDialog()
    expect(screen.getByText(/cần HTTPS hoặc localhost/)).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('báo máy chủ chưa cấu hình VAPID', async () => {
    mockApi(() => ({ body: configBody({ enabled: false, publicKey: null }) }))
    openDialog()
    expect(await screen.findByText(/chưa cấu hình khóa VAPID/)).toBeTruthy()
  })

  it('bật trên thiết bị này rồi hiện trạng thái đang bật và nút Gửi thử', async () => {
    let subscribed = false
    mockApi(call => {
      if (call.url.includes('/push/subscribe')) { subscribed = true; return { body: { ok: true } } }
      if (call.url.includes('/push/test')) return { body: { sent: 1, failed: 0, total: 1 } }
      return { body: configBody({ subscribed }) }
    })
    openDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Bật trên thiết bị này' }))
    expect(await screen.findByText('đang bật nhắc việc')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Gửi thử' }))
    expect(await screen.findByText(/Đã gửi thông báo thử/)).toBeTruthy()
  })

  it('đổi thời điểm nhắc gọi PUT /push/settings', async () => {
    let lead = 15
    mockApi(call => {
      if (call.method === 'PUT') { lead = (call.body as { leadMinutes: number }).leadMinutes; return { body: { ok: true, leadMinutes: lead } } }
      return { body: configBody({ leadMinutes: lead }) }
    })
    openDialog()
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: '60' } })
    await waitFor(() => expect(calls.some(c => c.method === 'PUT' && (c.body as { leadMinutes: number }).leadMinutes === 60)).toBe(true))
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('60'))
  })
})
