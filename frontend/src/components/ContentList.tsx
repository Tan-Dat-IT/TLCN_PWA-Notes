import { FileText, ArrowUpRight, ListTodo } from 'lucide-react'
import type { Note } from '../db/database'
import { formatTime, getTaskStatus, TASK_WORKFLOW_LABELS } from '../db/noteFields'

interface Props { notes: Note[]; onOpen: (note: Note) => void; isFiltered: boolean; onClear: () => void; onAdd: () => void; trash?: boolean }

export default function ContentList({ notes, onOpen, isFiltered, onClear, onAdd, trash }: Props) {
  if (!notes.length) return <div className="content-empty"><FileText size={30} strokeWidth={1.4} />
    <h3>{isFiltered ? 'Không tìm thấy nội dung phù hợp' : trash ? 'Thùng rác đang trống' : 'Bắt đầu với một ghi chú'}</h3>
    <p>{isFiltered ? 'Thử từ khóa khác hoặc bỏ bớt bộ lọc.' : trash ? 'Nội dung bạn xóa sẽ xuất hiện tại đây.' : 'Lưu ý tưởng, tài liệu và những điều cần nhớ.'}</p>
    {isFiltered ? <button className="secondary-action" onClick={onClear}>Xóa bộ lọc</button> : !trash && <button onClick={onAdd}>Thêm nội dung</button>}
  </div>
  return <ul className="content-list">{notes.map(note => {
    const workflow = getTaskStatus(note)
    const Icon = note.kind === 'task' ? ListTodo : FileText
    return <li key={note.id}><button className="content-row" onClick={() => onOpen(note)}>
      <span className="content-row-icon"><Icon size={19} strokeWidth={1.6} /></span>
      <span className="content-row-main"><strong>{note.title}</strong><span>{note.content.replace(/[#*`>\[\]]/g, '').slice(0, 140) || 'Chưa có mô tả'}</span>
        <small>{note.tag && <span>#{note.tag}</span>}{workflow && <span>{TASK_WORKFLOW_LABELS[workflow]}</span>}{note.conflict ? <span className="detail-warning">Xung đột đồng bộ</span> : !note.synced && <span>Chờ đồng bộ</span>}</small>
      </span><span className="content-row-date">{formatTime(note.updatedAt)}</span><ArrowUpRight size={16} />
    </button></li>
  })}</ul>
}
