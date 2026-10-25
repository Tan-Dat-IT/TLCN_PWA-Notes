import './styles.css'

export default function App() {
  return (
    <main className="app">
      <header className="app-header">
        <h1>PWA Notes</h1>
        <p>Ghi chú và công việc</p>
      </header>
      <section className="empty-state" aria-labelledby="empty-heading">
        <h2 id="empty-heading">Chưa có ghi chú</h2>
        <p>Ghi chú của bạn sẽ hiển thị tại đây.</p>
      </section>
    </main>
  )
}
