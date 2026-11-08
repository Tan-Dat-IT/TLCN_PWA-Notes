import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Note } from './db/database'
import App from './App'

vi.mock('./hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, username: 'ui-test', displayName: 'Người kiểm thử' }, isAuthenticated: true, logout: vi.fn() }) }))
vi.mock('./hooks/useSync', () => ({ useSync: () => ({ isOnline: true, status: 'synced', errorMessage: '', syncNow: vi.fn() }) }))
vi.mock('./db/push', async importOriginal => ({ ...await importOriginal<typeof import('./db/push')>(), restoreReminderSubscription: vi.fn() }))
vi.mock('./components/ActivityChart', () => ({ default: () => <div>Biểu đồ hoạt động</div> }))
vi.mock('./components/StatsCharts', () => ({ default: () => <div>Biểu đồ thống kê chi tiết</div> }))
vi.mock('./components/ChangePasswordDialog', () => ({ default: () => null }))
vi.mock('./components/EmailDialog', () => ({ default: () => null }))
vi.mock('./components/ReminderDialog', () => ({ default: () => null }))

const draft = { kind: 'task', title: 'Nộp báo cáo', content: 'Kiểm tra nội dung', tag: 'hoc-tap', startAt: null, dueAt: null }
function task(changes: Partial<Note> = {}): Note {
  return { kind: 'task', status: 'todo', title: 'Việc kiểm thử', content: '', tag: 'chung', createdAt: Date.now(), updatedAt: Date.now(), startAt: null, dueAt: null, completedAt: null, deletedAt: null, done: false, deleted: 0, synced: 1, ...changes }
}
async function generateAi() {
  if (!screen.queryByLabelText('Yêu cầu AI')) fireEvent.click(screen.getByRole('button', { name: 'Mở chatbox tạo bằng AI' }))
  fireEvent.change(await screen.findByLabelText('Yêu cầu AI'), { target: { value: 'Nhắc tôi nộp báo cáo' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mô tả' }))
  return await screen.findByLabelText('Tiêu đề')
}
beforeEach(async () => {
  await db.notes.clear()
  window.history.replaceState(null, '', '/#/dashboard')
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ draft }) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('workspace navigation and AI confirmation', () => {
  it('opens planning as a page, supports refresh and returns with browser Back', async () => {
    const { unmount } = render(<App />)
    const tools = within(document.querySelector('aside')!)
    fireEvent.click(tools.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await waitFor(() => expect(window.location.hash).toBe('#/plan'))
    expect(screen.getByRole('heading', { level: 1, name: 'Gợi ý kế hoạch' })).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Tùy chọn kế hoạch' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    render(<App />)
    expect(await screen.findByRole('form', { name: 'Tùy chọn kế hoạch' })).toBeTruthy()
    await act(async () => window.history.back())
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    expect(screen.queryByRole('form', { name: 'Tùy chọn kế hoạch' })).toBeNull()
  })

  it('opens knowledge with one panel title and without the technical badge', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hỏi đáp ghi chú' }))
    expect(screen.getByRole('dialog', { name: 'Hỏi đáp ghi chú' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: 'Hỏi đáp ghi chú' })).toHaveLength(1)
    expect(screen.queryByText('AI Local · Có nguồn')).toBeNull()
    expect(screen.getByRole('button', { name: 'Tìm câu trả lời' })).toHaveProperty('disabled', true)
  })
  it('starts on dashboard and keeps Statistics in the main workspace across Back and refresh', async () => {
    const { unmount } = render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Tổng quan' })).toBeTruthy()
    const nav = within(screen.getByRole('navigation', { name: 'Không gian làm việc' }))
    fireEvent.click(nav.getByRole('button', { name: /Công việc/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/tasks'))
    fireEvent.click(nav.getByRole('button', { name: 'Thống kê' }))
    expect(await screen.findByText('Biểu đồ thống kê chi tiết')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /Thống kê/ })).toBeNull()
    await act(async () => { window.history.back() })
    await waitFor(() => expect(window.location.hash).toBe('#/tasks'))
    expect(screen.getByRole('heading', { level: 1, name: /Công việc/ })).toBeTruthy()
    unmount()
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /Công việc/ })).toBeTruthy()
  })

  it('opens an AI-filled form without saving and preserves the prompt when cancelled', async () => {
    render(<App />)
    expect(await generateAi()).toHaveProperty('value', 'Nộp báo cáo')
    expect(await db.notes.count()).toBe(0)
    expect(document.querySelector('.workspace-app')?.getAttribute('data-draft-active')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Kiểm tra bản nháp AI' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    await waitFor(() => expect(screen.queryByLabelText('Tiêu đề')).toBeNull())
    expect(screen.getByLabelText('Yêu cầu AI')).toHaveProperty('value', 'Nhắc tôi nộp báo cáo')
    fireEvent.click(screen.getByRole('button', { name: 'Thống kê' }))
    expect(await screen.findByText('Biểu đồ thống kê chi tiết')).toBeTruthy()
    expect(document.querySelector('.workspace-app')?.getAttribute('data-draft-active')).toBe('true')
    expect(await db.notes.count()).toBe(0)
  })

  it('saves the adjusted draft once and clears the prompt only after success', async () => {
    render(<App />)
    const title = await generateAi()
    fireEvent.change(title, { target: { value: 'Báo cáo đã điều chỉnh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }))
    await waitFor(() => expect(window.location.hash).toBe('#/tasks'))
    const saved = await db.notes.toArray()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ title: 'Báo cáo đã điều chỉnh', content: 'Kiểm tra nội dung', kind: 'task', status: 'todo', synced: 0 })
    expect(document.querySelector('.workspace-app')?.hasAttribute('data-draft-active')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bằng AI' }))
    expect(await screen.findByLabelText('Yêu cầu AI')).toHaveProperty('value', '')
  })

  it('retains every edited field after a storage failure and can retry', async () => {
    render(<App />)
    const title = await generateAi()
    fireEvent.change(title, { target: { value: 'Giữ bản nháp khi lỗi' } })
    vi.spyOn(db.notes, 'add').mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Không lưu được ghi chú. Nội dung vẫn được giữ lại, hãy thử lại.')
    expect(screen.getByLabelText('Tiêu đề')).toHaveProperty('value', 'Giữ bản nháp khi lỗi')
    expect(screen.getByLabelText('Nội dung')).toHaveProperty('value', 'Kiểm tra nội dung')
    expect(await db.notes.count()).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }))
    await waitFor(async () => expect(await db.notes.count()).toBe(1))
  })

  it('identifies fallback output as a basic draft before saving', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ draft, fallback: true, warning: 'Ollama đang tắt' }) }))
    render(<App />)
    await generateAi()
    expect(screen.getByRole('dialog', { name: 'Kiểm tra bản nháp cơ bản' })).toBeTruthy()
    expect(screen.getByText(/Đây là bản nháp cơ bản tạo bằng quy tắc/)).toBeTruthy()
    expect(await db.notes.count()).toBe(0)
  })

  it.each(['dashboard', 'tasks', 'notes', 'stats', 'plan', 'all', 'pending', 'conflicts', 'trash'])('opens the shared chat and filled form on %s without navigating', async page => {
    window.history.replaceState(null, '', `/#/${page}`)
    render(<App />)
    const hash = window.location.hash
    expect(await generateAi()).toHaveProperty('value', draft.title)
    expect(window.location.hash).toBe(hash)
    expect(screen.getByLabelText('Tag')).toHaveProperty('value', draft.tag)
    expect(screen.getByLabelText('Nội dung')).toHaveProperty('value', draft.content)
    expect(await db.notes.count()).toBe(0)
  })

  it('continues a minimized request across navigation and opens its form on the current page', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/ai/warmup') ? Promise.resolve({ ok: true }) : new Promise(done => { resolve = done })))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Mở chatbox tạo bằng AI' }))
    fireEvent.change(screen.getByLabelText('Yêu cầu AI'), { target: { value: 'Nộp báo cáo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi mô tả' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn chatbox' }))
    expect(screen.queryByLabelText('Yêu cầu AI')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Thống kê' }))
    await waitFor(() => expect(window.location.hash).toBe('#/stats'))
    await act(async () => { resolve({ ok: true, json: async () => ({ draft }) }) })
    expect(await screen.findByLabelText('Tiêu đề')).toHaveProperty('value', draft.title)
    expect(window.location.hash).toBe('#/stats')
    expect(await db.notes.count()).toBe(0)
  })

  it('queues an AI result while another panel is open instead of replacing it', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/ai/warmup') ? Promise.resolve({ ok: true }) : new Promise(done => { resolve = done })))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Mở chatbox tạo bằng AI' }))
    fireEvent.change(screen.getByLabelText('Yêu cầu AI'), { target: { value: 'Nộp báo cáo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi mô tả' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hỏi đáp ghi chú' }))
    await act(async () => { resolve({ ok: true, json: async () => ({ draft }) }) })
    expect(screen.getByRole('dialog', { name: 'Hỏi đáp ghi chú' })).toBeTruthy()
    expect(screen.queryByLabelText('Tiêu đề')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Đóng bảng chi tiết' }))
    expect(await screen.findByLabelText('Tiêu đề')).toHaveProperty('value', draft.title)
  })

  it('cancels generation when choosing manual entry and ignores late results', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/ai/warmup') ? Promise.resolve({ ok: true }) : new Promise(done => { resolve = done })))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Mở chatbox tạo bằng AI' }))
    fireEvent.change(screen.getByLabelText('Yêu cầu AI'), { target: { value: 'Nộp báo cáo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi mô tả' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nhập thủ công' }))
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Việc nhập tay' } })
    await act(async () => { resolve({ ok: true, json: async () => ({ draft }) }) })
    expect(screen.getByRole('dialog', { name: 'Thêm công việc' })).toBeTruthy()
    expect(screen.getByLabelText('Tiêu đề')).toHaveProperty('value', 'Việc nhập tay')
  })

  it('collapses with Escape, returns focus and keeps the description', async () => {
    render(<App />)
    const opener = screen.getByRole('button', { name: 'Tạo bằng AI' })
    opener.focus()
    fireEvent.click(opener)
    const input = screen.getByLabelText('Yêu cầu AI')
    fireEvent.change(input, { target: { value: 'Nội dung đang nhập' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(opener))
    fireEvent.click(opener)
    expect(screen.getByLabelText('Yêu cầu AI')).toHaveProperty('value', 'Nội dung đang nhập')
  })

  it('uses all active device tags for AI and manual entry regardless of the selected space', async () => {
    await db.notes.bulkAdd([task({ tag: 'hoc-tap', synced: 0 }), task({ kind: 'note', tag: 'ca-nhan' }), task({ tag: 'deleted-only', deleted: 1 })])
    window.history.replaceState(null, '', '/#/notes')
    render(<App />)
    await screen.findByRole('button', { name: /Thêm ghi chú/ })
    await waitFor(() => expect(document.querySelector('.nav-count')?.textContent).toBe('1'))
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú' }))
    const group = await screen.findByRole('group', { name: 'Tag đã dùng' })
    expect(within(group).getByRole('button', { name: 'hoc-tap' })).toBeTruthy()
    expect(within(group).queryByRole('button', { name: 'deleted-only' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    await generateAi()
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/ai/draft'))
    expect(JSON.parse(calls[0][1]!.body as string).existingTags).toEqual(['ca-nhan', 'hoc-tap'])
  })

  it('limits attention to five tasks, sorts deadlines, and opens the matching full filter', async () => {
    await db.notes.bulkAdd(Array.from({ length: 7 }, (_, index) => task({ title: `Quá hạn ${index}`, dueAt: Date.now() - (7 - index) * 86400000 })))
    await db.notes.add(task({ kind: 'note', status: null, title: 'Ghi chú không là công việc', dueAt: Date.now() - 10000 }))
    render(<App />)
    const attention = await screen.findByRole('region', { name: 'Cần chú ý' })
    fireEvent.click(within(screen.getByRole('group', { name: 'Công việc cần chú ý' })).getByRole('button', { name: /Quá hạn/ }))
    await waitFor(() => expect(within(attention).getAllByRole('listitem')).toHaveLength(5))
    expect(within(attention).getAllByRole('listitem')[0].textContent).toContain('Quá hạn 0')
    fireEvent.click(within(attention).getByRole('button', { name: /Xem tất cả/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/tasks?deadline=overdue'))
    expect(screen.getByRole('combobox', { name: 'Lọc theo thời hạn' })).toHaveProperty('value', 'overdue')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Quá hạn \d$/ })).toHaveLength(7))
  })

  it('keeps Tab within the visible menu even when closed details children have layout boxes', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mở điều hướng' }))
    const brand = document.querySelector<HTMLElement>('.brand')!
    const account = document.querySelector<HTMLElement>('.workspace-account > summary')!
    account.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(brand)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(account)
  })

  it('closes mobile navigation with Escape and returns focus to its opener', async () => {
    render(<App />)
    const opener = await screen.findByRole('button', { name: 'Mở điều hướng' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Điều hướng Notes' })).toBeTruthy()
    expect(document.querySelector('main')).toHaveProperty('inert', true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('main')).toHaveProperty('inert', false))
    expect(document.activeElement).toBe(opener)
  })
})
