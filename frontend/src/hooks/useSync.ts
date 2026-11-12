import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { synchronize } from '../db/sync'
import { SyncFailure } from '../db/api'

export type SyncStatus = 'offline' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'error'

export function useSync(enabled = true) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [status, setStatus] = useState<SyncStatus>(navigator.onLine ? 'pending' : 'offline')
  const [errorMessage, setErrorMessage] = useState('')
  const retryable = useRef(true)
  const pendingKey = useLiveQuery(async () => (await db.notes.where('synced').equals(0).toArray())
    .map(n => `${n.id}:${n.updatedAt}`).join(','), [])

  const syncNow = useCallback(async () => {
    // Chưa đăng nhập: không gọi API (sẽ luôn bị 401), tránh làm phiền người
    // dùng bằng thông báo lỗi trong khi họ còn đang ở màn hình đăng nhập.
    if (!enabled) return
    if (!navigator.onLine) { setStatus('offline'); return }
    setStatus('syncing')
    try {
      await synchronize()
      retryable.current = true
      setErrorMessage('')
      // Ghi chú đang xung đột chờ người dùng chọn, không tự gửi lại được - tách
      // riêng khỏi "chờ đồng bộ" để vòng thử lại 3 giây không gọi server vô ích.
      const unsynced = await db.notes.where('synced').equals(0).toArray()
      const conflicts = unsynced.filter(n => n.conflict).length
      setStatus(!navigator.onLine ? 'offline' : unsynced.length > conflicts ? 'pending' : conflicts ? 'conflict' : 'synced')
    } catch (error) {
      console.error('Sync error:', error)
      retryable.current = !(error instanceof SyncFailure) || error.retryable
      setErrorMessage(error instanceof SyncFailure ? error.message : 'Không xử lý được dữ liệu trên thiết bị. Kiểm tra quyền lưu trữ và dung lượng trình duyệt.')
      setStatus(navigator.onLine ? 'error' : 'offline')
    }
  }, [enabled])

  useEffect(() => {
    if (pendingKey === undefined) return
    const timer = setTimeout(() => { void syncNow() }, 400)
    return () => clearTimeout(timer)
  }, [pendingKey, syncNow])

  // Khi API vừa phục hồi hoặc thay đổi phát sinh trong request trước,
  // tiếp tục gửi hàng đợi mà không đợi chu kỳ lấy dữ liệu 30 giây.
  useEffect(() => {
    if (!isOnline || !retryable.current || (status !== 'error' && status !== 'pending')) return
    const timer = setInterval(() => { void syncNow() }, 3000)
    return () => clearInterval(timer)
  }, [isOnline, status, syncNow])

  useEffect(() => {
    const online = () => { setIsOnline(true); void syncNow() }
    const offline = () => { setIsOnline(false); setStatus('offline') }
    const resume = () => { if (navigator.onLine) online() }
    const timer = setInterval(() => { if (navigator.onLine && retryable.current) void syncNow() }, 30000)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', resume)
    const visible = () => { if (document.visibilityState === 'visible') resume() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [syncNow])

  return { isOnline, status: pendingKey && status === 'synced' ? 'pending' as const : status, errorMessage, syncNow }
}
