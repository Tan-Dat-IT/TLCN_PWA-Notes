import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { db, SYNC_CURSOR_KEY } from '../db/database'
import { clearToken } from '../db/api'
import { login, updateEmail } from '../db/auth'
import { useAuth } from './useAuth'

function mockLoginOnce() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ token: 'tok', user: { id: 1, username: 'demo' } })
  }))
}

async function addPendingNote() {
  await db.notes.add({
    serverId: 's1', kind: 'note', createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
    title: 'Chưa đồng bộ', content: '', tag: 'chung', done: false, updatedAt: 1, synced: 0, deleted: 0
  })
}

beforeEach(async () => {
  clearToken()
  try { localStorage.removeItem('pwa-notes-user') } catch { /* ignore */ }
  try { localStorage.removeItem('pwa-notes-last-user') } catch { /* ignore */ }
  await db.notes.clear()
  vi.unstubAllGlobals()
})

async function loginAsDemo() {
  mockLoginOnce()
  await login('demo', '123456')
  vi.unstubAllGlobals()
}

describe('useAuth logout', () => {
  it('đăng xuất ngay không hỏi xác nhận khi không có ghi chú chờ đồng bộ', async () => {
    await loginAsDemo()
    const confirmSpy = vi.fn()
    vi.stubGlobal('confirm', confirmSpy)
    const { result } = renderHook(() => useAuth())
    expect(result.current.isAuthenticated).toBe(true)
    await act(async () => { await result.current.logout() })
    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.isAuthenticated).toBe(false))
  })

  it('hỏi xác nhận và hủy đăng xuất nếu người dùng từ chối khi còn ghi chú chờ đồng bộ', async () => {
    await loginAsDemo()
    await addPendingNote()
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    const { result } = renderHook(() => useAuth())
    await act(async () => { await result.current.logout() })
    expect(result.current.isAuthenticated).toBe(true)
    expect(await db.notes.count()).toBe(1)
  })

  it('xóa cache và đăng xuất khi người dùng xác nhận dù còn ghi chú chờ đồng bộ', async () => {
    await loginAsDemo()
    await addPendingNote()
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const { result } = renderHook(() => useAuth())
    await act(async () => { await result.current.logout() })
    await waitFor(() => expect(result.current.isAuthenticated).toBe(false))
    expect(await db.notes.count()).toBe(0)
  })

  it('đăng xuất xóa cả con trỏ đồng bộ delta', async () => {
    await loginAsDemo()
    await db.meta.put({ key: SYNC_CURSOR_KEY, value: '999' })
    const { result } = renderHook(() => useAuth())
    await act(async () => { await result.current.logout() })
    expect(await db.meta.get(SYNC_CURSOR_KEY)).toBeUndefined()
  })
})

describe('useAuth email khôi phục', () => {
  // Hồi quy: updateEmail() không đổi token nên request() dùng chung không tự
  // phát AUTH_CHANGE_EVENT - nếu quên phát thủ công, user.email trong
  // useAuth() sẽ không cập nhật cho tới lần đăng nhập kế tiếp (xem db/auth.ts).
  it('user.email cập nhật ngay sau updateEmail() mà không cần đăng nhập lại', async () => {
    await loginAsDemo()
    const { result } = renderHook(() => useAuth())
    expect(result.current.user?.email).toBeUndefined()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    await act(async () => { await updateEmail('demo@vidu.com') })
    vi.unstubAllGlobals()

    await waitFor(() => expect(result.current.user?.email).toBe('demo@vidu.com'))
  })
})
