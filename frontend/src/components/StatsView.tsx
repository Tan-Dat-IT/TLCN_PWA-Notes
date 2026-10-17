import { lazy, Suspense, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'

// recharts khá nặng - chỉ tải khi người dùng thực sự mở hộp thoại thống kê,
// tránh làm phình bundle chính của PWA (ảnh hưởng thời gian tải lần đầu).
const StatsCharts = lazy(() => import('./StatsCharts'))

export default function StatsView() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [opened, setOpened] = useState(false)
  const notes = useLiveQuery(() => db.notes.toArray(), []) ?? []

  return (
    <>
      <button className="project-info-button stats-button" onClick={() => { setOpened(true); dialog.current?.showModal() }}>
        <span aria-hidden="true">📊</span> Thống kê
      </button>
      <dialog ref={dialog} className="project-dialog stats-dialog" aria-labelledby="stats-title">
        <div className="project-dialog-header">
          <p className="eyebrow">TỔNG QUAN DỮ LIỆU TRÊN THIẾT BỊ NÀY</p>
          <button className="project-close" aria-label="Đóng thống kê" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <h2 id="stats-title">Thống kê ghi chú &amp; công việc</h2>
        {opened && (
          <Suspense fallback={<p className="stats-empty">Đang tải biểu đồ...</p>}>
            <StatsCharts notes={notes} />
          </Suspense>
        )}
      </dialog>
    </>
  )
}
