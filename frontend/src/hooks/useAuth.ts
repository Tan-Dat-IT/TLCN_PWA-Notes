import { useCallback, useEffect, useState } from 'react'
import { AUTH_CHANGE_EVENT, getToken } from '../db/api'
import { getStoredUser, logout as clearSession, refreshCurrentUser, type AuthUser } from '../db/auth'
import { clearLocalData, db } from '../db/database'
import { removeReminderSubscriptionOnLogout } from '../db/push'

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? getStoredUser() : null))

  useEffect(() => {
    const sync = () => setUser(getToken() ? getStoredUser() : null)
    const refresh = () => {
      if (getToken() && navigator.onLine) void refreshCurrentUser().catch(() => { /* giữ cache để tiếp tục offline */ })
    }
    window.addEventListener(AUTH_CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    window.addEventListener('online', refresh)
    window.addEventListener('focus', refresh)
    refresh()
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
      window.removeEventListener('online', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // Thiết bị có thể được người khác đăng nhập tiếp theo (xem db/auth.ts) -
  // dọn cache local trước khi đăng xuất để không lẫn dữ liệu giữa hai tài
  // khoản. Cảnh báo trước nếu còn thay đổi chưa kịp đồng bộ lên server.
  const logout = useCallback(async () => {
    const pending = await db.notes.where('synced').equals(0).count()
    if (pending > 0) {
      const confirmed = window.confirm(
        `Bạn có ${pending} ghi chú chưa đồng bộ lên server. Đăng xuất sẽ xóa dữ liệu ghi chú trên thiết bị này để tài khoản khác có thể đăng nhập an toàn - những ghi chú CHƯA đồng bộ sẽ mất vĩnh viễn. Vẫn đăng xuất?`
      )
      if (!confirmed) return
    }
    // Gỡ nhắc việc của thiết bị này khỏi tài khoản TRƯỚC khi xóa token (cần
    // token để gọi API) - người dùng kế tiếp trên máy không nhận thông báo
    // công việc của người vừa đăng xuất.
    await removeReminderSubscriptionOnLogout()
    await clearLocalData()
    clearSession()
  }, [])

  return { user, isAuthenticated: user !== null, logout }
}
