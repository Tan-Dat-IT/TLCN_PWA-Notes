import type { Note } from '../db/database'
import NoteItem from './NoteItem'
import type { NoteInput } from '../db/noteFields'
import type { ConflictChoice } from '../hooks/useNotes'

interface Props {
  notes: Note[]
  now: number
  onToggle: (note: Note) => void
  onDelete: (id: number) => void
  onRestore: (id: number) => void
  onEdit: (id: number, changes: NoteInput) => Promise<void>
  onResolveConflict: (id: number, choice: ConflictChoice) => Promise<void>
}

export default function NoteList({ notes, now, onToggle, onDelete, onEdit, onRestore, onResolveConflict }: Props) {
  if (notes.length === 0) {
    return <p className="empty-state">Không có ghi chú trong mục hoặc tag đang chọn.</p>
  }
  return (
    <ul className="note-list">
      {notes.map(n => (
        <NoteItem key={n.id} note={n} now={now} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} onRestore={onRestore} onResolveConflict={onResolveConflict} />
      ))}
    </ul>
  )
}
