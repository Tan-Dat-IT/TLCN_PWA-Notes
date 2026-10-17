import { describe, it, expect, beforeEach, vi } from 'vitest'
import { login, register, logout, changePassword, updateEmail, forgotPassword, resetPassword, refreshCurrentUser, isAuthenticated, getStoredUser, AuthError } from './auth'
import { clearToken, getToken, setToken } from './api'
import { db, SYNC_CURSOR_KEY } from './database'

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('auth', () => {
  beforeEach(async () => {
    clearToken()
    try { localStorage.removeItem('pwa-notes-last-user') } catch { /* ignore */ }
    vi.unstubAllGlobals()
    await db.notes.clear()
    await db.meta.clear()
  })

  it('login lưu token và thông tin user khi thành công', async () => {
    mockFetchOnce(200, { token: 'tok-1', user: { id: 1, username: 'demo', displayName: 'Demo' } })
    const user = await login('demo', '123456')
    expect(user.username).toBe('demo')
    expect(isAuthenticated()).toBe(true)
    expect(getStoredUser()?.displayName).toBe('Demo')
  })

  it('login ném AuthError với message từ server khi sai mật khẩu', async () => {
    mockFetchOnce(401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' })
    await expect(login('demo', 'sai')).rejects.toThrow(AuthError)
    expect(isAuthenticated()).toBe(false)
  })

  it('register lưu token khi thành công', async () => {
    mockFetchOnce(201, { token: 'tok-2', user: { id: 2, username: 'moi', displayName: 'Moi', email: 'moi@vidu.com' } })
    await register('moi', '123456', 'Moi', 'moi@vidu.com')
    expect(isAuthenticated()).toBe(true)
  })

  it('register gửi kèm email nếu người dùng điền lúc đăng ký, và cache đúng email trả về', async () => {
    const fetchSpy = mockFetchOnce(201, { token: 'tok-2b', user: { id: 3, username: 'coemail', email: 'coemail@vidu.com' } })
    await register('coemail', '123456', undefined, 'coemail@vidu.com')
    const [, options] = fetchSpy.mock.calls[0]
    expect(JSON.parse(options.body as string).email).toBe('coemail@vidu.com')
    expect(getStoredUser()?.email).toBe('coemail@vidu.com')
  })

  it('register ném AuthError khi username đã tồn tại', async () => {
    mockFetchOnce(409, { error: 'Tên đăng nhập đã tồn tại.' })
    await expect(register('trung', '123456')).rejects.toThrow('Tên đăng nhập đã tồn tại.')
  })

  it('logout xóa token và thông tin user đã lưu', async () => {
    mockFetchOnce(200, { token: 'tok-3', user: { id: 3, username: 'x' } })
    await login('x', '123456')
    expect(isAuthenticated()).toBe(true)
    logout()
    expect(isAuthenticated()).toBe(false)
    expect(getStoredUser()).toBe(null)
  })

  it('đăng nhập bằng tài khoản khác trên cùng thiết bị sẽ dọn sạch cache ghi chú cũ', async () => {
    mockFetchOnce(200, { token: 'tok-a', user: { id: 1, username: 'nguoi-a' } })
    await login('nguoi-a', '123456')
    await db.notes.add({
      serverId: 's1', kind: 'note', createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
      title: 'Note của A', content: '', tag: 'chung', done: false, updatedAt: 1, synced: 0, deleted: 0
    })
    expect(await db.notes.count()).toBe(1)

    mockFetchOnce(200, { token: 'tok-b', user: { id: 2, username: 'nguoi-b' } })
    await login('nguoi-b', '123456')
    expect(await db.notes.count()).toBe(0)
  })

  it('đổi tài khoản xóa cả con trỏ đồng bộ delta (nếu còn, tài khoản mới sẽ thiếu dữ liệu cũ hơn con trỏ)', async () => {
    mockFetchOnce(200, { token: 'tok-a', user: { id: 1, username: 'nguoi-a' } })
    await login('nguoi-a', '123456')
    await db.meta.put({ key: SYNC_CURSOR_KEY, value: '12345' })
    mockFetchOnce(200, { token: 'tok-b', user: { id: 2, username: 'nguoi-b' } })
    await login('nguoi-b', '123456')
    expect(await db.meta.get(SYNC_CURSOR_KEY)).toBeUndefined()
  })

  it('đăng nhập lại cùng tài khoản giữ nguyên con trỏ đồng bộ', async () => {
    mockFetchOnce(200, { token: 'tok-a', user: { id: 1, username: 'nguoi-a' } })
    await login('nguoi-a', '123456')
    await db.meta.put({ key: SYNC_CURSOR_KEY, value: '12345' })
    mockFetchOnce(200, { token: 'tok-a2', user: { id: 1, username: 'nguoi-a' } })
    await login('nguoi-a', '123456')
    expect((await db.meta.get(SYNC_CURSOR_KEY))?.value).toBe('12345')
  })

  it('đăng nhập lại cùng một tài khoản không xóa cache', async () => {
    mockFetchOnce(200, { token: 'tok-a', user: { id: 1, username: 'nguoi-a' } })
    await login('nguoi-a', '123456')
    await db.notes.add({
      serverId: 's1', kind: 'note', createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
      title: 'Note của A', content: '', tag: 'chung', done: false, updatedAt: 1, synced: 0, deleted: 0
    })

    mockFetchOnce(200, { token: 'tok-a2', user: { id: 1, username: 'nguoi-a' } })
    await login('nguoi-a', '123456')
    expect(await db.notes.count()).toBe(1)
  })

  it('changePassword đính kèm token hiện tại vào header Authorization', async () => {
    setToken('tok-hien-tai')
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await changePassword('matkhaucu', 'matkhaumoi')
    const [, options] = fetchSpy.mock.calls[0]
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer tok-hien-tai')
  })

  it('changePassword ném AuthError với message từ server khi sai mật khẩu hiện tại (không đăng xuất)', async () => {
    setToken('tok-hien-tai')
    mockFetchOnce(401, { error: 'Mật khẩu hiện tại không đúng.' })
    await expect(changePassword('sai', 'matkhaumoi')).rejects.toThrow('Mật khẩu hiện tại không đúng.')
    // Khác request() dùng chung: 401 ở đây không phải "hết hạn phiên" nên
    // không được tự đăng xuất - token vẫn còn nguyên.
    expect(isAuthenticated()).toBe(true)
  })

  it('updateEmail đính kèm token và cập nhật cache user local sau khi lưu thành công', async () => {
    setToken('tok-hien-tai')
    localStorage.setItem('pwa-notes-user', JSON.stringify({ id: 1, username: 'demo' }))
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await updateEmail('demo@vidu.com')
    const [, options] = fetchSpy.mock.calls[0]
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer tok-hien-tai')
    expect(getStoredUser()?.email).toBe('demo@vidu.com')
  })

  it('forgotPassword không đính kèm token (chưa đăng nhập) và trả về message từ server', async () => {
    const fetchSpy = mockFetchOnce(200, { ok: true, message: 'Nếu email tồn tại...' })
    const message = await forgotPassword('demo@vidu.com')
    const [, options] = fetchSpy.mock.calls[0]
    expect((options.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(message).toBe('Nếu email tồn tại...')
  })

  it('resetPassword ném AuthError khi token hết hạn', async () => {
    mockFetchOnce(400, { error: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu link mới.' })
    await expect(resetPassword('token-het-han', 'matkhaumoi')).rejects.toThrow(AuthError)
  })

  it('refreshCurrentUser cập nhật profile cache mới nhất từ /auth/me', async () => {
    setToken('tok-hien-tai')
    localStorage.setItem('pwa-notes-user', JSON.stringify({ id: 1, username: 'demo', role: 'user' }))
    mockFetchOnce(200, { user: { id: 1, username: 'demo', displayName: 'Tên mới', email: 'moi@vidu.com', role: 'admin' } })
    await refreshCurrentUser()
    expect(getStoredUser()).toMatchObject({ displayName: 'Tên mới', email: 'moi@vidu.com', role: 'admin' })
  })

  it('refreshCurrentUser xóa phiên khi /auth/me trả 401', async () => {
    setToken('tok-het-han')
    localStorage.setItem('pwa-notes-user', JSON.stringify({ id: 1, username: 'demo' }))
    mockFetchOnce(401, { error: 'Phiên đăng nhập đã hết hạn.' })
    await expect(refreshCurrentUser()).rejects.toThrow(AuthError)
    expect(isAuthenticated()).toBe(false)
    expect(getStoredUser()).toBe(null)
  })

  it('refreshCurrentUser không để response phiên cũ ghi đè tài khoản vừa đăng nhập', async () => {
    setToken('tok-cu')
    localStorage.setItem('pwa-notes-user', JSON.stringify({ id: 1, username: 'cu' }))
    let resolveFetch!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveFetch = resolve })))
    const refreshing = refreshCurrentUser()

    setToken('tok-moi')
    localStorage.setItem('pwa-notes-user', JSON.stringify({ id: 2, username: 'moi' }))
    resolveFetch({ ok: true, status: 200, json: async () => ({ user: { id: 1, username: 'cu', role: 'admin' } }) })

    await expect(refreshing).rejects.toThrow(/Phiên đăng nhập đã thay đổi/)
    expect(getStoredUser()).toMatchObject({ id: 2, username: 'moi' })
    expect(getToken()).toBe('tok-moi')
  })
})
