import { useState, type FormEvent } from 'react'
import { login, register, forgotPassword, AuthError } from '../db/auth'

export default function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [forgotMessage, setForgotMessage] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setForgotMessage('')
    try {
      if (mode === 'login') await login(username.trim(), password)
      else if (mode === 'register') await register(username.trim(), password, displayName.trim() || undefined, email.trim())
      else setForgotMessage(await forgotPassword(email.trim()))
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Không thực hiện được. Vui lòng thử lại.')
    } finally { setSaving(false) }
  }

  function switchMode(next: 'login' | 'register' | 'forgot') {
    setMode(next)
    setError('')
    setForgotMessage('')
  }

  return (
    <div className="auth-screen">
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="brand"><span className="brand-mark">n<span>✦</span></span><span>Notes</span></div>
        <h1>{mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Quên mật khẩu'}</h1>
        <p className="auth-caption">
          {mode === 'forgot'
            ? 'Nhập email đã đăng ký (mục tài khoản trong app) để nhận link đặt lại mật khẩu.'
            : 'Ứng dụng dùng nội bộ - đăng nhập để bắt đầu ghi chú và đồng bộ dữ liệu.'}
        </p>
        {mode === 'forgot' ? (
          <label>Email đã đăng ký
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255}
              autoComplete="email" disabled={saving} placeholder="vd: ban@vidu.com" />
          </label>
        ) : (
          <>
            <label>Tên đăng nhập
              <input value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={50}
                autoComplete="username" disabled={saving} placeholder="vd: datdt" />
            </label>
            {mode === 'register' && (
              <label>Tên hiển thị (không bắt buộc)
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={100} disabled={saving} placeholder="vd: Đặng Tấn Đạt" />
              </label>
            )}
            {mode === 'register' && (
              <label>Email khôi phục
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255}
                  autoComplete="email" disabled={saving} placeholder="vd: ban@vidu.com" />
              </label>
            )}
            <label>Mật khẩu
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} maxLength={200}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={saving} placeholder="Ít nhất 6 ký tự" />
            </label>
          </>
        )}
        <button type="submit" disabled={saving || Boolean(forgotMessage)}>
          {saving ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Đăng ký' : 'Gửi email đặt lại mật khẩu'}
        </button>
        {error && <p role="alert">{error}</p>}
        {forgotMessage && <p role="status" className="auth-forgot-success">{forgotMessage}</p>}
        {mode === 'forgot' ? (
          <button type="button" className="auth-switch" disabled={saving} onClick={() => switchMode('login')}>
            Quay lại đăng nhập
          </button>
        ) : (
          <button type="button" className="auth-switch" disabled={saving} onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
          </button>
        )}
        {mode === 'login' && (
          <p className="auth-forgot-hint">
            <button type="button" className="auth-forgot-link" disabled={saving} onClick={() => switchMode('forgot')}>Quên mật khẩu?</button>
          </p>
        )}
      </form>
    </div>
  )
}
