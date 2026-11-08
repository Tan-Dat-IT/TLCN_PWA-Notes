import { useState, type FormEvent } from 'react'
import { fromDateInput, toDateInput, validSchedule, TASK_WORKFLOW_LABELS, type NoteInput } from '../db/noteFields'
import type { TaskStatus } from '../db/database'
import { matchingTags } from '../lib/tags'

interface Props {
  onAdd: (input: NoteInput) => Promise<void>
  initial?: NoteInput & { done?: boolean }
  onCancel?: () => void
  heading?: { title: string; description: string }
  submitLabel?: string
  existingTags?: string[]
}

export default function NoteForm({ onAdd, initial, onCancel, heading, submitLabel, existingTags = [] }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [tag, setTag] = useState(initial?.tag ?? '')
  const [kind, setKind] = useState<NoteInput['kind']>(initial?.kind ?? 'note')
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? (initial?.done ? 'done' : 'todo'))
  const [startAt, setStartAt] = useState(toDateInput(initial?.startAt ?? null))
  const [dueAt, setDueAt] = useState(toDateInput(initial?.dueAt ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(initial?.startAt != null || initial?.dueAt != null)
  const suggestions = matchingTags(existingTags, tag)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || saving) return
    const input = { title: title.trim(), content: content.trim(), tag: tag.trim(), kind,
      status: kind === 'task' ? status : null, startAt: fromDateInput(startAt), dueAt: fromDateInput(dueAt) }
    if (!validSchedule(input)) { setError('Hạn hoàn thành phải bằng hoặc sau thời gian bắt đầu.'); return }
    setSaving(true)
    setError('')
    try {
      await onAdd(input)
      setTitle('')
      setContent('')
      setTag('')
      setStartAt('')
      setDueAt('')
    } catch {
      setError('Không lưu được ghi chú. Nội dung vẫn được giữ lại, hãy thử lại.')
    } finally { setSaving(false) }
  }

  return (
    <form className="note-form" onSubmit={handleSubmit}>
      <div className="form-heading"><span className="form-icon" aria-hidden="true">✎</span><div><h2>{heading?.title ?? (initial ? 'Chỉnh sửa ghi chú' : 'Ghi lại điều bạn đang nghĩ')}</h2><p>{heading?.description ?? (initial ? 'Cập nhật ý tưởng và công việc của bạn.' : 'Một ý tưởng mới, một việc cần làm. Bắt đầu từ đây.')}</p></div></div>
      <label className="editor-field">Tiêu đề <input
        aria-label="Tiêu đề" maxLength={255} required disabled={saving}
        value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Ví dụ: Hoàn thiện báo cáo tiểu luận"
      /></label>
      <div className="form-short-fields"><label className="kind-field">Loại nội dung
        <select value={kind} onChange={e => setKind(e.target.value as NoteInput['kind'])} disabled={saving}>
          <option value="note">Ghi chú</option><option value="task">Công việc</option>
        </select>
      </label>
      {kind === 'task' && <label className="kind-field">Bước xử lý
        <select aria-label="Trạng thái công việc" value={status} onChange={event => setStatus(event.target.value as TaskStatus)} disabled={saving}>
          {(['todo', 'doing', 'done'] as const).map(value => <option key={value} value={value}>{TASK_WORKFLOW_LABELS[value]}</option>)}
        </select>
      </label>}</div>
      <label className="editor-field">Mô tả<textarea
        aria-label="Nội dung" maxLength={100000} disabled={saving}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={'Ví dụ: Viết **chữ in đậm**, *chữ in nghiêng*.\n- [ ] Việc chưa xong\n- [x] Việc đã xong'}
        rows={3}
      /></label>
      <div className="editor-tag-field"><label className="editor-field">Tag<input aria-label="Tag" maxLength={100} disabled={saving} value={tag} onChange={e => setTag(e.target.value)} placeholder="Nhập hoặc chọn tag đã dùng" /></label>
        {tag === 'chung' && <p className="editor-tag-hint">Chưa có nhóm cụ thể. Bạn có thể đổi Tag phù hợp hơn.</p>}
        {suggestions.length > 0 && <div className="editor-tag-suggestions" role="group" aria-label="Tag đã dùng"><span>Tag đã dùng</span>{suggestions.map(value => <button key={value} type="button" disabled={saving} aria-pressed={tag === value} onClick={() => setTag(value)}>{value}</button>)}</div>}
      </div>
      <details className="schedule-fields" open={scheduleOpen} onToggle={event => setScheduleOpen(event.currentTarget.open)}>
        <summary>Thời gian (không bắt buộc)</summary>
        <div className="schedule-grid">
          <label>Bắt đầu<input type="datetime-local" aria-label="Thời gian bắt đầu" disabled={saving} value={startAt} onChange={e => setStartAt(e.target.value)} /></label>
          <label>Hạn hoàn thành<input type="datetime-local" aria-label="Hạn hoàn thành" disabled={saving} value={dueAt} min={startAt || undefined} onChange={e => setDueAt(e.target.value)} /></label>
        </div>
        <p>Giờ địa phương trên thiết bị. Có thể để trống.</p>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        {onCancel && <button type="button" className="secondary-action" disabled={saving} onClick={onCancel}>Hủy</button>}
        <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : submitLabel ?? (initial ? 'Lưu thay đổi' : kind === 'task' ? 'Thêm công việc' : 'Thêm ghi chú')}</button>
      </div>
    </form>
  )
}
