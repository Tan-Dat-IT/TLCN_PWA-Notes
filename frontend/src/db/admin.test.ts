import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken, clearToken } from './api'
import {
  listUsers, getUserNotes, createUserByAdmin, updateUserByAdmin, disableUser, enableUser, adminResetPassword,
  promoteUser, demoteUser, assignUser, unassignUser, getAuditLog
} from './admin'

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('db/admin', () => {
  beforeEach(() => {
    setToken('tok-admin')
    vi.unstubAllGlobals()
  })

  it('listUsers gọi GET /admin/users kèm token và trả mảng users', async () => {
    const fetchSpy = mockFetchOnce(200, { users: [{ id: 1, username: 'a' }] })
    const users = await listUsers()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/admin\/users$/)
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer tok-admin')
    expect(users).toEqual([{ id: 1, username: 'a' }])
  })

  it('getUserNotes gọi đúng endpoint theo userId', async () => {
    const fetchSpy = mockFetchOnce(200, { notes: [] })
    await getUserNotes(42)
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/admin\/users\/42\/notes$/)
  })

  it('createUserByAdmin gửi đúng body POST /admin/users', async () => {
    const fetchSpy = mockFetchOnce(201, { user: { id: 2 } })
    await createUserByAdmin('nv1', '123456', 'Nhân viên 1', 'nv1@vidu.com')
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/admin\/users$/)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ username: 'nv1', password: '123456', displayName: 'Nhân viên 1', email: 'nv1@vidu.com' })
  })

  it('updateUserByAdmin gửi PUT kèm displayName/email tới đúng id', async () => {
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await updateUserByAdmin(7, 'Tên mới', 'moi@vidu.com')
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/admin\/users\/7$/)
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body as string)).toEqual({ displayName: 'Tên mới', email: 'moi@vidu.com' })
  })

  it('disableUser/enableUser gọi đúng endpoint POST', async () => {
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await disableUser(7)
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/admin\/users\/7\/disable$/)

    mockFetchOnce(200, { ok: true })
    await enableUser(7)
  })

  it('adminResetPassword gửi mật khẩu mới tới đúng id, không cần mật khẩu cũ', async () => {
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await adminResetPassword(7, 'matkhaumoi')
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/admin\/users\/7\/reset-password$/)
    expect(JSON.parse(options.body as string)).toEqual({ newPassword: 'matkhaumoi' })
  })

  it('ném lỗi rõ ràng khi server trả 403 (không phải admin)', async () => {
    clearToken()
    setToken('tok-thuong')
    mockFetchOnce(403, { error: 'Chỉ tài khoản quản trị mới truy cập được.' })
    await expect(listUsers()).rejects.toThrow('Chỉ tài khoản quản trị mới truy cập được.')
  })

  it('promoteUser/demoteUser gọi đúng endpoint POST theo id', async () => {
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await promoteUser(42)
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/admin\/users\/42\/promote$/)

    mockFetchOnce(200, { ok: true })
    await demoteUser(9)
  })

  it('assignUser gửi adminId trong body POST /admin/users/:id/assign', async () => {
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await assignUser(42, 9)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/admin\/users\/42\/assign$/)
    expect(JSON.parse(options.body as string)).toEqual({ adminId: 9 })
  })

  it('unassignUser gọi đúng endpoint POST theo id', async () => {
    const fetchSpy = mockFetchOnce(200, { ok: true })
    await unassignUser(42)
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/admin\/users\/42\/unassign$/)
  })

  it('ném lỗi rõ ràng khi admin thường thử promote (server trả 403 chỉ root)', async () => {
    mockFetchOnce(403, { error: 'Chỉ tài khoản admin gốc mới thực hiện được thao tác này.' })
    await expect(promoteUser(42)).rejects.toThrow('Chỉ tài khoản admin gốc mới thực hiện được thao tác này.')
  })

  it('getAuditLog gọi GET /admin/audit-log kèm token và trả mảng entries', async () => {
    const entry = { id: 1, actorId: 1, actorUsername: 'root', targetId: 42, targetUsername: 'x', action: 'disable_user', details: null, createdAt: 123 }
    const fetchSpy = mockFetchOnce(200, { entries: [entry] })
    const entries = await getAuditLog()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/admin\/audit-log$/)
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer tok-admin')
    expect(entries).toEqual([entry])
  })

  it('getAuditLog ném lỗi rõ ràng khi admin thường bị chặn (403)', async () => {
    mockFetchOnce(403, { error: 'Chỉ tài khoản quản trị mới truy cập được.' })
    await expect(getAuditLog()).rejects.toThrow('Chỉ tài khoản quản trị mới truy cập được.')
  })
})
