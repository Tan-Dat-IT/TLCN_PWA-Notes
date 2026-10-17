import { useRef, useState, useCallback, useEffect, type FormEvent } from 'react'
import {
  listUsers, getUserNotes, createUserByAdmin, updateUserByAdmin, disableUser, enableUser, unlockLogin, adminResetPassword,
  promoteUser, demoteUser, assignUser, unassignUser, getAuditLog,
  type AdminUserRow, type AdminNote, type AuditLogEntry
} from '../db/admin'
import { AuthError } from '../db/auth'
import { formatTime, isCompletedLate, isOverdue, taskDisplayStatus, TASK_STATUS_LABELS } from '../db/noteFields'

type View = { name: 'list' } | { name: 'create' } | { name: 'edit'; user: AdminUserRow }
  | { name: 'reset'; user: AdminUserRow } | { name: 'notes'; user: AdminUserRow } | { name: 'assign'; user: AdminUserRow }
  | { name: 'audit' }

export default function AdminPanel({ isRoot }: { isRoot: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>({ name: 'list' })

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try { setUsers(await listUsers()) }
    catch (err) { setError(err instanceof AuthError ? err.message : 'Không tải được danh sách người dùng.') }
    finally { setLoading(false) }
  }, [])

  function open() {
    setView({ name: 'list' })
    dialog.current?.showModal()
    void reload()
  }

  async function handleToggleDisabled(u: AdminUserRow) {
    const confirmMsg = u.disabled
      ? `Mở khóa đăng nhập cho tài khoản "${u.username}"?`
      : `Khóa đăng nhập tài khoản "${u.username}"? Người này sẽ không đăng nhập được cho tới khi được mở khóa lại. Dữ liệu ghi chú của họ KHÔNG bị xóa hay ảnh hưởng.`
    if (!window.confirm(confirmMsg)) return
    setError('')
    try {
      if (u.disabled) await enableUser(u.id); else await disableUser(u.id)
      await reload()
    } catch (err) { setError(err instanceof AuthError ? err.message : 'Không thực hiện được thao tác.') }
  }

  async function handleUnlockLogin(u: AdminUserRow) {
    if (!window.confirm(`Mở chặn đăng nhập cho "${u.username}"? Tài khoản này đang bị tạm chặn do nhập sai mật khẩu nhiều lần; mở chặn thì họ đăng nhập lại được ngay và có đủ lượt thử mới.`)) return
    setError('')
    try { await unlockLogin(u.id); await reload() }
    catch (err) { setError(err instanceof AuthError ? err.message : 'Không mở chặn được.') }
  }

  async function handlePromote(u: AdminUserRow) {
    if (!window.confirm(`Phân quyền admin cho "${u.username}"? Họ sẽ có trang Quản trị riêng, nhưng chỉ quản lý được thành viên do bạn gán sau này.`)) return
    setError('')
    try { await promoteUser(u.id); await reload() }
    catch (err) { setError(err instanceof AuthError ? err.message : 'Không phân quyền được.') }
  }

  async function handleDemote(u: AdminUserRow) {
    if (!window.confirm(`Hạ quyền admin "${u.username}" về user thường? Mọi thành viên họ đang quản lý sẽ bị bỏ gán (chưa ai quản lý cho tới khi bạn gán lại).`)) return
    setError('')
    try { await demoteUser(u.id); await reload() }
    catch (err) { setError(err instanceof AuthError ? err.message : 'Không hạ quyền được.') }
  }

  async function handleUnassign(u: AdminUserRow) {
    if (!window.confirm(`Bỏ gán "${u.username}" khỏi admin "${u.managedByUsername}"? Sẽ chưa có admin nào quản lý thành viên này cho tới khi gán lại.`)) return
    setError('')
    try { await unassignUser(u.id); await reload() }
    catch (err) { setError(err instanceof AuthError ? err.message : 'Không bỏ gán được.') }
  }

  const admins = users.filter(u => u.role === 'admin')

  return (
    <>
      <button type="button" className="change-password-button" onClick={open}>Quản trị</button>
      <dialog ref={dialog} className="project-dialog admin-dialog" aria-labelledby="admin-panel-title">
        <div className="project-dialog-header">
          <p className="eyebrow">QUẢN TRỊ</p>
          <button className="project-close" aria-label="Đóng" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <h2 id="admin-panel-title">{isRoot ? 'Quản lý người dùng (toàn hệ thống)' : 'Quản lý thành viên được giao'}</h2>
        {error && <p role="alert">{error}</p>}
        {view.name === 'list' && (
          <UserListView users={users} loading={loading} isRoot={isRoot}
            onAdd={() => setView({ name: 'create' })}
            onEdit={u => setView({ name: 'edit', user: u })}
            onReset={u => setView({ name: 'reset', user: u })}
            onView={u => setView({ name: 'notes', user: u })}
            onAssign={u => setView({ name: 'assign', user: u })}
            onToggleDisabled={u => void handleToggleDisabled(u)}
            onUnlockLogin={u => void handleUnlockLogin(u)}
            onPromote={u => void handlePromote(u)}
            onDemote={u => void handleDemote(u)}
            onUnassign={u => void handleUnassign(u)}
            onOpenAudit={() => setView({ name: 'audit' })}
            onReload={() => void reload()} />
        )}
        {view.name === 'create' && (
          <UserFormView mode="create" onBack={() => setView({ name: 'list' })}
            onSaved={() => { setView({ name: 'list' }); void reload() }} />
        )}
        {view.name === 'edit' && (
          <UserFormView mode="edit" user={view.user} onBack={() => setView({ name: 'list' })}
            onSaved={() => { setView({ name: 'list' }); void reload() }} />
        )}
        {view.name === 'reset' && (
          <ResetPasswordView user={view.user} onBack={() => setView({ name: 'list' })} />
        )}
        {view.name === 'notes' && (
          <UserNotesView user={view.user} onBack={() => setView({ name: 'list' })} />
        )}
        {view.name === 'assign' && (
          <AssignView user={view.user} admins={admins} onBack={() => setView({ name: 'list' })}
            onSaved={() => { setView({ name: 'list' }); void reload() }} />
        )}
        {view.name === 'audit' && (
          <AuditLogView onBack={() => setView({ name: 'list' })} />
        )}
      </dialog>
    </>
  )
}

function roleLabel(role: AdminUserRow['role']) {
  return role === 'root' ? 'root' : role === 'admin' ? 'admin' : null
}

function UserListView({ users, loading, isRoot, onAdd, onEdit, onReset, onView, onAssign, onToggleDisabled, onUnlockLogin, onPromote, onDemote, onUnassign, onOpenAudit, onReload }: {
  users: AdminUserRow[]; loading: boolean; isRoot: boolean
  onAdd: () => void; onEdit: (u: AdminUserRow) => void; onReset: (u: AdminUserRow) => void
  onView: (u: AdminUserRow) => void; onAssign: (u: AdminUserRow) => void; onToggleDisabled: (u: AdminUserRow) => void; onUnlockLogin: (u: AdminUserRow) => void
  onPromote: (u: AdminUserRow) => void; onDemote: (u: AdminUserRow) => void; onUnassign: (u: AdminUserRow) => void
  onOpenAudit: () => void; onReload: () => void
}) {
  return (
    <>
      <div className="admin-toolbar">
        {isRoot && <button type="button" onClick={onAdd}>+ Thêm người dùng</button>}
        {isRoot && <button type="button" onClick={onOpenAudit}>Nhật ký</button>}
        <button type="button" onClick={onReload} disabled={loading}>{loading ? 'Đang tải...' : 'Làm mới'}</button>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Tài khoản</th><th>Email</th><th>Ngày tạo</th>
              <th>Đang thực hiện</th><th>Đã hoàn thành</th><th>Đang quá hạn</th>
              {isRoot && <th>Quản lý bởi</th>}
              <th>Trạng thái</th><th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={u.disabled ? 'admin-row-disabled' : ''}>
                <td><strong>{u.username}</strong>{roleLabel(u.role) && <span className="admin-badge">{roleLabel(u.role)}</span>}<br /><span className="admin-muted">{u.displayName}</span></td>
                <td>{u.email || <span className="admin-muted">Chưa có</span>}</td>
                <td>{new Date(u.createdAt).toLocaleDateString('vi-VN')}</td>
                <td>{Math.max(0, u.todoCount - u.overdueCount)}</td>
                <td>{u.doneCount}</td>
                <td>{u.overdueCount}</td>
                {isRoot && (
                  <td>
                    {u.role !== 'user' ? <span className="admin-muted">—</span>
                      : u.managedByUsername ? u.managedByUsername
                      : <span className="admin-muted">Chưa gán</span>}
                  </td>
                )}
                <td>
                  {u.disabled ? <span className="admin-status-disabled">Đã khóa</span> : <span className="admin-status-active">Hoạt động</span>}
                  {u.loginLockedUntil !== null && (
                    <span className="admin-status-locked" title={`Tự mở lúc ${new Date(u.loginLockedUntil).toLocaleTimeString('vi-VN')}`}>
                      Tạm chặn đăng nhập (sai mật khẩu {u.failedLoginCount} lần) - còn {Math.max(1, Math.ceil((u.loginLockedUntil - Date.now()) / 60000))} phút
                    </span>
                  )}
                </td>
                <td className="admin-actions">
                  <button type="button" onClick={() => onView(u)}>Xem</button>
                  <button type="button" onClick={() => onEdit(u)}>Sửa</button>
                  <button type="button" onClick={() => onReset(u)}>Đặt lại mật khẩu</button>
                  {u.loginLockedUntil !== null && <button type="button" onClick={() => onUnlockLogin(u)}>Mở chặn đăng nhập</button>}
                  {u.role === 'user' && <button type="button" onClick={() => onToggleDisabled(u)}>{u.disabled ? 'Mở khóa' : 'Khóa'}</button>}
                  {isRoot && u.role === 'user' && <button type="button" onClick={() => onAssign(u)}>{u.managedByUsername ? 'Đổi admin quản lý' : 'Gán quản lý'}</button>}
                  {isRoot && u.role === 'user' && u.managedByUsername && <button type="button" onClick={() => onUnassign(u)}>Bỏ gán</button>}
                  {isRoot && u.role === 'user' && <button type="button" onClick={() => onPromote(u)}>Phân quyền admin</button>}
                  {isRoot && u.role === 'admin' && <button type="button" onClick={() => onDemote(u)}>Hạ quyền</button>}
                </td>
              </tr>
            ))}
            {users.length === 0 && !loading && (
              <tr><td colSpan={isRoot ? 9 : 8} className="admin-muted">Chưa có người dùng nào{isRoot ? '' : ' được giao cho bạn quản lý'}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function UserFormView({ mode, user, onBack, onSaved }: {
  mode: 'create' | 'edit'; user?: AdminUserRow; onBack: () => void; onSaved: () => void
}) {
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (mode === 'create') await createUserByAdmin(username.trim(), password, displayName.trim() || username.trim(), email.trim())
      else await updateUserByAdmin(user!.id, displayName.trim(), email.trim())
      onSaved()
    } catch (err) { setError(err instanceof AuthError ? err.message : 'Không lưu được. Vui lòng thử lại.') }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="change-password-form admin-form">
      <h3>{mode === 'create' ? 'Thêm người dùng mới' : `Sửa thông tin "${user!.username}"`}</h3>
      {mode === 'create' && (
        <>
          <label>Tên đăng nhập
            <input value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={50} disabled={saving} />
          </label>
          <label>Mật khẩu
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} maxLength={200} disabled={saving} />
          </label>
        </>
      )}
      <label>Tên hiển thị
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={100} disabled={saving} placeholder={mode === 'create' ? '(mặc định trùng tên đăng nhập)' : undefined} />
      </label>
      <label>Email
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255} disabled={saving} />
      </label>
      <div className="admin-form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</button>
        <button type="button" className="auth-switch" disabled={saving} onClick={onBack}>Quay lại danh sách</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

function ResetPasswordView({ user, onBack }: { user: AdminUserRow; onBack: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try { await adminResetPassword(user.id, newPassword); setSuccess(true) }
    catch (err) { setError(err instanceof AuthError ? err.message : 'Không đặt lại được mật khẩu.') }
    finally { setSaving(false) }
  }

  return (
    <div className="admin-form">
      <h3>Đặt lại mật khẩu cho "{user.username}"</h3>
      {success ? (
        <>
          <p role="status" className="change-password-success">Đã đặt mật khẩu mới. Báo người dùng đăng nhập lại bằng mật khẩu này.</p>
          <button type="button" onClick={onBack}>Quay lại danh sách</button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="change-password-form">
          <p className="auth-caption">Không cần biết mật khẩu cũ của người dùng - đặt thẳng mật khẩu mới.</p>
          <label>Mật khẩu mới
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} maxLength={200} disabled={saving} />
          </label>
          <div className="admin-form-actions">
            <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Đặt lại mật khẩu'}</button>
            <button type="button" className="auth-switch" disabled={saving} onClick={onBack}>Quay lại danh sách</button>
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  )
}

// Chỉ root mở được view này (nút "Gán quản lý"/"Đổi/bỏ gán" chỉ hiện khi
// isRoot). Chọn 1 trong các tài khoản Role='admin' hiện có để gán user này
// cho họ quản lý - danh sách admin lấy từ chính danh sách user đã tải (root
// thấy toàn bộ), không cần gọi API riêng.
function AssignView({ user, admins, onBack, onSaved }: {
  user: AdminUserRow; admins: AdminUserRow[]; onBack: () => void; onSaved: () => void
}) {
  const [adminId, setAdminId] = useState(user.managedByAdminId ? String(user.managedByAdminId) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await assignUser(user.id, Number(adminId))
      onSaved()
    } catch (err) { setError(err instanceof AuthError ? err.message : 'Không gán được.') }
    finally { setSaving(false) }
  }

  return (
    <div className="admin-form">
      <h3>Gán "{user.username}" cho admin quản lý</h3>
      {admins.length === 0 ? (
        <>
          <p className="auth-caption">Chưa có tài khoản admin nào - phân quyền admin cho một user trước (nút "Phân quyền admin" ở danh sách), rồi quay lại đây để gán thành viên.</p>
          <button type="button" className="auth-switch" onClick={onBack}>Quay lại danh sách</button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="change-password-form">
          <label>Admin phụ trách
            <select value={adminId} onChange={e => setAdminId(e.target.value)} required disabled={saving}>
              <option value="" disabled>-- Chọn admin --</option>
              {admins.map(a => <option key={a.id} value={a.id}>{a.username}{a.displayName && a.displayName !== a.username ? ` (${a.displayName})` : ''}</option>)}
            </select>
          </label>
          <div className="admin-form-actions">
            <button type="submit" disabled={saving || !adminId}>{saving ? 'Đang lưu...' : 'Gán'}</button>
            <button type="button" className="auth-switch" disabled={saving} onClick={onBack}>Quay lại danh sách</button>
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  )
}

function UserNotesView({ user, onBack }: { user: AdminUserRow; onBack: () => void }) {
  const [notes, setNotes] = useState<AdminNote[] | null>(null)
  const [error, setError] = useState('')
  const now = Date.now()

  useEffect(() => {
    getUserNotes(user.id).then(setNotes).catch(err => setError(err instanceof AuthError ? err.message : 'Không tải được ghi chú.'))
  }, [user.id])

  const active = notes?.filter(n => n.deleted === 0) ?? []
  const done = active.filter(n => n.kind === 'task' && n.done)
  const overdue = active.filter(n => isOverdue(n, now))
  const completedLate = active.filter(isCompletedLate)
  const completedOnTime = done.filter(n => !isCompletedLate(n))
  const inProgress = active.filter(n => n.kind === 'task' && !n.done && !isOverdue(n, now))

  return (
    <div className="admin-form">
      <h3>Ghi chú/công việc của "{user.username}" <span className="admin-muted">(chỉ xem)</span></h3>
      {error && <p role="alert">{error}</p>}
      {notes === null && !error && <p>Đang tải...</p>}
      {notes !== null && (
        <>
          <p className="stats-scope-note"><strong>{active.length} nội dung chưa xóa.</strong> Các thẻ dưới đây chỉ thống kê công việc.</p>
          <div className="stats-summary admin-notes-summary">
            <div><span>Công việc đang thực hiện</span><strong>{inProgress.length}</strong></div>
            <div><span>Công việc đang quá hạn</span><strong>{overdue.length}</strong></div>
            <div><span>Đã hoàn thành (không trễ)</span><strong>{completedOnTime.length}</strong></div>
            <div><span>Đã hoàn thành trễ</span><strong>{completedLate.length}</strong></div>
          </div>
          <ul className="admin-notes-list">
            {active.map(n => (
              <li key={n.serverId} className={n.done ? 'done' : ''}>
                <strong>{n.title}</strong>
                <div className="note-meta">
                  <span className="note-kind">{n.kind === 'task' ? 'Công việc' : 'Ghi chú'}</span>
                  {n.kind === 'task' && (() => {
                    const status = taskDisplayStatus(n, now)
                    const className = status === 'overdue' ? 'overdue-status' : status === 'completed_late' ? 'late-status' : `task-status ${status === 'completed' ? 'complete' : ''}`
                    return <span className={className}>{TASK_STATUS_LABELS[status]}</span>
                  })()}
                  <span className="tag">#{n.tag}</span>
                </div>
                <dl className="note-dates">
                  {n.startAt !== null && <div><dt>Bắt đầu</dt><dd>{formatTime(n.startAt)}</dd></div>}
                  {n.dueAt !== null && <div><dt>Hạn hoàn thành</dt><dd>{formatTime(n.dueAt)}</dd></div>}
                  {n.done && <div><dt>Hoàn thành lúc</dt><dd>{formatTime(n.completedAt)}</dd></div>}
                </dl>
              </li>
            ))}
            {active.length === 0 && <li className="admin-muted">Người dùng chưa có ghi chú/công việc nào.</li>}
          </ul>
        </>
      )}
      <div className="admin-form-actions">
        <button type="button" className="auth-switch" onClick={onBack}>Quay lại danh sách</button>
      </div>
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = {
  create_user: 'Tạo tài khoản', edit_user: 'Sửa thông tin', disable_user: 'Khóa đăng nhập', enable_user: 'Mở khóa đăng nhập', unlock_login: 'Mở chặn đăng nhập (sai mật khẩu)',
  reset_password: 'Đặt lại mật khẩu', promote: 'Phân quyền admin', demote: 'Hạ quyền admin', assign: 'Gán quản lý', unassign: 'Bỏ gán quản lý'
}

// Chỉ root mở được (nút "Nhật ký" chỉ hiện khi isRoot ở UserListView).
function AuditLogView({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getAuditLog().then(setEntries).catch(err => setError(err instanceof AuthError ? err.message : 'Không tải được nhật ký.'))
  }, [])

  return (
    <div className="admin-form">
      <h3>Nhật ký hành động quản trị <span className="admin-muted">(tối đa 200 dòng gần nhất)</span></h3>
      {error && <p role="alert">{error}</p>}
      {entries === null && !error && <p>Đang tải...</p>}
      {entries !== null && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString('vi-VN')}</td>
                  <td>{e.actorUsername}</td>
                  <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td>{e.targetUsername ?? <span className="admin-muted">—</span>}</td>
                  <td>{e.details ?? <span className="admin-muted">—</span>}</td>
                </tr>
              ))}
              {entries.length === 0 && <tr><td colSpan={5} className="admin-muted">Chưa có hành động quản trị nào được ghi nhận.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="admin-form-actions">
        <button type="button" className="auth-switch" onClick={onBack}>Quay lại danh sách</button>
      </div>
    </div>
  )
}
