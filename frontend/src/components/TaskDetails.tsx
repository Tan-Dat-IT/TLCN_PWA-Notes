import { useState } from 'react'
import { CalendarDays, Pencil, Trash2, RotateCcw, FileText, CheckSquare } from 'lucide-react'
import type { Note, TaskStatus } from '../db/database'
import { formatTime, getTaskStatus, isCompletedLate, isOverdue, TASK_WORKFLOW_LABELS } from '../db/noteFields'
import type { ConflictChoice } from '../hooks/useNotes'
import MarkdownLite from './MarkdownLite'
import ConflictPanel from './ConflictPanel'

interface Props {
  note: Note
  now: number
  onMove: (id: number, status: TaskStatus) => Promise<void>
  onEdit: () => void
  onDelete: (id: number) => Promise<void>
  onRestore: (id: number) => Promise<void>
  onResolve: (id: number, choice: ConflictChoice) => Promise<void>
}

export default function TaskDetails({ note, now, onMove, onEdit, onDelete, onRestore, onResolve }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const workflow = getTaskStatus(note)
  const hasSchedule = note.kind === 'task' || note.startAt !== null || note.dueAt !== null || !!note.deleted

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() }
    catch { setError('Không lưu được thay đổi trên thiết bị. Vui lòng thử lại.') }
    finally { setBusy(false) }
  }

  return <div className="task-detail">
    <div className="detail-labels"><span className="detail-kind">{note.kind === 'task' ? <CheckSquare size={14} /> : <FileText size={14} />}{note.kind === 'task' ? 'Công việc' : 'Ghi chú'}</span>
      {note.tag && <span className="detail-tag">#{note.tag}</span>}
      {isOverdue(note, now) && <span className="detail-warning">Quá hạn</span>}
      {isCompletedLate(note) && <span className="detail-warning">Hoàn thành trễ</span>}
      {!!note.deleted && <span className="detail-warning">Đã xóa</span>}
    </div>
    <h3 className="detail-title">{note.title}</h3>
    {workflow && !note.deleted && <label className="detail-status">Bước xử lý
      <select aria-label="Bước xử lý công việc" value={workflow} disabled={busy} onChange={event => void perform(() => onMove(note.id!, event.target.value as TaskStatus))}>
        {(['todo', 'doing', 'done'] as const).map(status => <option key={status} value={status}>{TASK_WORKFLOW_LABELS[status]}</option>)}
      </select>
    </label>}
    {hasSchedule && <section className="detail-schedule" aria-label="Thời gian"><h4><CalendarDays size={16} /> Thời gian</h4><dl>
      <div><dt>Bắt đầu dự kiến</dt><dd>{note.startAt === null ? 'Chưa đặt' : formatTime(note.startAt)}</dd></div>
      <div><dt>Hạn hoàn thành</dt><dd>{note.dueAt === null ? 'Chưa đặt' : formatTime(note.dueAt)}</dd></div>
      {workflow === 'done' && <div><dt>Đã hoàn thành</dt><dd>{formatTime(note.completedAt)}</dd></div>}
      {!!note.deleted && <div><dt>Đã xóa</dt><dd>{formatTime(note.deletedAt)}</dd></div>}
    </dl></section>}
    <div className="detail-body"><h4>Nội dung</h4>{note.content ? <MarkdownLite text={note.content} /> : <p className="detail-muted">Chưa có mô tả.</p>}</div>
    {note.conflict && <ConflictPanel note={note} server={note.conflict} onResolve={choice => onResolve(note.id!, choice)} />}
    <p className={`detail-sync${note.conflict ? ' has-conflict' : ''}`} role="status">{note.conflict ? 'Có xung đột cần xử lý' : note.synced ? 'Đã đồng bộ' : 'Đã lưu trên thiết bị · Chờ đồng bộ'}</p>
    <details className="detail-metadata"><summary>Thông tin bổ sung</summary><dl className="detail-audit"><div><dt>Đã tạo</dt><dd>{formatTime(note.createdAt)}</dd></div><div><dt>Cập nhật</dt><dd>{formatTime(note.updatedAt)}</dd></div></dl></details>
    <div className="detail-actions">{error && <p role="alert" className="workspace-error">{error}</p>}{note.deleted ? <button disabled={busy} onClick={() => void perform(() => onRestore(note.id!))}><RotateCcw size={16} /> Khôi phục</button> : <>
      <button disabled={busy} onClick={onEdit}><Pencil size={16} /> Chỉnh sửa</button>
      <button disabled={busy} className="danger-action" onClick={() => void perform(() => onDelete(note.id!))}><Trash2 size={16} /> Xóa</button>
    </>}</div>
  </div>
}
