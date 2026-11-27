import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ResetPasswordForm from './ResetPasswordForm'

afterEach(() => { vi.unstubAllGlobals() })

function fillPasswords(confirm = 'matkhau-moi') {
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'matkhau-moi' } })
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), { target: { value: confirm } })
}

describe('Đặt lại mật khẩu tuần 10', () => {
  it('mật khẩu nhập lại không khớp thì không gọi API', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ResetPasswordForm token="reset-token" onDone={vi.fn()} />)
    fillPasswords('matkhau-khac')
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }))
    expect(screen.getByRole('alert').textContent).toContain('không khớp')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('link hết hạn hiện lỗi từ server và cho quay lại đăng nhập', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Link đặt lại mật khẩu đã hết hạn hoặc đã được sử dụng.' }) }))
    const onDone = vi.fn()
    render(<ResetPasswordForm token="expired-token" onDone={onDone} />)
    fillPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }))
    expect((await screen.findByRole('alert')).textContent).toContain('hết hạn')
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại đăng nhập' }))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('khóa form khi đang gửi, thành công chỉ cho về đăng nhập', async () => {
    let finish!: (value: unknown) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    render(<ResetPasswordForm token="reset-token" onDone={onDone} />)
    fillPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }))
    expect((screen.getByLabelText('Mật khẩu mới') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Đang lưu...' }) as HTMLButtonElement).disabled).toBe(true)
    finish({ ok: true, status: 200, json: async () => ({ ok: true }) })
    expect((await screen.findByRole('status')).textContent).toContain('thành công')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/reset-password$/)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'reset-token', newPassword: 'matkhau-moi' })
    expect(screen.queryByLabelText('Mật khẩu mới')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Về trang đăng nhập' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
