import type { Note, NoteInput } from '../db/database'
import NoteItem from './NoteItem'

interface Props {
  notes: Note[]
  now: number
  emptyMessage: string
  onEdit: (id: number, input: NoteInput) => Promise<void>
  onToggle: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onRestore: (id: number) => Promise<void>
}

export default function NoteList({ notes, now, emptyMessage, ...actions }: Props) {
  if (notes.length === 0) return <p className="empty-state">{emptyMessage}</p>
  return (
    <ul className="note-list">
      {notes.map(note => <NoteItem key={note.id} note={note} now={now} {...actions} />)}
    </ul>
  )
}
