import type { Note } from '../db/database'
import { useState } from 'react'
import NoteForm from './NoteForm'
import MarkdownLite from './MarkdownLite'
import ConflictPanel from './ConflictPanel'
import { formatTime, taskDisplayStatus, TASK_STATUS_LABELS, type NoteInput } from '../db/noteFields'
import type { ConflictChoice } from '../hooks/useNotes'

interface Props {
  note: Note
  now: number
  onToggle: (note: Note) => void
  onDelete: (id: number) => void
  onRestore: (id: number) => void
  onEdit: (id: number, changes: NoteInput) => Promise<void>
  onResolveConflict: (id: number, choice: ConflictChoice) => Promise<void>
}

export default function NoteItem({ note, now, onToggle, onDelete, onEdit, onRestore, onResolveConflict }: Props) {
  const [editing, setEditing] = useState(false)
  if (editing && !note.deleted) return <li><NoteForm initial={note} onCancel={() => setEditing(false)}
    onAdd={async input => {
      await onEdit(note.id!, input)
      setEditing(false)
    }} /></li>
  const taskStatus = note.kind === 'task' && !note.deleted ? taskDisplayStatus(note, now) : null
  const completedLate = taskStatus === 'completed_late'
  return (
    <li className={`note-item ${note.done ? 'done' : ''} ${completedLate ? 'late' : ''} ${note.deleted ? 'deleted' : ''}`}>
      <div className="note-item-main">
        <strong>{note.title}</strong>
        {note.content && <MarkdownLite text={note.content} />}
        <div className="note-meta">
          <span className="note-kind">{note.kind === 'task' ? 'Công việc' : 'Ghi chú'}</span>
          {taskStatus === 'in_progress' && <span className="task-status">{TASK_STATUS_LABELS.in_progress}</span>}
          {taskStatus === 'overdue' && <span className="overdue-status">{TASK_STATUS_LABELS.overdue}</span>}
          {taskStatus === 'completed' && <span className="task-status complete">{TASK_STATUS_LABELS.completed}</span>}
          {taskStatus === 'completed_late' && <span className="late-status">{TASK_STATUS_LABELS.completed_late}</span>}
          {note.deleted === 1 && <span className="deleted-status">Đã xóa</span>}
          <span className="tag">#{note.tag}</span>
          <span className={`sync-dot ${note.synced === 1 ? 'ok' : note.conflict ? 'conflict' : 'pending'}`}>
            {note.synced === 1 ? 'Đã đồng bộ' : note.conflict ? 'Xung đột' : 'Chờ đồng bộ'}
          </span>
        </div>
        <dl className="note-dates">
          {note.startAt !== null && <div><dt>Bắt đầu</dt><dd>{formatTime(note.startAt)}</dd></div>}
          {note.dueAt !== null && <div><dt>Hạn hoàn thành</dt><dd>{formatTime(note.dueAt)}</dd></div>}
          {note.done && <div><dt>Hoàn thành lúc</dt><dd>{formatTime(note.completedAt)}</dd></div>}
          {note.deleted === 1 && <div><dt>Đã xóa lúc</dt><dd>{formatTime(note.deletedAt)}</dd></div>}
        </dl>
        {note.conflict && <ConflictPanel note={note} server={note.conflict} onResolve={choice => onResolveConflict(note.id!, choice)} />}
        <details className="note-history"><summary>Thông tin thời gian</summary><p>Ngày tạo: {formatTime(note.createdAt)}</p><p>Cập nhật: {formatTime(note.updatedAt)}</p></details>
      </div>
      <div className="note-actions">
      {note.deleted === 1 ? <button onClick={() => note.id != null && onRestore(note.id)}>Khôi phục</button> : <>
      {note.kind === 'task' && <label className="completion-control"><input type="checkbox" checked={note.done}
        onChange={() => onToggle(note)} aria-label={`Hoàn thành ${note.title}`} /> Hoàn thành</label>}
      <button onClick={() => setEditing(true)} aria-label={`Sửa ${note.title}`}>Sửa</button>
      <button
        className="delete-btn"
        onClick={() => note.id != null && onDelete(note.id)}
        aria-label="Xóa"
      >
        Xóa
      </button>
      </>}
      </div>
    </li>
  )
}
