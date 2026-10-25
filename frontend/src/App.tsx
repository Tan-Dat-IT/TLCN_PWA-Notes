import NoteForm from './components/NoteForm'
import NoteList from './components/NoteList'
import { useNotes } from './hooks/useNotes'
import './styles.css'

export default function App() {
  const { notes, loading, error, addNote, updateNote, toggleDone, deleteNote, restoreNote } = useNotes()
  const actions = { onEdit: updateNote, onToggle: toggleDone, onDelete: deleteNote, onRestore: restoreNote }

  return (
    <main className="app">
      <header className="app-header">
        <h1>PWA Notes</h1>
        <p>Ghi chú và công việc</p>
      </header>
      <NoteForm onAdd={addNote} />
      {error && <p className="error-message" role="alert">{error}</p>}
      {loading ? <p role="status">Đang tải ghi chú...</p> : !error && (
        <>
          <section className="notes-section" aria-labelledby="notes-heading">
            <h2 id="notes-heading">Ghi chú của bạn</h2>
            <NoteList notes={notes.filter(note => note.deleted === 0)} emptyMessage="Chưa có ghi chú."
              {...actions} />
          </section>
          <section className="notes-section" aria-labelledby="trash-heading">
            <h2 id="trash-heading">Thùng rác</h2>
            <NoteList notes={notes.filter(note => note.deleted === 1)} emptyMessage="Thùng rác trống."
              {...actions} />
          </section>
        </>
      )}
    </main>
  )
}
