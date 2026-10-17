import { useState } from 'react'
import type { Note, ServerNote } from '../db/database'
import { formatTime } from '../db/noteFields'
import type { ConflictChoice } from '../hooks/useNotes'

interface Props {
  note: Note
  server: ServerNote
  onResolve: (choice: ConflictChoice) => Promise<void>
}

type Field = { label: string; show: (n: Note | ServerNote) => string }
const FIELDS: Field[] = [
  { label: 'Tiêu đề', show: n => n.title },
  { label: 'Nội dung', show: n => n.content || '(trống)' },
  { label: 'Tag', show: n => `#${n.tag}` },
  { label: 'Loại', show: n => n.kind === 'task' ? 'Công việc' : 'Ghi chú' },
  { label: 'Hoàn thành', show: n => n.kind === 'task' ? (n.done ? 'Đã hoàn thành' : 'Chưa hoàn thành') : '-' },
  { label: 'Trạng thái', show: n => n.deleted ? 'Đã xóa' : 'Đang dùng' },
  { label: 'Bắt đầu', show: n => n.startAt === null ? 'Không đặt' : formatTime(n.startAt) },
  { label: 'Hạn hoàn thành', show: n => n.dueAt === null ? 'Không đặt' : formatTime(n.dueAt) }
]

// Hiện khi server báo ghi chú đã bị thiết bị khác sửa trước (xem db/sync.ts).
// Chỉ liệt kê các trường khác nhau để người dùng so sánh nhanh rồi chọn.
export default function ConflictPanel({ note, server, onResolve }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const diffs = FIELDS.filter(f => f.show(note) !== f.show(server))
  async function choose(choice: ConflictChoice) {
    setBusy(true)
    try { await onResolve(choice); setError('') }
    catch { setError('Không lưu được lựa chọn trên thiết bị. Vui lòng thử lại.') }
    finally { setBusy(false) }
  }
  return (
    <div className="conflict-panel" role="group" aria-label={`Xung đột đồng bộ: ${note.title}`}>
      <p className="conflict-title"><strong>Xung đột đồng bộ.</strong> Ghi chú này đã được sửa trên thiết bị khác
        (lúc {formatTime(server.updatedAt)}) trong khi bạn cũng sửa trên thiết bị này. Thay đổi của bạn chưa được gửi lên - hãy chọn bản muốn giữ.</p>
      {diffs.length > 0 ? (
        <table className="conflict-diff">
          <thead><tr><th scope="col">Trường</th><th scope="col">Trên thiết bị này</th><th scope="col">Trên server</th></tr></thead>
          <tbody>{diffs.map(f => <tr key={f.label}><th scope="row">{f.label}</th><td>{f.show(note)}</td><td>{f.show(server)}</td></tr>)}</tbody>
        </table>
      ) : <p className="conflict-same">Nội dung hai bản giống nhau, chỉ khác thời điểm sửa.</p>}
      <div className="conflict-actions">
        <button type="button" disabled={busy} onClick={() => void choose('mine')}>Giữ bản của tôi</button>
        <button type="button" disabled={busy} onClick={() => void choose('server')}>Dùng bản trên server</button>
        <button type="button" disabled={busy} onClick={() => void choose('both')}>Giữ cả hai</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
