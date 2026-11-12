import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveApiUrl, getToken, setToken, clearToken, request, SyncFailure, API_URL, API_ROOT } from './api'

describe('resolveApiUrl', () => {
  it('ưu tiên VITE_API_URL khi được cấu hình và bỏ dấu / cuối', () => {
    expect(resolveApiUrl('https://example.com/api/notes/', { hostname: 'x', protocol: 'https:', port: '' })).toBe('https://example.com/api/notes')
  })
  it('gọi thẳng cổng 4000 khi ở localhost cổng dev/preview qua http', () => {
    expect(resolveApiUrl(undefined, { hostname: 'localhost', protocol: 'http:', port: '5173' })).toBe('http://localhost:4000/api/notes')
    expect(resolveApiUrl(undefined, { hostname: '127.0.0.1', protocol: 'http:', port: '4173' })).toBe('http://127.0.0.1:4000/api/notes')
  })
  it('dùng đường dẫn tương đối cho origin production khác', () => {
    expect(resolveApiUrl(undefined, { hostname: 'app.example.com', protocol: 'https:', port: '' })).toBe('/api/notes')
  })
  it('không tự chuyển cổng khi https (không phải dev server)', () => {
    expect(resolveApiUrl(undefined, { hostname: 'localhost', protocol: 'https:', port: '5173' })).toBe('/api/notes')
  })
})

describe('API_ROOT', () => {
  it('bỏ hậu tố /notes khỏi API_URL để dùng cho auth/ai', () => {
    expect(API_URL.endsWith('/notes')).toBe(true)
    expect(API_ROOT).toBe(API_URL.replace(/\/notes$/, ''))
  })
})

describe('token storage', () => {
  beforeEach(() => { clearToken() })
  it('getToken trả null khi chưa đăng nhập', () => {
    expect(getToken()).toBe(null)
  })
  it('setToken/getToken/clearToken hoạt động round-trip', () => {
    setToken('abc.def.ghi')
    expect(getToken()).toBe('abc.def.ghi')
    clearToken()
    expect(getToken()).toBe(null)
  })
})

describe('request() xử lý 401', () => {
  beforeEach(() => {
    setToken('tok-cu')
    vi.unstubAllGlobals()
  })

  // Hồi quy: từ khi requireAuth tra DB mỗi request (backend), 401 không còn
  // chỉ nghĩa "hết hạn phiên" - tài khoản bị admin khóa giữa chừng cũng trả
  // 401 kèm message riêng ("Tài khoản đã bị vô hiệu hóa..."). request() từng
  // luôn hiện cứng chữ "hết hạn phiên" mà không đọc message thật từ backend.
  it('đọc đúng message lỗi từ backend khi 401 (không hiện cứng "hết hạn phiên")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: 'Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.' })
    }))
    await expect(request('http://x/api/notes')).rejects.toThrow('Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.')
    expect(getToken()).toBe(null) // vẫn phải tự đăng xuất như cũ
  })

  it('dùng message mặc định "hết hạn phiên" khi 401 không kèm body JSON hợp lệ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => { throw new Error('not json') }
    }))
    await expect(request('http://x/api/notes')).rejects.toThrow('Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại.')
  })

  it('lỗi 401 không thể thử lại (retryable=false)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    try {
      await request('http://x/api/notes')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(SyncFailure)
      expect((err as InstanceType<typeof SyncFailure>).retryable).toBe(false)
    }
  })
})
