import { useState, type FormEvent } from 'react'
import { fromDateInput, toDateInput, validSchedule, type NoteInput } from '../db/noteFields'

interface Props {
  onAdd: (input: NoteInput) => Promise<void>
  initial?: NoteInput
  onCancel?: () => void
  heading?: { title: string; description: string }
  submitLabel?: string
}

export default function NoteForm({ onAdd, initial, onCancel, heading, submitLabel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [tag, setTag] = useState(initial?.tag ?? '')
  const [kind, setKind] = useState<NoteInput['kind']>(initial?.kind ?? 'note')
  const [startAt, setStartAt] = useState(toDateInput(initial?.startAt ?? null))
  const [dueAt, setDueAt] = useState(toDateInput(initial?.dueAt ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || saving) return
    const input = { title: title.trim(), content: content.trim(), tag: tag.trim(), kind,
      startAt: fromDateInput(startAt), dueAt: fromDateInput(dueAt) }
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
      <label className="kind-field">Loại nội dung
        <select value={kind} onChange={e => setKind(e.target.value as NoteInput['kind'])} disabled={saving}>
          <option value="note">Ghi chú</option><option value="task">Công việc</option>
        </select>
      </label>
      <input
        aria-label="Tiêu đề" maxLength={255} required disabled={saving}
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Ví dụ: Hoàn thiện báo cáo tiểu luận"
      />
      <textarea
        aria-label="Nội dung" maxLength={100000} disabled={saving}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={'Ví dụ: Viết **chữ in đậm**, *chữ in nghiêng*.\n- [ ] Việc chưa xong\n- [x] Việc đã xong'}
        rows={3}
      />
      <details className="schedule-fields" open={kind === 'task' || !!startAt || !!dueAt}>
        <summary>Thời gian (không bắt buộc)</summary>
        <div className="schedule-grid">
          <label>Bắt đầu<input type="datetime-local" aria-label="Thời gian bắt đầu" disabled={saving} value={startAt} onChange={e => setStartAt(e.target.value)} /></label>
          <label>Hạn hoàn thành<input type="datetime-local" aria-label="Hạn hoàn thành" disabled={saving} value={dueAt} min={startAt || undefined} onChange={e => setDueAt(e.target.value)} /></label>
        </div>
        <p>Giờ trên thiết bị của bạn. Để trống nếu không cần đặt lịch. Thời điểm hoàn thành được lưu khi tích checkbox công việc.</p>
      </details>
      <div className="note-form-row">
        <input
          aria-label="Tag" maxLength={100} disabled={saving}
          value={tag}
          onChange={e => setTag(e.target.value)}
          placeholder="# Tag, ví dụ: hoc-tap"
        />
        <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : submitLabel ?? (initial ? 'Lưu thay đổi' : kind === 'task' ? 'Thêm công việc' : 'Thêm ghi chú')}</button>
      </div>
      {onCancel && <button type="button" disabled={saving} onClick={onCancel}>Hủy</button>}
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
