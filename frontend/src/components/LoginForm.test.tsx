import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoginForm from './LoginForm'
import { clearToken, getToken } from '../db/api'

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => { localStorage.clear(); clearToken() })
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('Tài khoản tuần 10', () => {
  it('đăng nhập lỗi vẫn cho thử lại và chỉ lưu phiên khi thành công', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' }))
      .mockResolvedValueOnce(response(200, { token: 'token-bao', user: { id: 10, username: 'bao' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: ' bao ' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'matkhau123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Sai tên đăng nhập')
    expect(getToken()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
    await waitFor(() => expect(getToken()).toBe('token-bao'))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ username: 'bao', password: 'matkhau123' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sửa email sau khi gửi thành công cho phép gửi tới địa chỉ mới', async () => {
    const message = 'Nếu email đã đăng ký, bạn sẽ nhận được link đặt lại mật khẩu.'
    const fetchMock = vi.fn().mockResolvedValue(response(200, { message }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Quên mật khẩu?' }))
    const email = screen.getByLabelText('Email đã đăng ký')
    fireEvent.change(email, { target: { value: 'nham@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi email đặt lại mật khẩu' }))
    expect((await screen.findByRole('status')).textContent).toBe(message)
    expect((screen.getByRole('button', { name: 'Gửi email đặt lại mật khẩu' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(email, { target: { value: 'bao@example.com' } })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Gửi email đặt lại mật khẩu' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ email: 'bao@example.com' })
    await screen.findByRole('status')
  })

  it('quên mật khẩu lỗi mạng có thể thử lại, chuyển màn hình xóa lỗi cũ', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Quên mật khẩu?' }))
    fireEvent.change(screen.getByLabelText('Email đã đăng ký'), { target: { value: 'bao@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi email đặt lại mật khẩu' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Không kết nối được')
    expect((screen.getByRole('button', { name: 'Gửi email đặt lại mật khẩu' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại đăng nhập' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy()
  })
})
