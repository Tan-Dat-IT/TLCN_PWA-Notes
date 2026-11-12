import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginForm from './LoginForm'
import AdminPanel from './AdminPanel'
import { setToken, clearToken } from '../db/api'
import { unlockLogin, type AdminUserRow } from '../db/admin'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('Màn hình đăng nhập - số lượt còn lại và bị chặn', () => {
  beforeEach(() => { vi.unstubAllGlobals(); clearToken() })

  it('hiện đúng thông báo của server: còn N lượt, rồi bị tạm chặn', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Sai tên đăng nhập hoặc mật khẩu. Bạn còn 4 lượt thử trước khi tài khoản bị tạm chặn đăng nhập.', remainingAttempts: 4 }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'Tài khoản tạm bị chặn đăng nhập do nhập sai mật khẩu 5 lần. Thử lại sau 15 phút, hoặc liên hệ quản trị viên để được mở chặn.' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'saimatkhau' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
    expect(await screen.findByText(/Bạn còn 4 lượt thử/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
    expect(await screen.findByText(/tạm bị chặn đăng nhập.*liên hệ quản trị viên/)).toBeTruthy()
  })
})

describe('Quản trị - mở chặn đăng nhập', () => {
  const lockedRow: AdminUserRow = {
    id: 42, username: 'thanh-vien', displayName: 'Thành viên', email: null, role: 'user', disabled: false,
    loginLockedUntil: Date.now() + 10 * 60000, failedLoginCount: 5, createdAt: 0,
    managedByAdminId: 9, managedByUsername: 'admin-thuong', noteCount: 0, activeCount: 0, todoCount: 0, doneCount: 0, overdueCount: 0
  }
  beforeEach(() => {
    vi.unstubAllGlobals()
    setToken('tok-admin')
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
  })
  afterEach(() => { clearToken() })

  it('unlockLogin gọi POST /admin/users/:id/unlock-login kèm token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await unlockLogin(42)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/admin\/users\/42\/unlock-login$/)
    expect(options.method).toBe('POST')
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer tok-admin')
  })

  it('tài khoản đang bị chặn: hiện nhãn + nút "Mở chặn đăng nhập"; bấm thì gọi API và tải lại danh sách', async () => {
    let locked = true
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/unlock-login') && init?.method === 'POST') { locked = false; return jsonResponse(200, { ok: true }) }
      return jsonResponse(200, { users: [{ ...lockedRow, loginLockedUntil: locked ? lockedRow.loginLockedUntil : null, failedLoginCount: locked ? 5 : 0 }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    render(<AdminPanel isRoot={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quản trị' }))
    expect(await screen.findByText(/Tạm chặn đăng nhập \(sai mật khẩu 5 lần\) - còn 10 phút/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mở chặn đăng nhập' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mở chặn đăng nhập' })).toBeNull())
    expect(screen.queryByText(/Tạm chặn đăng nhập/)).toBeNull()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/admin/users/42/unlock-login') && init?.method === 'POST')).toBe(true)
  })

  it('tài khoản không bị chặn thì không có nút mở chặn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { users: [{ ...lockedRow, loginLockedUntil: null, failedLoginCount: 0 }] })))
    render(<AdminPanel isRoot={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quản trị' }))
    expect(await screen.findByText('thanh-vien')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mở chặn đăng nhập' })).toBeNull()
  })
})
