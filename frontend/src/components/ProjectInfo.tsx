import { useRef } from 'react'

export default function ProjectInfo() {
  const dialog = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button className="project-info-button" onClick={() => dialog.current?.showModal()}>
        <span aria-hidden="true">ⓘ</span> Thông tin đề tài
      </button>
      <dialog ref={dialog} className="project-dialog" aria-labelledby="project-title">
        <div className="project-dialog-header">
          <p className="eyebrow">TIỂU LUẬN CHUYÊN NGÀNH CÔNG NGHỆ THÔNG TIN</p>
          <button className="project-close" aria-label="Đóng thông tin đề tài" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <h2 id="project-title">Xây dựng ứng dụng web offline-first cho ghi chú và công việc trên nền tảng Progressive Web App (PWA)</h2>
        <p className="project-description">Ứng dụng quản lý ghi chú và công việc trên desktop, hỗ trợ làm việc khi mất mạng và tự động đồng bộ dữ liệu hai chiều khi có kết nối trở lại.</p>
        <section aria-labelledby="project-team">
          <h3 id="project-team">Nhóm thực hiện <span>03 thành viên</span></h3>
          <div className="project-team-grid">
            <article className="project-person"><span className="person-monogram" aria-hidden="true">ĐĐ</span><div><h4>ĐẶNG TẤN ĐẠT</h4><p>MSSV: <strong>24TX610008</strong></p></div></article>
            <article className="project-person"><span className="person-monogram" aria-hidden="true">QB</span><div><h4>NGUYỄN QUỐC BẢO</h4><p>MSSV: <strong>24TX810057</strong></p></div></article>
            <article className="project-person"><span className="person-monogram" aria-hidden="true">DP</span><div><h4>PHẠM DUY PHƯỚC</h4><p>MSSV: <strong>24TX610011</strong></p></div></article>
          </div>
        </section>
        <section className="project-supervisor" aria-labelledby="project-supervisor">
          <h3 id="project-supervisor">Giảng viên hướng dẫn</h3>
          <h4>TRẦN QUANG KHẢI</h4>
          <p>MGV: <strong>6452</strong></p>
        </section>
        <section className="project-objectives" aria-labelledby="project-objectives">
          <h3 id="project-objectives">Mục tiêu đề tài</h3>
          <ul>
            <li>Áp dụng Service Worker, Web App Manifest và IndexedDB để xây dựng PWA hoạt động offline.</li>
            <li>Xây dựng lưu trữ offline-first và đồng bộ hai chiều client–server.</li>
            <li>Đánh giá hiệu quả và giới hạn của offline-first so với web app truyền thống.</li>
          </ul>
        </section>
        <footer className="project-technologies" aria-label="Công nghệ sử dụng">
          {['React · TypeScript', 'IndexedDB · Dexie.js', 'Service Worker', 'Node.js · Express', 'SQL Server', 'REST API'].map(technology => <span key={technology}>{technology}</span>)}
        </footer>
      </dialog>
    </>
  )
}
