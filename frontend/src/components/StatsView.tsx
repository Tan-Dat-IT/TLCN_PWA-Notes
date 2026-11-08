import { lazy, Suspense } from 'react'
import type { Note } from '../db/database'

// Load the detailed report only when its page is visited.
const StatsCharts = lazy(() => import('./StatsCharts'))

export default function StatsView({ notes, now }: { notes: Note[]; now: number }) {
  return <section className="stats-page" aria-label="Thống kê ghi chú và công việc">
    <p className="stats-scope">Số liệu trên thiết bị, gồm thay đổi chưa đồng bộ. Nội dung đã xóa không tính vào tổng; chỉ số chờ đồng bộ vẫn tính thao tác xóa. Khoảng thời gian chỉ áp dụng cho biểu đồ hoạt động và thời hạn.</p>
    <Suspense fallback={<p className="stats-empty" role="status">Đang tải biểu đồ...</p>}>
      <StatsCharts notes={notes} now={now} />
    </Suspense>
  </section>
}
