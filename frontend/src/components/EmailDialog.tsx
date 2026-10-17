import { useRef, useState, type FormEvent } from 'react'
import { updateEmail, AuthError } from '../db/auth'

export default function EmailDialog({ currentEmail }: { currentEmail?: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  function open() {
    setEmail(currentEmail || '')
    setError('')
    setSuccess(false)
    dialog.current?.showModal()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateEmail(email.trim())
      setSuccess(true)
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Không lưu được email. Vui lòng thử lại.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <button type="button" className="change-password-button" onClick={open}>
        {currentEmail ? 'Đổi email khôi phục' : 'Thêm email khôi phục'}
      </button>
      <dialog ref={dialog} className="project-dialog change-password-dialog" aria-labelledby="email-dialog-title">
        <div className="project-dialog-header">
          <p className="eyebrow">TÀI KHOẢN</p>
          <button className="project-close" aria-label="Đóng" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <h2 id="email-dialog-title">Email khôi phục mật khẩu</h2>
        {success ? (
          <p role="status" className="change-password-success">Đã lưu email. Từ giờ có thể dùng "Quên mật khẩu?" ở màn hình đăng nhập với email này.</p>
        ) : (
          <form onSubmit={handleSubmit} className="change-password-form">
            <p className="auth-caption">Dùng để nhận link đặt lại mật khẩu khi quên. Không bắt buộc nếu bạn chỉ dùng cách đặt lại qua CLI.</p>
            <label>Email
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255}
                autoComplete="email" disabled={saving} placeholder="vd: ban@vidu.com" />
            </label>
            <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu email'}</button>
            {error && <p role="alert">{error}</p>}
          </form>
        )}
      </dialog>
    </>
  )
}
