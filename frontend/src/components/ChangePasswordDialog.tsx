import { useRef, useState, type FormEvent } from 'react'
import { changePassword, AuthError } from '../db/auth'

export default function ChangePasswordDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  function reset() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setSuccess(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) { setError('Mật khẩu mới nhập lại không khớp.'); return }
    setSaving(true)
    setError('')
    try {
      await changePassword(currentPassword, newPassword)
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Không đổi được mật khẩu. Vui lòng thử lại.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <button type="button" className="change-password-button" onClick={() => { reset(); dialog.current?.showModal() }}>
        Đổi mật khẩu
      </button>
      <dialog ref={dialog} className="project-dialog change-password-dialog" aria-labelledby="change-password-title">
        <div className="project-dialog-header">
          <p className="eyebrow">TÀI KHOẢN</p>
          <button className="project-close" aria-label="Đóng" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <h2 id="change-password-title">Đổi mật khẩu</h2>
        {success ? (
          <p role="status" className="change-password-success">Đổi mật khẩu thành công. Lần đăng nhập sau dùng mật khẩu mới.</p>
        ) : (
          <form onSubmit={handleSubmit} className="change-password-form">
            <label>Mật khẩu hiện tại
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                required minLength={6} maxLength={200} autoComplete="current-password" disabled={saving} />
            </label>
            <label>Mật khẩu mới
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                required minLength={6} maxLength={200} autoComplete="new-password" disabled={saving} />
            </label>
            <label>Nhập lại mật khẩu mới
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                required minLength={6} maxLength={200} autoComplete="new-password" disabled={saving} />
            </label>
            <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Đổi mật khẩu'}</button>
            {error && <p role="alert">{error}</p>}
          </form>
        )}
      </dialog>
    </>
  )
}
