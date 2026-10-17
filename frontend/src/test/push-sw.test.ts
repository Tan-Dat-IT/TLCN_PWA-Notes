import { describe, it, expect, vi } from 'vitest'
import code from '../../public/push-sw.js?raw'

// Chạy đúng file public/push-sw.js (được importScripts vào sw.js) trong một
// "self" giả lập của Service Worker để kiểm tra nội dung thông báo và hành vi bấm.

function loadWorker(windows: { url: string; focus: () => unknown }[] = []) {
  const listeners: Record<string, (event: unknown) => void> = {}
  const shown: { title: string; options: NotificationOptions & { data?: { url: string } } }[] = []
  const opened: string[] = []
  const self = {
    registration: { scope: 'https://app.test/', showNotification: async (title: string, options: NotificationOptions) => { shown.push({ title, options }) } },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => { opened.push(url) } },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn }
  }
  new Function('self', code)(self)
  async function push(data: unknown) {
    let waited: Promise<unknown> = Promise.resolve()
    listeners.push({ data: data === undefined ? null : { json: () => (typeof data === 'string' ? JSON.parse(data) : data) }, waitUntil: (p: Promise<unknown>) => { waited = p } })
    await waited
    return shown[shown.length - 1]
  }
  async function click() {
    let waited: Promise<unknown> = Promise.resolve()
    const notification = { close: vi.fn(), data: { url: 'https://app.test/' } }
    listeners.notificationclick({ notification, waitUntil: (p: Promise<unknown>) => { waited = p } })
    await waited
    return { notification, opened }
  }
  return { push, click }
}

describe('public/push-sw.js', () => {
  it('nhắc 1 công việc sắp đến hạn: tiêu đề, nội dung có tên việc, tag theo ghi chú', async () => {
    const shown = await loadWorker().push({ type: 'reminder', title: 'Nộp báo cáo', dueAt: Date.now() + 15 * 60000, tag: 'reminder-abc' })
    expect(shown.title).toBe('Công việc sắp đến hạn')
    expect(shown.options.body).toMatch(/^Nộp báo cáo - hạn /)
    expect(shown.options.tag).toBe('reminder-abc')
    expect(shown.options.icon).toBe('https://app.test/icons/icon-192.png')
  })

  it('công việc đã qua hạn (nhắc bù) đổi tiêu đề thành quá hạn', async () => {
    const shown = await loadWorker().push({ type: 'reminder', title: 'X', dueAt: Date.now() - 60000, tag: 't' })
    expect(shown.title).toBe('Công việc đang quá hạn')
  })

  it('thông báo tóm tắt khi nhiều việc cùng lúc', async () => {
    const shown = await loadWorker().push({ type: 'summary', count: 5, titles: ['A', 'B', 'C'], dueAt: Date.now(), tag: 'reminder-summary' })
    expect(shown.title).toBe('5 công việc sắp đến hạn')
    expect(shown.options.body).toBe('A, B, C và 2 việc khác')
  })

  it('thông báo gửi thử', async () => {
    expect((await loadWorker().push({ type: 'test', tag: 'reminder-test' })).title).toBe('Nhắc việc đã hoạt động')
  })

  it('payload hỏng/rỗng vẫn hiện thông báo (trình duyệt bắt buộc userVisibleOnly), không ném lỗi', async () => {
    const worker = loadWorker()
    expect((await worker.push('không phải json{')).title).toBeTruthy()
    expect((await worker.push(undefined)).title).toBeTruthy()
  })

  it('bấm thông báo: đưa cửa sổ app đang mở lên trước, không mở thêm', async () => {
    const focus = vi.fn()
    const { notification, opened } = await loadWorker([{ url: 'https://app.test/?x=1', focus }]).click()
    expect(notification.close).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(opened).toEqual([])
  })

  it('bấm thông báo khi app chưa mở: mở cửa sổ mới', async () => {
    const { opened } = await loadWorker([]).click()
    expect(opened).toEqual(['https://app.test/'])
  })
})
