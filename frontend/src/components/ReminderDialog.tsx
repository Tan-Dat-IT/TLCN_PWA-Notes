import { useRef, useState } from 'react'
import { AuthError } from '../db/auth'
import {
  REMINDER_LEAD_OPTIONS, disableReminders, enableReminders, getPushConfig, sendTestNotification,
  setReminderLeadMinutes, type PushConfig
} from '../db/push'
import { getBrowserSubscription, pushSupport } from '../lib/pushSubscription'

function leadLabel(minutes: number) {
  if (minutes === 0) return 'Đúng lúc đến hạn'
  if (minutes < 60) return `Trước ${minutes} phút`
  if (minutes < 1440) return `Trước ${minutes / 60} giờ`
  return 'Trước 1 ngày'
}

type State = { loading: true } | { loading: false; config: PushConfig | null; thisDevice: boolean }

// Cài đặt nhắc việc (Web Push) cho tài khoản + thiết bị hiện tại.
export default function ReminderDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [state, setState] = useState<State>({ loading: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const support = pushSupport()

  async function refresh() {
    setState({ loading: true })
    try {
      const subscription = await getBrowserSubscription()
      const config = await getPushConfig(subscription?.endpoint)
      setState({ loading: false, config, thisDevice: Boolean(subscription && config.subscribed) })
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Không tải được cài đặt nhắc việc.')
      setState({ loading: false, config: null, thisDevice: false })
    }
  }

  function open() {
    setError('')
    setInfo('')
    dialog.current?.showModal()
    if (support === 'supported') void refresh()
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await action()
      setInfo(success)
      await refresh()
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Thao tác không thành công. Vui lòng thử lại.')
    } finally { setBusy(false) }
  }

  const config = !state.loading ? state.config : null
  const thisDevice = !state.loading && state.thisDevice

  return (
    <>
      <button type="button" className="change-password-button" onClick={open}>Nhắc việc</button>
      <dialog ref={dialog} className="project-dialog change-password-dialog" aria-labelledby="reminder-dialog-title">
        <div className="project-dialog-header">
          <p className="eyebrow">THÔNG BÁO</p>
          <button className="project-close" aria-label="Đóng" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <h2 id="reminder-dialog-title">Nhắc việc sắp đến hạn</h2>
        <div className="change-password-form reminder-settings">
          <p className="auth-caption">Nhận thông báo của hệ điều hành khi công việc có hạn hoàn thành sắp đến hạn - kể cả khi đã đóng ứng dụng. Chỉ nhắc công việc đã đồng bộ lên server, chưa hoàn thành và chưa xóa.</p>
          {support === 'insecure' && <p role="alert">Nhắc việc cần HTTPS hoặc localhost. Địa chỉ hiện tại (http qua mạng LAN) không được trình duyệt cho phép dùng Web Push.</p>}
          {support === 'unsupported' && <p role="alert">Trình duyệt này không hỗ trợ Web Push. Hãy dùng Chrome hoặc Edge bản mới.</p>}
          {support === 'supported' && state.loading && <p>Đang tải cài đặt...</p>}
          {support === 'supported' && config && !config.enabled && <p role="alert">Máy chủ chưa cấu hình khóa VAPID nên chưa bật được nhắc việc (người quản trị chạy <code>npm run vapid-keys</code> trong thư mục backend, xem README).</p>}
          {support === 'supported' && config?.enabled && config.publicKey && <>
            <p className="reminder-status" role="status">
              Thiết bị này: <strong>{thisDevice ? 'đang bật nhắc việc' : 'chưa bật nhắc việc'}</strong>
              {typeof Notification !== 'undefined' && Notification.permission === 'denied' && ' - trình duyệt đang chặn thông báo cho trang này'}
            </p>
            <label>Thời điểm nhắc (áp dụng cho mọi thiết bị của tài khoản)
              <select value={config.leadMinutes} disabled={busy}
                onChange={e => void run(() => setReminderLeadMinutes(Number(e.target.value)), 'Đã lưu thời điểm nhắc.')}>
                {REMINDER_LEAD_OPTIONS.map(m => <option key={m} value={m}>{leadLabel(m)}</option>)}
                {!(REMINDER_LEAD_OPTIONS as readonly number[]).includes(config.leadMinutes) && <option value={config.leadMinutes}>{leadLabel(config.leadMinutes)}</option>}
              </select>
            </label>
            <div className="reminder-actions">
              {thisDevice
                ? <button type="button" disabled={busy} onClick={() => void run(disableReminders, 'Đã tắt nhắc việc trên thiết bị này.')}>Tắt trên thiết bị này</button>
                : <button type="button" disabled={busy} onClick={() => void run(() => enableReminders(config.publicKey!), 'Đã bật nhắc việc trên thiết bị này.')}>Bật trên thiết bị này</button>}
              {thisDevice && <button type="button" disabled={busy} onClick={() => void run(async () => {
                const result = await sendTestNotification()
                if (result.sent === 0) throw new AuthError('Chưa gửi được tới thiết bị nào (dịch vụ push của trình duyệt không phản hồi). Kiểm tra kết nối Internet rồi thử lại.')
              }, 'Đã gửi thông báo thử - kiểm tra góc màn hình.')}>Gửi thử</button>}
            </div>
            <p className="auth-caption">Thông báo đi qua dịch vụ push của trình duyệt (Google/Microsoft...) nên máy chủ và thiết bị cần có Internet; nội dung được mã hóa, dịch vụ trung gian không đọc được. Đăng xuất sẽ tự tắt nhắc việc trên thiết bị này.</p>
          </>}
          {info && <p role="status" className="change-password-success">{info}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      </dialog>
    </>
  )
}
