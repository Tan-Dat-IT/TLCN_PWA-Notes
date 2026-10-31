import { useState } from 'react'
import NoteForm from './components/NoteForm'
import NoteList from './components/NoteList'
import { useNotes, type NoteKindFilter, type NoteView } from './hooks/useNotes'
import './styles.css'

const contentTypeLabels: Record<NoteKindFilter, string> = { all: 'Tất cả', note: 'Ghi chú', task: 'Công việc' }
const views: { key: NoteView; label: string }[] = [
  { key: 'active', label: 'Tất cả' },
  { key: 'todo', label: 'Đang thực hiện' },
  { key: 'done', label: 'Đã hoàn thành' },
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'trash', label: 'Thùng rác' }
]

export default function App() {
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [view, setView] = useState<NoteView>('active')
  const [contentType, setContentType] = useState<NoteKindFilter>('all')
  const [search, setSearch] = useState('')
  const { notes, allTags, counts, now, loading, error, addNote, updateNote, toggleDone, deleteNote, restoreNote } = useNotes(filterTag, view, contentType)
  const actions = { onEdit: updateNote, onToggle: toggleDone, onDelete: deleteNote, onRestore: restoreNote }
  const query = search.trim().toLocaleLowerCase('vi')
  const visibleNotes = notes.filter(n => `${n.title} ${n.content} ${n.tag}`.toLocaleLowerCase('vi').includes(query))
  const currentView = views.find(v => v.key === view)!

  function selectView(key: NoteView) {
    setView(key)
    setContentType('all')
    setFilterTag(null)
    setSearch('')
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>PWA Notes</h1>
        <p>Ghi chú và công việc</p>
      </header>
      <NoteForm onAdd={addNote} />
      <section className="notes-section" aria-labelledby="notes-heading">
        <nav className="view-filter" aria-label="Lọc trạng thái">
          {views.map(({ key, label }) => <button key={key} type="button" aria-pressed={view === key}
            className={view === key ? 'active' : ''} onClick={() => selectView(key)}>
            {label} <span className="nav-count">{counts[key]}</span>
          </button>)}
        </nav>
        <div className="list-toolbar">
          <h2 id="notes-heading">{currentView.label} <span>{visibleNotes.length}</span></h2>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input type="search" aria-label="Tìm ghi chú" placeholder="Tìm tiêu đề, nội dung, tag..."
              value={search} onChange={event => setSearch(event.target.value)} />
          </label>
        </div>
        {(view === 'active' || view === 'trash') && <div className="content-type-filter" role="group" aria-label="Lọc theo loại nội dung">
          <span>LOẠI HIỂN THỊ</span>
          {(['all', 'note', 'task'] as const).map(type => <button key={type} type="button"
            className={contentType === type ? 'active' : ''} aria-pressed={contentType === type}
            onClick={() => { setContentType(type); setFilterTag(null) }}>{contentTypeLabels[type]}</button>)}
        </div>}
        {(allTags.length > 0 || filterTag) && <div className="tag-filter" aria-label="Lọc theo tag">
          <span>TAG</span><button type="button" className={!filterTag ? 'active' : ''} aria-pressed={!filterTag} onClick={() => setFilterTag(null)}>Tất cả</button>
          {allTags.map(tag => <button key={tag} type="button" className={filterTag === tag ? 'active' : ''}
            aria-pressed={filterTag === tag} onClick={() => setFilterTag(tag)}>#{tag}</button>)}
        </div>}
        {error && <p className="error-message" role="alert">{error}</p>}
        {loading ? <p role="status">Đang tải ghi chú...</p> : !error && <NoteList notes={visibleNotes} now={now}
          emptyMessage="Không có ghi chú phù hợp với bộ lọc hoặc từ khóa đang chọn." {...actions} />}
      </section>
    </main>
  )
}
