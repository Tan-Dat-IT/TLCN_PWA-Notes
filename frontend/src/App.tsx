import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import NoteForm from './components/NoteForm'
import NoteList from './components/NoteList'
import SyncBar from './components/SyncBar'
import ProjectInfo from './components/ProjectInfo'
import StatsView from './components/StatsView'
import PlanningAssistant from './components/PlanningAssistant'
import AIAssistant from './components/AIAssistant'
import KnowledgeAssistant from './components/KnowledgeAssistant'
import type { KnowledgeSource } from './db/knowledge'
import LoginForm from './components/LoginForm'
import ResetPasswordForm from './components/ResetPasswordForm'
import ChangePasswordDialog from './components/ChangePasswordDialog'
import EmailDialog from './components/EmailDialog'
import ReminderDialog from './components/ReminderDialog'
import { restoreReminderSubscription } from './db/push'
import { useNotes, type NoteKindFilter, type NoteView } from './hooks/useNotes'
import { useSync } from './hooks/useSync'
import { useAuth } from './hooks/useAuth'
import './styles.css'

// Chỉ tài khoản admin gốc (duy nhất) dùng tới - tải riêng thành chunk khác,
// tránh phình bundle chính cho mọi tài khoản thường (giống StatsCharts).
const AdminPanel = lazy(() => import('./components/AdminPanel'))
const contentTypeLabels: Record<NoteKindFilter, string> = {
  all: 'Tất cả',
  note: 'Ghi chú',
  task: 'Công việc'
}

const views: { key: NoteView; label: string; icon: string; description: string }[] = [
  { key: 'active', label: 'Tất cả ghi chú/công việc', icon: '▦', description: 'Ý tưởng và công việc của bạn, gọn gàng trong một nơi.' },
  { key: 'todo', label: 'Đang thực hiện', icon: '○', description: 'Công việc chưa hoàn thành và chưa quá hạn.' },
  { key: 'done', label: 'Đã hoàn thành', icon: '✓', description: 'Gồm công việc hoàn thành không trễ và công việc hoàn thành trễ.' },
  { key: 'overdue', label: 'Đang quá hạn', icon: '!', description: 'Công việc chưa hoàn thành đã qua thời hạn bạn đặt.' },
  { key: 'pending', label: 'Nội dung chờ đồng bộ', icon: '↻', description: 'Gồm cả ghi chú và công việc chưa gửi xong lên server.' },
  { key: 'conflict', label: 'Xung đột đồng bộ', icon: '⚠', description: 'Ghi chú bị sửa đồng thời trên thiết bị khác. Chọn bản muốn giữ để tiếp tục đồng bộ.' },
  { key: 'trash', label: 'Đã xóa', icon: '⌫', description: 'Ghi chú đã xóa được giữ lại. Bạn có thể khôi phục bất cứ lúc nào.' }
]

function getResetTokenFromUrl(): string | null {
  try { return new URLSearchParams(window.location.search).get('resetToken') } catch { return null }
}

export default function App() {
  const [resetToken, setResetToken] = useState<string | null>(getResetTokenFromUrl)
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [view, setView] = useState<NoteView>('active')
  const [contentType, setContentType] = useState<NoteKindFilter>('all')
  const [search, setSearch] = useState('')
  const composer = useRef<HTMLDivElement>(null)
  const notesSection = useRef<HTMLElement>(null)
  const { user, isAuthenticated, logout } = useAuth()
  const { notes, allTags, counts, now, addNote, updateNote, toggleDone, deleteNote, restoreNote, resolveConflict } = useNotes(filterTag, view, contentType)
  const { isOnline, status, errorMessage, syncNow } = useSync(isAuthenticated)
  const [error, setError] = useState('')
  // Tự phục hồi đăng ký nhắc việc nếu trình duyệt còn mà server đã mất (xem db/push.ts).
  useEffect(() => { if (isAuthenticated) void restoreReminderSubscription() }, [isAuthenticated, user?.username])
  const currentView = views.find(v => v.key === view)!
  const canFilterContentType = view === 'active' || view === 'pending' || view === 'conflict' || view === 'trash'
  const query = search.trim().toLocaleLowerCase('vi')
  const visibleNotes = notes.filter(n => `${n.title} ${n.content} ${n.tag}`.toLocaleLowerCase('vi').includes(query))
  async function perform(action: () => Promise<void>) {
    try { await action(); setError('') }
    catch { setError('Không lưu được thay đổi trên thiết bị. Vui lòng thử lại.') }
  }
  function newNote() {
    composer.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    composer.current?.querySelector('input')?.focus({ preventScroll: true })
  }
  function selectView(key: NoteView) {
    setView(key)
    setContentType('all')
    setFilterTag(null)
    setSearch('')
    // Chờ React cập nhật danh sách rồi đưa người dùng tới đúng vùng kết quả.
    window.setTimeout(() => notesSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  function openKnowledgeSource(source: KnowledgeSource) {
    setView('active')
    setContentType('all')
    setFilterTag(null)
    setSearch(source.title)
    window.setTimeout(() => notesSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  function openPlannedTask(task: { serverId: string; title: string }) {
    setView('active')
    setContentType('task')
    setFilterTag(null)
    setSearch(task.title)
    window.setTimeout(() => notesSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  if (resetToken) {
    return <ResetPasswordForm token={resetToken} onDone={() => {
      window.history.replaceState(null, '', window.location.pathname)
      setResetToken(null)
    }} />
  }
  if (!isAuthenticated) return <LoginForm />

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#main"><span className="brand-mark">n<span>✦</span></span><span>Notes<span className="brand-caption">KHÔNG GIAN CÁ NHÂN</span></span></a>
        <button className="new-note" onClick={newNote}><span aria-hidden="true">＋</span> Ghi chú mới</button>
        <p className="nav-caption">KHÔNG GIAN LÀM VIỆC</p>
        <nav className="view-filter" aria-label="Lọc trạng thái">
          {/* Mục Xung đột chỉ hiện khi đang có xung đột (hoặc đang mở mục đó) */}
          {views.filter(v => v.key !== 'conflict' || counts.conflict > 0 || view === 'conflict').map(({ key, label, icon }) => <button key={key} aria-pressed={view === key} className={view === key ? 'active' : ''}
            onClick={() => selectView(key)}>
            <span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span><span className="nav-count">{counts[key]}</span>
          </button>)}
        </nav>
        <StatsView />
        <PlanningAssistant onOpenTask={openPlannedTask} />
        <ProjectInfo />
        <div className="sidebar-footer">
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} /><strong>{isOnline ? 'Thiết bị đang online' : 'Bạn đang offline'}</strong>
          <p>Tiếp tục ghi lại ý tưởng, ngay cả khi không có mạng.</p>
          <div className="account-row">
            <span>Xin chào, <strong>{user?.displayName || user?.username}</strong></span>
            <span className="account-email-status">
              {user?.email ? <>Email khôi phục: <strong>{user.email}</strong></> : 'Chưa có email khôi phục'}
            </span>
            <div className="account-actions">
              <ChangePasswordDialog />
              <EmailDialog currentEmail={user?.email} />
              <ReminderDialog />
              {(user?.role === 'admin' || user?.role === 'root') && (
                <Suspense fallback={<button type="button" className="change-password-button" disabled>Đang tải...</button>}>
                  <AdminPanel isRoot={user.role === 'root'} />
                </Suspense>
              )}
              <button type="button" className="logout-button" onClick={logout}>Đăng xuất</button>
            </div>
          </div>
        </div>
      </aside>
      <main id="main" className="workspace">
        <div className="topbar"><span>Không gian làm việc <span className="breadcrumb-divider">/</span> <strong>{currentView.label}</strong></span><span className="desktop-label">NOTES · OFFLINE FIRST</span></div>
        <div className="workspace-content">
          <header className="page-header"><div><p className="eyebrow">MỖI Ý TƯỞNG ĐỀU ĐÁNG ĐƯỢC LƯU GIỮ</p><h1>{currentView.label}</h1><p className="page-description">{currentView.description}</p></div><span className="page-icon" aria-hidden="true">{currentView.icon}</span></header>
          <SyncBar isOnline={isOnline} status={status} errorMessage={errorMessage} onSyncNow={syncNow} />
          <div className="overview-heading">
            <strong>Tổng quan trạng thái</strong>
          </div>
          <div className="overview" aria-label="Tổng quan công việc và đồng bộ dữ liệu">
            <div><span className="stat-mark todo-mark">○</span><div><span>Công việc đang thực hiện</span><strong>{counts.todo}</strong></div></div>
            <div><span className="stat-mark overdue-mark">!</span><div><span>Công việc đang quá hạn</span><strong>{counts.overdue}</strong></div></div>
            <div><span className="stat-mark done-mark">✓</span><div><span>Công việc đã hoàn thành</span><strong>{counts.done}</strong></div></div>
            <div><span className="stat-mark pending-mark">↻</span><div><span>Nội dung chờ đồng bộ</span><strong>{counts.pending}</strong></div></div>
          </div>
          <AIAssistant onApply={addNote} />
          <KnowledgeAssistant onOpenSource={openKnowledgeSource} />
          <div ref={composer} className="composer"><NoteForm onAdd={addNote} /></div>
          <section ref={notesSection} className="notes-section" aria-label="Danh sách ghi chú">
            <div className="list-toolbar"><h2>Ghi chú/công việc của bạn <span>{visibleNotes.length}</span></h2><label className="search-box"><span aria-hidden="true">⌕</span><input type="search" aria-label="Tìm ghi chú" placeholder="Tìm tiêu đề, nội dung, tag..." value={search} onChange={e => setSearch(e.target.value)} /></label></div>
            {canFilterContentType && <div className="content-type-filter" role="group" aria-label="Lọc theo loại nội dung">
              <span>LOẠI HIỂN THỊ</span>
              {(['all', 'note', 'task'] as const).map(type => <button key={type} type="button"
                className={contentType === type ? 'active' : ''} aria-pressed={contentType === type}
                onClick={() => { setContentType(type); setFilterTag(null) }}>{contentTypeLabels[type]}</button>)}
              <small>Đang hiển thị {visibleNotes.length} kết quả thuộc loại {contentTypeLabels[contentType].toLocaleLowerCase('vi')}.</small>
            </div>}
            {(allTags.length > 0 || filterTag) && <div className="tag-filter" aria-label="Lọc theo tag"><span>TAG</span><button className={!filterTag ? 'active' : ''} onClick={() => setFilterTag(null)}>Tất cả</button>{allTags.map(t => <button key={t} className={filterTag === t ? 'active' : ''} onClick={() => setFilterTag(t)}>#{t}</button>)}</div>}
            {error && <p role="alert">{error}</p>}
            <NoteList notes={visibleNotes} now={now} onToggle={note => void perform(() => toggleDone(note))} onDelete={id => void perform(() => deleteNote(id))} onEdit={updateNote} onRestore={id => void perform(() => restoreNote(id))} onResolveConflict={resolveConflict} />
            <p className="list-footnote">Trạng thái hoàn thành và trạng thái đồng bộ được theo dõi riêng biệt.</p>
          </section>
        </div>
      </main>
    </div>
  )
}
