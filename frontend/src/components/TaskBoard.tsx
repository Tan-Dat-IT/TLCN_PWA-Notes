import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { Note, TaskStatus } from '../db/database'
import { formatTime, getTaskStatus, isOverdue, isCompletedLate, TASK_WORKFLOW_LABELS } from '../db/noteFields'
import './TaskBoard.css'

interface Props {
  notes: Note[]
  now: number
  layout: 'board' | 'list'
  onMove: (id: number, status: TaskStatus) => Promise<void>
  onOpen: (note: Note) => void
  onAdd: (status: TaskStatus) => void
  isFiltered?: boolean
  onClearFilters?: () => void
}

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done']
const DRAG_TYPE = 'application/x-notes-task'

function shortDate(value: number) {
  return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

function SyncNotice({ note }: { note: Note }) {
  if (note.conflict) return <span className="task-sync task-sync-conflict" title="Có thay đổi đồng thời. Mở công việc để giải quyết.">Xung đột</span>
  if (note.synced === 0) return <span className="task-sync" title="Đã lưu trên thiết bị, đang chờ đồng bộ."><span aria-hidden="true">↻</span> Chờ đồng bộ</span>
  return null
}

function TaskDeadline({ note, now }: { note: Note; now: number }) {
  if (note.dueAt === null) return null
  const overdue = isOverdue(note, now)
  const late = isCompletedLate(note)
  return <span className={`task-deadline${overdue ? ' is-overdue' : ''}${late ? ' is-late' : ''}`} title={`Hạn hoàn thành: ${formatTime(note.dueAt)}`}>
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="12" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M5 2v3M11 2v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
    {overdue ? 'Quá hạn · ' : late ? 'Hoàn thành trễ · ' : ''}{shortDate(note.dueAt)}
  </span>
}

export default function TaskBoard({ notes, now, layout, onMove, onOpen, onAdd, isFiltered = false, onClearFilters }: Props) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState('')
  const dragged = useRef<number | null>(null)
  const dragBlocked = useRef(false)
  const moving = useRef(false)
  const restoreFocus = useRef<{ id: number; status: TaskStatus } | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const tasks = notes.filter(note => note.kind === 'task' && !note.deleted)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (b.id ?? 0) - (a.id ?? 0) || (a.serverId ?? '').localeCompare(b.serverId ?? ''))

  function endDrag() {
    dragged.current = null
    dragBlocked.current = false
    setDragId(null)
    setOverColumn(null)
  }

  useEffect(() => {
    if (dragId === null) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dragged.current = null
        setDragId(null)
        setOverColumn(null)
        setAnnouncement('Đã hủy di chuyển công việc.')
      }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [dragId])

  // Đổi cột có thể làm React tạo lại thẻ ở cột mới. Giữ focus trên thao tác
  // chuyển trạng thái sau khi dữ liệu local cập nhật để tiếp tục bằng bàn phím.
  useEffect(() => {
    const target = restoreFocus.current
    if (target === null || pendingId !== null || !notes.some(note => note.id === target.id && getTaskStatus(note) === target.status)) return
    const { id } = target
    const element = board.current?.querySelector<HTMLSelectElement>(`[data-move-task="${id}"]`)
    if (element) {
      element.focus({ preventScroll: true })
      restoreFocus.current = null
    }
  }, [notes, pendingId])

  async function move(note: Note, status: TaskStatus) {
    if (note.id == null || moving.current || getTaskStatus(note) === status) return
    moving.current = true
    setPendingId(note.id)
    setError('')
    setAnnouncement(`Đang chuyển ${note.title}…`)
    const active = document.activeElement
    const hadFocus = active instanceof HTMLElement && active.dataset.moveTask === String(note.id)
    try {
      await onMove(note.id, status)
      if (hadFocus) restoreFocus.current = { id: note.id, status }
      setAnnouncement(`Đã chuyển “${note.title}” sang ${TASK_WORKFLOW_LABELS[status]}.`)
    } catch {
      setAnnouncement('')
      setError(`Không lưu được trạng thái của “${note.title}”. Công việc vẫn ở cột cũ. Vui lòng thử lại.`)
    } finally {
      moving.current = false
      setPendingId(null)
    }
  }

  function startDrag(event: DragEvent<HTMLElement>, note: Note) {
    const target = event.target as HTMLElement
    if (note.id == null || moving.current || dragBlocked.current || target.closest('button, select, input, a')) {
      event.preventDefault()
      return
    }
    dragged.current = note.id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DRAG_TYPE, String(note.id))
    event.dataTransfer.setData('text/plain', note.title)
    setDragId(note.id)
    setAnnouncement(`Đang di chuyển “${note.title}”. Thả vào cột mới hoặc nhấn Escape để hủy.`)
  }

  function allowDrop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    if (dragged.current === null || moving.current) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setOverColumn(status)
  }

  function drop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault()
    const note = tasks.find(task => task.id === dragged.current)
    endDrag()
    if (note && getTaskStatus(note) !== status) void move(note, status)
    else setAnnouncement('Công việc vẫn ở cột hiện tại.')
  }

  function statusControl(note: Note) {
    return <label className="task-status-control">
      <span className="task-sr-only">Chuyển trạng thái {note.title}</span>
      <select data-move-task={note.id} aria-label={`Chuyển trạng thái ${note.title}`} value={getTaskStatus(note) ?? 'todo'}
        disabled={pendingId !== null || note.id == null} onChange={event => void move(note, event.target.value as TaskStatus)}>
        {STATUSES.map(status => <option key={status} value={status}>{TASK_WORKFLOW_LABELS[status]}</option>)}
      </select>
    </label>
  }

  return <div className={`task-board-shell${dragId !== null ? ' is-dragging' : ''}`} ref={board}>
    <p className="task-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    {error && <p className="task-board-error" role="alert">{error}</p>}
    {isFiltered && tasks.length === 0 && <div className="task-filter-empty">
      <strong>Không có công việc phù hợp</strong><p>Thử từ khóa khác hoặc bỏ bớt bộ lọc.</p>
      {onClearFilters && <button type="button" onClick={onClearFilters}>Xóa bộ lọc</button>}
    </div>}
    {!isFiltered && tasks.length === 0 && <div className="task-first-empty">
      <div><strong>Bắt đầu với công việc đầu tiên</strong><p>Thêm một việc cần làm, rồi chuyển qua các cột để theo dõi tiến độ.</p></div>
      <button type="button" onClick={() => onAdd('todo')}>＋ Thêm công việc</button>
    </div>}
    {layout === 'board' ? <div className="task-board" aria-label="Bảng Kanban công việc">
      {STATUSES.map(status => {
        const columnTasks = tasks.filter(note => getTaskStatus(note) === status)
        return <section key={status} className={`task-column task-column-${status}${overColumn === status ? ' is-drop-target' : ''}`}
          aria-label={TASK_WORKFLOW_LABELS[status]} data-task-status={status}
          onDragOver={event => allowDrop(event, status)} onDrop={event => drop(event, status)}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverColumn(current => current === status ? null : current)
          }}>
          <div className="task-column-heading">
            <h2><span className={`task-stage-dot task-stage-${status}`} aria-hidden="true" />{TASK_WORKFLOW_LABELS[status]}<span className="task-column-count">{columnTasks.length}</span></h2>
            <button type="button" className="task-column-add" aria-label={`Thêm công việc vào ${TASK_WORKFLOW_LABELS[status]}`} onClick={() => onAdd(status)}>＋</button>
          </div>
          <ul className="task-column-cards">
            {columnTasks.map(note => <li key={note.id ?? note.serverId} className={`task-card${dragId === note.id ? ' is-drag-source' : ''}${pendingId === note.id ? ' is-saving' : ''}`}
              onPointerDown={event => { dragBlocked.current = !!(event.target as Element).closest('button, select, input, a') }} onPointerUp={() => { dragBlocked.current = false }}
              draggable={pendingId === null && note.id != null} onDragStart={event => startDrag(event, note)} onDragEnd={() => {
                if (dragged.current !== null) setAnnouncement('Đã hủy di chuyển công việc.')
                endDrag()
              }} aria-busy={pendingId === note.id}>
              <div className="task-card-topline"><span className="task-card-tag">{note.tag ? `#${note.tag}` : 'Công việc'}</span><SyncNotice note={note} /><span className="task-card-grip" title="Kéo thẻ sang cột khác" aria-hidden="true">⠿</span></div>
              <button type="button" className="task-card-title" onClick={() => onOpen(note)}>{note.title}</button>
              <div className="task-card-bottom">{statusControl(note)}{pendingId === note.id ? <span className="task-saving-label" role="status">Đang lưu…</span> : note.dueAt !== null ? <TaskDeadline note={note} now={now} /> : <span className="task-no-date">Chưa đặt hạn</span>}</div>
            </li>)}
          </ul>
          {columnTasks.length === 0 && <div className="task-column-empty"><span aria-hidden="true">{status === 'done' ? '✓' : '＋'}</span><p>{overColumn === status ? 'Thả công việc vào đây' : status === 'done' ? 'Công việc hoàn thành sẽ ở đây' : 'Chưa có công việc'}</p></div>}
          <button type="button" className="task-add-inline" onClick={() => onAdd(status)}><span aria-hidden="true">＋</span> Thêm công việc</button>
        </section>
      })}
    </div> : tasks.length > 0 && <div className="task-table-wrap"><table className="task-table">
      <thead><tr><th scope="col">Công việc</th><th scope="col">Trạng thái</th><th scope="col">Thời hạn</th><th scope="col">Đồng bộ</th></tr></thead>
      <tbody>{tasks.map(note => <tr key={note.id ?? note.serverId} aria-busy={pendingId === note.id}>
        <td><button type="button" className="task-list-title" onClick={() => onOpen(note)}>{note.title}</button>{note.tag && <span className="task-list-tag">#{note.tag}</span>}<span className="task-mobile-sync"><SyncNotice note={note} /></span></td>
        <td>{statusControl(note)}</td><td>{note.dueAt === null ? <span className="task-no-date">Chưa đặt hạn</span> : <TaskDeadline note={note} now={now} />}</td>
        <td><SyncNotice note={note} />{note.synced === 1 && !note.conflict && <span className="task-synced-label">Đã đồng bộ</span>}</td>
      </tr>)}</tbody>
    </table></div>}
    {layout === 'board' && tasks.length > 0 && <p className="task-board-help"><span aria-hidden="true">⠿</span> Kéo thẻ để đổi cột hoặc chọn trạng thái trên thẻ.</p>}
  </div>
}
