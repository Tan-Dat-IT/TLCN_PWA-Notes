import { useState, type FormEvent } from 'react'
import { resetPassword, AuthError } from '../db/auth'

export default function ResetPasswordForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) { setError('Mật khẩu mới nhập lại không khớp.'); return }
    setSaving(true)
    setError('')
    try {
      await resetPassword(token, newPassword)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Không đặt lại được mật khẩu. Vui lòng thử lại.')
    } finally { setSaving(false) }
  }

  return (
    <div className="auth-screen">
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="brand"><span className="brand-mark">n<span>✦</span></span><span>Notes</span></div>
        <h1>Đặt lại mật khẩu</h1>
        {success ? (
          <>
            <p role="status" className="auth-forgot-success">Đổi mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.</p>
            <button type="button" onClick={onDone}>Về trang đăng nhập</button>
          </>
        ) : (
          <>
            <p className="auth-caption">Nhập mật khẩu mới cho tài khoản. Link này chỉ dùng được một lần và sẽ hết hạn sau một thời gian ngắn.</p>
            <label>Mật khẩu mới
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                required minLength={6} maxLength={200} autoComplete="new-password" disabled={saving} />
            </label>
            <label>Nhập lại mật khẩu mới
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                required minLength={6} maxLength={200} autoComplete="new-password" disabled={saving} />
            </label>
            <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Đặt lại mật khẩu'}</button>
            {error && <p role="alert">{error}</p>}
            <button type="button" className="auth-switch" disabled={saving} onClick={onDone}>Quay lại đăng nhập</button>
          </>
        )}
      </form>
    </div>
  )
}
