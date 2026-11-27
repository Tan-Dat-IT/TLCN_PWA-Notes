import { useState } from 'react'
import { AuthError } from '../db/auth'
import {
  REMINDER_LEAD_OPTIONS, disableReminders, enableReminders, getPushConfig, sendTestNotification,
  setReminderLeadMinutes, type PushConfig
} from '../db/push'
import { getBrowserSubscription, pushSupport, sameApplicationServerKey } from '../lib/pushSubscription'
import DialogFrame, { useDialogController } from './DialogFrame'

function leadLabel(minutes: number) {
  if (minutes === 0) return 'Đúng lúc đến hạn'
  if (minutes < 60) return `Trước ${minutes} phút`
  if (minutes < 1440) return `Trước ${minutes / 60} giờ`
  return 'Trước 1 ngày'
}

type State = { loading: true } | { loading: false; config: PushConfig | null; thisDevice: boolean }

// Cài đặt nhắc việc (Web Push) cho tài khoản + thiết bị hiện tại.
export default function ReminderDialog() {
  const dialog = useDialogController()
  const [state, setState] = useState<State>({ loading: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const support = pushSupport()
  const permissionDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied'

  async function refresh() {
    setState({ loading: true })
    setError('')
    try {
      const subscription = await getBrowserSubscription()
      const config = await getPushConfig(subscription?.endpoint)
      setState({ loading: false, config, thisDevice: Boolean(subscription && config.subscribed && config.publicKey && sameApplicationServerKey(subscription, config.publicKey)) })
      return true
    } catch (err) {
      setInfo('')
      setError(err instanceof AuthError ? err.message : 'Không tải được cài đặt nhắc việc.')
      setState({ loading: false, config: null, thisDevice: false })
      return false
    }
  }

  function open() {
    setError('')
    setInfo('')
    dialog.open()
    if (support === 'supported') void refresh()
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await action()
      if (await refresh()) setInfo(success)
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Thao tác không thành công. Vui lòng thử lại.')
    } finally { setBusy(false) }
  }

  const config = !state.loading ? state.config : null
  const thisDevice = !state.loading && state.thisDevice

  return (
    <>
      <button type="button" className="change-password-button" onClick={open}>Nhắc việc</button>
      <DialogFrame dialogRef={dialog.dialogRef} onClose={dialog.restoreFocus} size="small"
        eyebrow="THÔNG BÁO" title="Nhắc việc sắp đến hạn" titleId="reminder-dialog-title">
        <div className="change-password-form reminder-settings">
          <p className="auth-caption">Nhận thông báo của hệ điều hành khi công việc có hạn hoàn thành sắp đến hạn - kể cả khi đã đóng ứng dụng. Chỉ nhắc công việc đã đồng bộ lên server, chưa hoàn thành và chưa xóa.</p>
          {support === 'insecure' && <p role="alert">Nhắc việc cần HTTPS hoặc localhost. Địa chỉ hiện tại (http qua mạng LAN) không được trình duyệt cho phép dùng Web Push.</p>}
          {support === 'unsupported' && <p role="alert">Trình duyệt hoặc chế độ mở hiện tại chưa hỗ trợ thông báo Web Push.</p>}
          {support === 'supported' && state.loading && <p role="status">Đang tải cài đặt...</p>}
          {support === 'supported' && config && !config.enabled && <p role="alert">Máy chủ chưa bật nhắc việc. Liên hệ người quản trị để cấu hình thông báo.</p>}
          {support === 'supported' && config?.enabled && config.publicKey && <>
            <p className={`reminder-status${permissionDenied ? ' reminder-status-blocked' : ''}`} role="status">
              Thiết bị này: <strong>{permissionDenied ? 'đang bị chặn thông báo' : thisDevice ? 'đang bật nhắc việc' : 'chưa bật nhắc việc'}</strong>
            </p>
            {permissionDenied && <p role="alert">Trình duyệt đang chặn thông báo cho trang này. Mở cài đặt trang cạnh thanh địa chỉ, cho phép Thông báo rồi mở lại mục Nhắc việc.</p>}
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
                : <button type="button" disabled={busy || permissionDenied} onClick={() => void run(() => enableReminders(config.publicKey!), 'Đã bật nhắc việc trên thiết bị này.')}>Bật trên thiết bị này</button>}
              {thisDevice && !permissionDenied && <button type="button" disabled={busy} onClick={() => void run(async () => {
                const result = await sendTestNotification()
                if (result.sent === 0) throw new AuthError('Chưa gửi được tới thiết bị nào (dịch vụ push của trình duyệt không phản hồi). Kiểm tra kết nối Internet rồi thử lại.')
              }, 'Đã gửi thông báo thử - kiểm tra góc màn hình.')}>Gửi thử</button>}
            </div>
            <p className="auth-caption">Thông báo đi qua dịch vụ push của trình duyệt (Google/Microsoft...) nên máy chủ và thiết bị cần có Internet; nội dung được mã hóa, dịch vụ trung gian không đọc được. Đăng xuất sẽ tự tắt nhắc việc trên thiết bị này.</p>
          </>}
          {info && <p role="status" className="change-password-success">{info}</p>}
          {error && <p role="alert">{error}</p>}
          {support === 'supported' && !state.loading && !config && <button type="button" disabled={busy} onClick={() => void refresh()}>Thử tải lại</button>}
        </div>
      </DialogFrame>
    </>
  )
}
