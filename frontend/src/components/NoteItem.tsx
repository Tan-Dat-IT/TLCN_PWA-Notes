import { useState } from 'react'
import type { Note, NoteInput } from '../db/database'
import NoteForm from './NoteForm'
import { formatTime, taskDisplayStatus, TASK_STATUS_LABELS } from '../db/noteFields'

interface Props {
  note: Note
  now: number
  onEdit: (id: number, input: NoteInput) => Promise<void>
  onToggle: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onRestore: (id: number) => Promise<void>
}

export default function NoteItem({ note, now, onEdit, onToggle, onDelete, onRestore }: Props) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function perform(action: (id: number) => Promise<void>) {
    if (note.id == null || busy) return
    setBusy(true)
    setError('')
    try {
      await action(note.id)
    } catch {
      setError('Không cập nhật được ghi chú. Hãy thử lại.')
    } finally {
      setBusy(false)
    }
  }

  if (editing && note.deleted === 0) {
    return (
      <li className="note-item">
        <NoteForm initial={note} onCancel={() => setEditing(false)} onAdd={async input => {
          if (note.id == null) throw new Error('Không tìm thấy ghi chú.')
          await onEdit(note.id, input)
          setEditing(false)
        }} />
      </li>
    )
  }

  const taskStatus = note.kind === 'task' && !note.deleted ? taskDisplayStatus(note, now) : null
  return (
    <li className={`note-item${note.done ? ' done' : ''}${note.deleted ? ' deleted' : ''}`}>
      <article>
        <h3>{note.title}</h3>
        {note.content && <p className="note-content">{note.content}</p>}
        <p className="note-meta">#{note.tag} · Cập nhật: {new Date(note.updatedAt).toLocaleString('vi-VN')}</p>
        {taskStatus && <p className={taskStatus === 'overdue' ? 'overdue-status' : 'task-status'}>{TASK_STATUS_LABELS[taskStatus]}</p>}
        <dl className="note-dates">
          {note.startAt !== null && <div><dt>Bắt đầu</dt><dd>{formatTime(note.startAt)}</dd></div>}
          {note.dueAt !== null && <div><dt>Hạn hoàn thành</dt><dd>{formatTime(note.dueAt)}</dd></div>}
        </dl>
        <div className="note-actions">
          {note.deleted === 1 ? (
            <button type="button" disabled={busy} onClick={() => void perform(onRestore)}>Khôi phục</button>
          ) : (
            <>
              {note.kind === 'task' && <label className="completion-control">
                <input type="checkbox" checked={note.done} disabled={busy}
                  onChange={() => void perform(onToggle)} aria-label={`Hoàn thành ${note.title}`} />
                Hoàn thành
              </label>}
              <button className="secondary" type="button" disabled={busy} onClick={() => setEditing(true)}>Sửa</button>
              <button className="delete-button" type="button" disabled={busy}
                onClick={() => void perform(onDelete)}>Xóa</button>
            </>
          )}
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
      </article>
    </li>
  )
}
