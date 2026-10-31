import { useId, useState, type FormEvent } from 'react'
import type { NoteInput } from '../db/database'
import { fromDateInput, toDateInput, validSchedule } from '../db/noteFields'

interface Props {
  onAdd: (input: NoteInput) => Promise<void>
  initial?: NoteInput
  onCancel?: () => void
}

export default function NoteForm({ onAdd, initial, onCancel }: Props) {
  const formId = useId()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [tag, setTag] = useState(initial?.tag ?? '')
  const [kind, setKind] = useState<NoteInput['kind']>(initial?.kind ?? 'note')
  const [startAt, setStartAt] = useState(toDateInput(initial?.startAt ?? null))
  const [dueAt, setDueAt] = useState(toDateInput(initial?.dueAt ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    const input = { title, content, tag, kind, startAt: fromDateInput(startAt), dueAt: fromDateInput(dueAt) }
    if (!validSchedule(input)) { setError('Hạn hoàn thành phải bằng hoặc sau thời gian bắt đầu.'); return }
    setSaving(true)
    setError('')
    try {
      await onAdd(input)
      if (!initial) {
        setTitle('')
        setContent('')
        setTag('')
        setStartAt('')
        setDueAt('')
      }
    } catch {
      setError('Không lưu được ghi chú. Nội dung vẫn được giữ lại, hãy thử lại.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="note-form" onSubmit={handleSubmit}>
      <h2>{initial ? 'Chỉnh sửa ghi chú' : 'Thêm ghi chú'}</h2>
      <fieldset disabled={saving}>
        <label htmlFor={`${formId}-kind`}>Loại nội dung</label>
        <select id={`${formId}-kind`} value={kind} onChange={event => setKind(event.target.value as NoteInput['kind'])}>
          <option value="note">Ghi chú</option><option value="task">Công việc</option>
        </select>
        <label htmlFor={`${formId}-title`}>Tiêu đề</label>
        <input id={`${formId}-title`} required maxLength={255} value={title}
          onChange={event => setTitle(event.target.value)} />
        <label htmlFor={`${formId}-content`}>Nội dung</label>
        <textarea id={`${formId}-content`} rows={4} maxLength={100000} value={content}
          onChange={event => setContent(event.target.value)} />
        <label htmlFor={`${formId}-tag`}>Tag</label>
        <input id={`${formId}-tag`} maxLength={100} value={tag} placeholder="Ví dụ: hoc-tap"
          onChange={event => setTag(event.target.value)} />
        <details className="schedule-fields" open={kind === 'task' || !!startAt || !!dueAt}>
          <summary>Thời gian (không bắt buộc)</summary>
          <div className="schedule-grid">
            <label htmlFor={`${formId}-start`}>Bắt đầu
              <input id={`${formId}-start`} type="datetime-local" value={startAt} onChange={event => setStartAt(event.target.value)} />
            </label>
            <label htmlFor={`${formId}-due`}>Hạn hoàn thành
              <input id={`${formId}-due`} type="datetime-local" value={dueAt} min={startAt || undefined} onChange={event => setDueAt(event.target.value)} />
            </label>
          </div>
        </details>
        <div className="form-actions">
          <button type="submit" disabled={!title.trim()}>
            {saving ? 'Đang lưu...' : initial ? 'Lưu thay đổi' : 'Thêm ghi chú'}
          </button>
          {onCancel && <button className="secondary" type="button" onClick={onCancel}>Hủy</button>}
        </div>
      </fieldset>
      {error && <p className="error-message" role="alert">{error}</p>}
    </form>
  )
}
