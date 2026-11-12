import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, CalendarRange, ChartNoAxesCombined, Check, ChevronDown, Cloud, FileText, FolderOpen, House, LayoutGrid, LayoutList, ListTodo, Menu, Plus, Search, Sparkles, Trash2, WifiOff, X } from 'lucide-react'
import NoteForm from './components/NoteForm'
import TaskBoard from './components/TaskBoard'
import ContentList from './components/ContentList'
import WorkspacePanel from './components/WorkspacePanel'
import TaskDetails from './components/TaskDetails'
import SyncBar from './components/SyncBar'
import StatsView from './components/StatsView'
import PlanningAssistant from './components/PlanningAssistant'
import Dashboard from './components/Dashboard'
import AIChatBox from './components/AIChatBox'
import type { AiDraftResult } from './db/ai'
import KnowledgeAssistant from './components/KnowledgeAssistant'
import type { KnowledgeSource } from './db/knowledge'
import LoginForm from './components/LoginForm'
import ThemeControl from './components/ThemeControl'
import ResetPasswordForm from './components/ResetPasswordForm'
import ChangePasswordDialog from './components/ChangePasswordDialog'
import EmailDialog from './components/EmailDialog'
import ReminderDialog from './components/ReminderDialog'
import { restoreReminderSubscription } from './db/push'
import type { Note, TaskStatus } from './db/database'
import type { NoteInput } from './db/noteFields'
import { matchesDeadline, type DeadlineFilter } from './lib/stats'
import type { Page } from './lib/navigation'
import { useWorkspaceRoute } from './hooks/useWorkspaceRoute'
import { useNotes, type NoteKindFilter, type NoteView } from './hooks/useNotes'
import { useSync } from './hooks/useSync'
import { useAuth } from './hooks/useAuth'
import { useAiDraft } from './hooks/useAiDraft'
import { collectExistingTags } from './lib/tags'
import './styles.css'
import './workspace.css'
import './dashboard.css'
import './theme.css'
import './ai-tools.css'
import './ai-chat.css'

const AdminPanel = lazy(() => import('./components/AdminPanel'))
type Panel = { kind: 'create'; initial: NoteInput; ai?: { warning: string | null } } | { kind: 'detail' | 'edit'; id: number } | { kind: 'knowledge' }
const pageLabels: Record<Page, string> = { dashboard: 'Tổng quan', tasks: 'Công việc', notes: 'Ghi chú', stats: 'Thống kê', plan: 'Gợi ý kế hoạch', all: 'Tất cả nội dung', pending: 'Chờ đồng bộ', conflicts: 'Xung đột đồng bộ', trash: 'Thùng rác' }

function getResetTokenFromUrl(): string | null {
  try { return new URLSearchParams(window.location.search).get('resetToken') } catch { return null }
}

export default function App() {
  const [resetToken, setResetToken] = useState<string | null>(getResetTokenFromUrl)
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const { page, deadline, navigate } = useWorkspaceRoute()
  const view: NoteView = page === 'trash' ? 'trash' : page === 'pending' ? 'pending' : page === 'conflicts' ? 'conflict' : 'active'
  const contentType: NoteKindFilter = page === 'tasks' ? 'task' : page === 'notes' ? 'note' : 'all'
  const [search, setSearch] = useState('')
  const [layout, setLayout] = useState<'board' | 'list'>(() => {
    try { return localStorage.getItem('pwa-notes-task-layout') === 'list' ? 'list' : 'board' } catch { return 'board' }
  })
  const [panel, setPanel] = useState<Panel | null>(null)
  const [toast, setToast] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiFocusRequest, setAiFocusRequest] = useState(0)
  const [aiOpen, setAiOpen] = useState(false)
  const [pendingAiDraft, setPendingAiDraft] = useState<AiDraftResult | null>(null)
  const sidebar = useRef<HTMLElement>(null)
  const main = useRef<HTMLElement>(null)
  const pendingSearch = useRef<string | null>(null)
  const { user, isAuthenticated, logout } = useAuth()
  const { notes, allNotes, allTags, counts, summary, now, isLoading, addNote, updateNote, moveTask, deleteNote, restoreNote, resolveConflict } = useNotes(filterTag, view, contentType)
  const { isOnline, status, errorMessage, syncNow } = useSync(isAuthenticated)
  const accountKey = user ? JSON.stringify([user.id, user.username]) : null
  const existingAiTags = collectExistingTags(allNotes)
  const ai = useAiDraft({ accountKey, text: aiText, existingTags: existingAiTags, isOnline, onDraft: setPendingAiDraft })

  useEffect(() => { if (isAuthenticated) void restoreReminderSubscription() }, [isAuthenticated, user?.username])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { setSearch(pendingSearch.current ?? ''); pendingSearch.current = null; setFilterTag(null); setPanel(null); setMobileNavOpen(false) }, [page])
  useEffect(() => { setAiText(''); setAiOpen(false); setPendingAiDraft(null); setPanel(null); setToast('') }, [accountKey])
  useEffect(() => {
    if (!pendingAiDraft) return
    const show = () => {
      if (panel || mobileNavOpen || document.querySelector('dialog[open]')) return
      setAiOpen(false)
      setPanel({ kind: 'create', initial: pendingAiDraft.draft, ai: { warning: pendingAiDraft.warning } })
      setPendingAiDraft(null)
    }
    show()
    const observer = new MutationObserver(show)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => observer.disconnect()
  }, [pendingAiDraft, panel, mobileNavOpen])
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 760px)')
    const resize = () => { if (!media?.matches) setMobileNavOpen(false) }
    media?.addEventListener('change', resize)
    return () => media?.removeEventListener('change', resize)
  }, [])
  useEffect(() => {
    if (!mobileNavOpen) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const workspace = main.current
    const wasInert = workspace?.inert ?? false
    const overflow = document.body.style.overflow
    if (workspace) workspace.inert = true
    document.body.style.overflow = 'hidden'
    sidebar.current?.querySelector<HTMLElement>('.mobile-nav-close')?.focus()
    const trap = (event: KeyboardEvent) => {
      // Tool/account dialogs use native modal focus management.
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape') { event.preventDefault(); setMobileNavOpen(false) }
      if (event.key !== 'Tab') return
      const targets = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),summary,input,select,textarea,[tabindex="0"]') ?? [])
        .filter(element => {
          if (!element.getClientRects().length || element.closest('dialog:not([open]),[hidden]')) return false
          // Chromium can return layout rectangles for children of closed details.
          for (let parent = element.parentElement; parent && parent !== sidebar.current; parent = parent.parentElement) {
            if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false
          }
          return true
        })
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => {
      if (workspace) workspace.inert = wasInert
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', trap)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [mobileNavOpen])

  const taskSpace = page === 'tasks'
  const pageTitle = pageLabels[page]
  const completed = counts.done
  const completion = summary.completionRate
  const query = search.trim().toLocaleLowerCase('vi')
  const visibleNotes = notes.filter(note => `${note.title} ${note.content} ${note.tag}`.toLocaleLowerCase('vi').includes(query))
    .filter(note => !taskSpace || matchesDeadline(note, deadline, now))
  const isFiltered = !!query || !!filterTag || (taskSpace && deadline !== 'all')
  const selectedNote = panel && (panel.kind === 'detail' || panel.kind === 'edit') ? allNotes.find(note => note.id === panel.id) : undefined

  function clearFilters() { setSearch(''); setFilterTag(null); if (taskSpace) navigate('tasks') }
  function selectPage(next: Page) { setSearch(''); setFilterTag(null); setMobileNavOpen(false); navigate(next) }
  function selectSpace(kind: NoteKindFilter) { selectPage(kind === 'task' ? 'tasks' : kind === 'note' ? 'notes' : 'all') }
  function focusAi() { setAiOpen(true); setAiFocusRequest(value => value + 1) }
  function closePanel() {
    if (panel?.kind === 'create' && panel.ai) focusAi()
    setPanel(null)
  }
  function newContent(taskStatus: TaskStatus = 'todo') {
    ai.cancel()
    setPendingAiDraft(null)
    setAiOpen(false)
    const kind = contentType === 'note' ? 'note' : 'task'
    setPanel({ kind: 'create', initial: { title: '', content: '', tag: filterTag ?? '', kind, status: kind === 'task' ? taskStatus : null, startAt: null, dueAt: null } })
  }
  function openNote(note: Note) { if (note.id != null) setPanel({ kind: 'detail', id: note.id }) }
  async function saveNew(input: NoteInput) {
    await addNote(input)
    if (panel?.kind === 'create' && panel.ai) { setAiText(''); setAiOpen(false) }
    setPanel(null)
    selectSpace(input.kind)
    setToast(input.kind === 'task' ? 'Đã thêm công việc' : 'Đã lưu ghi chú')
  }
  function openKnowledgeSource(source: KnowledgeSource) {
    const note = allNotes.find(item => item.serverId === source.serverId)
    if (note) openNote(note)
    else { if (page !== 'all') pendingSearch.current = source.title; selectSpace('all'); setSearch(source.title); setPanel(null) }
  }
  function openPlannedTask(task: { serverId: string; title: string }) {
    const note = allNotes.find(item => item.serverId === task.serverId)
    if (note) openNote(note)
    else { if (page !== 'tasks') pendingSearch.current = task.title; selectSpace('task'); setSearch(task.title) }
  }
  function changeLayout(next: 'board' | 'list') { setLayout(next); try { localStorage.setItem('pwa-notes-task-layout', next) } catch { /* preference only */ } }

  if (resetToken) return <ResetPasswordForm token={resetToken} onDone={() => { window.history.replaceState(null, '', window.location.pathname + window.location.hash); setResetToken(null) }} />
  if (!isAuthenticated || !user) return <LoginForm />

  return <div className={`app workspace-app${mobileNavOpen ? ' mobile-nav-open' : ''}`} data-draft-active={aiText.trim() ? 'true' : undefined}>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus() }}>Chuyển đến nội dung</a>
    {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
    <aside ref={sidebar} className="sidebar" id="workspace-navigation" role={mobileNavOpen ? 'dialog' : undefined} aria-modal={mobileNavOpen || undefined} aria-label="Điều hướng Notes">
      <a className="brand" href="#/dashboard" onClick={event => { event.preventDefault(); selectPage('dashboard') }}><span className="brand-mark">n<span>✦</span></span><span>Notes<span className="brand-caption">KHÔNG GIAN CÁ NHÂN</span></span></a>
      <button className="mobile-nav-close quiet-icon" aria-label="Đóng điều hướng" onClick={() => setMobileNavOpen(false)}><X size={20} /></button>
      <div className="workspace-nav-group workspace-primary-nav"><p className="nav-caption">KHÔNG GIAN</p>
        <nav className="view-filter" aria-label="Không gian làm việc">
          <button className={page === 'dashboard' ? 'active' : ''} aria-current={page === 'dashboard' ? 'page' : undefined} onClick={() => selectPage('dashboard')}><House size={18} /><span>Tổng quan</span></button>
          <button className={page === 'tasks' ? 'active' : ''} aria-current={page === 'tasks' ? 'page' : undefined} onClick={() => selectSpace('task')}><LayoutGrid size={18} /><span>Công việc</span><span className="nav-count">{summary.taskCount}</span></button>
          <button className={page === 'notes' ? 'active' : ''} aria-current={page === 'notes' ? 'page' : undefined} onClick={() => selectSpace('note')}><FileText size={18} /><span>Ghi chú</span><span className="nav-count">{summary.noteCount}</span></button>
          <button className={page === 'stats' ? 'active' : ''} aria-current={page === 'stats' ? 'page' : undefined} onClick={() => selectPage('stats')}><ChartNoAxesCombined size={18} /><span>Thống kê</span></button>
        </nav>
      </div>
      <div className="workspace-nav-group workspace-tools"><p className="nav-caption">TRỢ LÝ</p>
        <button className={`sidebar-tool${page === 'plan' ? ' active' : ''}`} aria-current={page === 'plan' ? 'page' : undefined} onClick={() => selectPage('plan')}><CalendarRange size={18} /> Gợi ý kế hoạch</button>
        <button className="sidebar-tool" onClick={() => setPanel({ kind: 'knowledge' })}><Search size={18} /> Hỏi đáp ghi chú</button>
      </div>
      <details className="workspace-nav-group data-navigation" open={['all', 'pending', 'conflicts', 'trash'].includes(page)}>
        <summary>DỮ LIỆU{counts.conflict > 0 && <span className="nav-count count-warning">{counts.conflict}</span>}<ChevronDown size={14} /></summary>
        <nav className="view-filter" aria-label="Dữ liệu">
          <button className={page === 'all' ? 'active' : ''} aria-current={page === 'all' ? 'page' : undefined} onClick={() => selectPage('all')}><FolderOpen size={18} /><span>Tất cả nội dung</span><span className="nav-count">{counts.active}</span></button>
          <button className={page === 'pending' ? 'active' : ''} aria-current={page === 'pending' ? 'page' : undefined} onClick={() => selectPage('pending')}><Cloud size={18} /><span>Chờ đồng bộ</span><span className="nav-count">{counts.pending}</span></button>
          <button className={page === 'conflicts' ? 'active' : ''} aria-current={page === 'conflicts' ? 'page' : undefined} onClick={() => selectPage('conflicts')}><AlertCircle size={18} /><span>Xung đột</span><span className={`nav-count${counts.conflict ? ' count-warning' : ''}`}>{counts.conflict}</span></button>
          <button className={page === 'trash' ? 'active' : ''} aria-current={page === 'trash' ? 'page' : undefined} onClick={() => selectPage('trash')}><Trash2 size={18} /><span>Thùng rác</span><span className="nav-count">{counts.trash}</span></button>
        </nav>
      </details>
      <div className="sidebar-footer">
        <details className="workspace-account"><summary><span className="account-avatar">{(user?.displayName || user?.username || 'N').slice(0, 1).toUpperCase()}</span><span><strong>{user?.displayName || user?.username}</strong><small>{isOnline ? 'Không gian cá nhân' : 'Đang offline'}</small></span><ChevronDown size={15} /></summary>
          <div className="workspace-account-options"><p>{user?.email || 'Chưa có email khôi phục'}</p><ChangePasswordDialog /><EmailDialog currentEmail={user?.email} /><ReminderDialog />
            {(user?.role === 'admin' || user?.role === 'root') && <Suspense fallback={<span>Đang tải...</span>}><AdminPanel isRoot={user.role === 'root'} /></Suspense>}
            <button className="logout-button" onClick={logout}>Đăng xuất</button>
          </div>
        </details>
      </div>
    </aside>
    <main ref={main} id="main" className="workspace" tabIndex={-1}>
      <div className="topbar"><button className="mobile-open-nav quiet-icon" aria-label="Mở điều hướng" aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button><span className="workspace-breadcrumb">Không gian cá nhân <span>/</span> <strong>{pageTitle}</strong></span><div className="topbar-actions"><ThemeControl /><button className="topbar-ai" onClick={focusAi}><Sparkles size={16} /><span>Tạo bằng AI</span></button><SyncBar compact isOnline={isOnline} status={status} errorMessage={errorMessage} onSyncNow={syncNow} /></div></div>
      <div className="workspace-content">
        <header className="work-heading"><div><div className="work-section-label"><span /> KHÔNG GIAN LÀM VIỆC</div><h1>{pageTitle}{page !== 'dashboard' && page !== 'stats' && page !== 'plan' && <span className="work-total">{notes.length}</span>}</h1><p>{page === 'dashboard' ? 'Công việc, ghi chú và những việc cần chú ý.' : page === 'stats' ? 'Theo dõi tiến độ và hoạt động của bạn.' : page === 'plan' ? 'Sắp xếp công việc theo thời gian bạn có mỗi ngày.' : taskSpace ? 'Theo dõi công việc qua từng bước xử lý.' : view === 'trash' ? 'Xem và khôi phục nội dung đã xóa.' : view === 'conflict' ? 'So sánh thay đổi và chọn bản muốn giữ.' : view === 'pending' ? 'Các thay đổi đã lưu trên thiết bị, đang chờ gửi lên máy chủ.' : 'Lưu và tìm lại những nội dung bạn cần.'}</p></div>
          {view !== 'trash' && view !== 'conflict' && page !== 'stats' && page !== 'plan' && <button className="work-create" onClick={() => newContent()}><Plus size={18} />{contentType === 'note' ? 'Thêm ghi chú' : 'Thêm công việc'}</button>}
        </header>
        {(status === 'error' || !isOnline) && <div className="connection-notice" role="status">{isOnline ? <Cloud size={16} /> : <WifiOff size={16} />}<span>{isOnline ? 'Chưa kết nối được máy chủ. Thay đổi vẫn được lưu trên thiết bị.' : 'Bạn đang offline. Có thể tiếp tục tạo và chuyển trạng thái công việc.'}</span>{errorMessage && <details><summary>Chi tiết</summary><p>{errorMessage}</p></details>}</div>}
        <PlanningAssistant accountKey={JSON.stringify([user.id, user.username])} active={page === 'plan'} isOnline={isOnline} onOpenTask={openPlannedTask} onShowTasks={() => selectSpace('task')} />
        {page === 'plan' ? null : page === 'dashboard' ? <Dashboard notes={allNotes} summary={summary} now={now} isLoading={isLoading} onOpen={openNote} onNavigate={navigate} /> : page === 'stats' ? isLoading ? <p className="work-loading" role="status">Đang tải dữ liệu trên thiết bị...</p> : <StatsView notes={allNotes} now={now} /> : <>
        {taskSpace && <div className="work-overview"><div className="work-metrics"><span><i className="metric-dot todo" />Cần làm <strong>{counts.todo}</strong></span><span><i className="metric-dot doing" />Đang làm <strong>{counts.doing}</strong></span><span><i className="metric-dot done" />Hoàn thành <strong>{counts.done}</strong></span></div><div className="work-progress"><span>Tiến độ <strong>{completed}/{summary.taskCount}</strong></span><div role="progressbar" aria-label="Tỷ lệ công việc hoàn thành" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${completion}%` }} /></div><strong>{completion}%</strong></div></div>}
        <section className="work-surface" aria-label={taskSpace ? 'Quản lý công việc' : 'Danh sách nội dung'}>
          <div className="work-toolbar"><div className="work-view-switch" role="group" aria-label="Cách hiển thị">{taskSpace ? <>
            <button className={layout === 'board' ? 'active' : ''} aria-pressed={layout === 'board'} onClick={() => changeLayout('board')}><LayoutGrid size={16} /> Bảng</button><button className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => changeLayout('list')}><LayoutList size={17} /> Danh sách</button>
          </> : <span><FileText size={17} /> {visibleNotes.length} nội dung</span>}</div>
            <label className="work-search"><Search size={17} /><input type="search" aria-label={taskSpace ? 'Tìm công việc' : 'Tìm nội dung'} placeholder={taskSpace ? 'Tìm công việc...' : 'Tìm nội dung...'} value={search} onChange={event => setSearch(event.target.value)} /></label>
            <label className="work-filter"><span className="sr-only">Lọc theo tag</span><select aria-label="Lọc theo tag" value={filterTag ?? ''} onChange={event => setFilterTag(event.target.value || null)}><option value="">Tất cả tag</option>{allTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}</select></label>
            {taskSpace && <label className="work-filter"><span className="sr-only">Lọc theo thời hạn</span><select aria-label="Lọc theo thời hạn" value={deadline} onChange={event => navigate('tasks', event.target.value as DeadlineFilter)}><option value="all">Mọi thời hạn</option><option value="overdue">Đã quá hạn</option><option value="week">Trong 7 ngày tới</option><option value="unscheduled">Chưa đặt hạn</option></select></label>}
          </div>
          {isFiltered && <div className="work-filter-summary"><span>Đang hiển thị <strong>{visibleNotes.length}</strong> {taskSpace ? 'công việc' : 'nội dung'} phù hợp</span><button onClick={clearFilters}>Xóa bộ lọc <X size={13} /></button></div>}
          {isLoading ? <div className="work-loading" role="status"><span className="ai-spinner" /> Đang tải dữ liệu trên thiết bị...</div> : taskSpace ? <TaskBoard notes={visibleNotes} now={now} layout={layout} onMove={moveTask} onOpen={openNote} onAdd={newContent} isFiltered={isFiltered} onClearFilters={clearFilters} />
            : <ContentList notes={visibleNotes} onOpen={openNote} isFiltered={isFiltered} onClear={clearFilters} onAdd={() => newContent()} trash={view === 'trash'} />}
        </section>
        {taskSpace && <footer className="work-footnote"><span><ListTodo size={14} />{layout === 'board' ? 'Kéo thẻ giữa các cột hoặc dùng menu chuyển trạng thái.' : 'Bấm vào công việc để xem chi tiết và cập nhật trạng thái.'}</span><span><Check size={13} /> Lưu trên thiết bị trước</span></footer>}
        </>}
      </div>
    </main>
    <AIChatBox open={aiOpen} blocked={!!panel || mobileNavOpen} text={aiText} onTextChange={setAiText} isOnline={isOnline} controller={ai} focusRequest={aiFocusRequest} onOpen={focusAi} onCollapse={() => setAiOpen(false)} onManual={() => newContent()} />
    {panel && <WorkspacePanel key={panel.kind === 'create' ? panel.ai ? 'ai-create' : 'manual-create' : panel.kind === 'knowledge' ? 'knowledge' : `${panel.kind}-${panel.id}`} title={panel.kind === 'create' ? panel.ai ? panel.ai.warning ? 'Kiểm tra bản nháp cơ bản' : 'Kiểm tra bản nháp AI' : panel.initial.kind === 'task' ? 'Thêm công việc' : 'Thêm ghi chú' : panel.kind === 'edit' ? 'Chỉnh sửa nội dung' : panel.kind === 'knowledge' ? 'Hỏi đáp ghi chú' : 'Chi tiết nội dung'} caption="NOTES · KHÔNG GIAN CÁ NHÂN" onClose={closePanel} focusInput={panel.kind === 'create' || panel.kind === 'edit'}>
      {panel.kind === 'create' && <>
        {panel.ai && (panel.ai.warning ? <p className="ai-draft-warning" role="status">AI chưa dùng được lúc này ({panel.ai.warning}). Đây là bản nháp cơ bản tạo bằng quy tắc; hãy kiểm tra lại nội dung và thời gian trước khi lưu.</p> : <p className="ai-draft-hint" role="status">Bản nháp chưa được lưu. Bạn có thể chỉnh sửa mọi trường bên dưới.</p>)}
        <NoteForm initial={panel.initial} existingTags={existingAiTags} heading={{ title: 'Thông tin cơ bản', description: 'Có thể bổ sung mô tả và thời gian sau.' }} submitLabel="Xác nhận lưu" onAdd={saveNew} onCancel={closePanel} />
      </>}
      {panel.kind === 'edit' && selectedNote && <NoteForm initial={selectedNote} existingTags={existingAiTags} heading={{ title: 'Thông tin nội dung', description: 'Thay đổi được lưu trên thiết bị trước.' }} submitLabel="Lưu thay đổi" onAdd={async input => { await updateNote(selectedNote.id!, input); setPanel({ kind: 'detail', id: selectedNote.id! }); setToast('Đã lưu thay đổi') }} onCancel={() => setPanel({ kind: 'detail', id: selectedNote.id! })} />}
      {panel.kind === 'detail' && selectedNote && <TaskDetails note={selectedNote} now={now} onMove={moveTask} onEdit={() => setPanel({ kind: 'edit', id: selectedNote.id! })} onDelete={async id => { await deleteNote(id); setPanel(null); setToast('Đã chuyển nội dung vào thùng rác') }} onRestore={async id => { await restoreNote(id); setPanel(null); setToast('Đã khôi phục nội dung') }} onResolve={resolveConflict} />}
      {(panel.kind === 'detail' || panel.kind === 'edit') && !selectedNote && <p>Nội dung này không còn trên thiết bị.</p>}
      {panel.kind === 'knowledge' && <KnowledgeAssistant isOnline={isOnline} onOpenSource={openKnowledgeSource} />}
    </WorkspacePanel>}
    {toast && <div className="workspace-toast" role="status"><Check size={17} /><span>{toast}</span><button aria-label="Đóng thông báo" onClick={() => setToast('')}><ArrowRight size={16} /></button></div>}
  </div>
}
