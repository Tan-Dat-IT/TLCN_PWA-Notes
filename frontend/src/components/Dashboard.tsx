import { lazy, Suspense, useState } from 'react'
import { ArrowRight, CalendarDays, CheckCheck, CircleCheck, ListTodo } from 'lucide-react'
import type { Note } from '../db/database'
import { formatTime } from '../db/noteFields'
import { buildWorkspaceSummary, matchesDeadline, type DeadlineFilter } from '../lib/stats'
import type { Page } from '../lib/navigation'

const ActivityChart = lazy(() => import('./ActivityChart'))
interface Props {
  notes: Note[]
  summary: ReturnType<typeof buildWorkspaceSummary>
  now: number
  isLoading: boolean
  onOpen: (note: Note) => void
  onNavigate: (page: Page, deadline?: DeadlineFilter) => void
}

export default function Dashboard({ notes, summary, now, isLoading, onOpen, onNavigate }: Props) {
  const [attention, setAttention] = useState<'overdue' | 'week'>('overdue')
  const tasks = notes.filter(note => matchesDeadline(note, attention, now))
    .sort((a, b) => a.dueAt! - b.dueAt! || (a.id ?? 0) - (b.id ?? 0))
  const metrics = [
    { label: 'Tổng công việc', value: summary.taskCount, page: 'tasks' as Page },
    { label: 'Đã hoàn thành', value: summary.counts.done, page: 'stats' as Page },
    { label: 'Đang quá hạn', value: summary.counts.overdue, page: 'tasks' as Page, deadline: 'overdue' as DeadlineFilter },
    { label: 'Ghi chú', value: summary.noteCount, page: 'notes' as Page }
  ]
  return <div className="dashboard">
    <section className="dashboard-summary" aria-label="Tổng quan công việc">
      <div className="dashboard-metrics">{metrics.map(metric => <button key={metric.label} className={metric.deadline && metric.value ? 'has-warning' : ''} onClick={() => onNavigate(metric.page, metric.deadline)} disabled={isLoading}>
        <span>{metric.label}<ArrowRight size={14} aria-hidden="true" /></span><strong>{isLoading ? '—' : metric.value}</strong>
      </button>)}</div>
      <div className="dashboard-progress"><span><CircleCheck size={15} />Tiến độ công việc <strong>{summary.counts.done}/{summary.taskCount}</strong></span>
        <div role="progressbar" aria-label="Tỷ lệ công việc hoàn thành" aria-valuenow={summary.completionRate} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${summary.completionRate}%` }} /></div><strong>{summary.completionRate}%</strong>
      </div>
    </section>
    {isLoading ? <p className="work-loading" role="status"><span className="ai-spinner" /> Đang tải dữ liệu trên thiết bị...</p> : <div className="dashboard-bottom">
      <section className="dashboard-attention" aria-labelledby="attention-title">
        <div className="dashboard-section-heading"><div><h2 id="attention-title">Cần chú ý</h2><p>Các công việc gần đến hạn của bạn.</p></div><ListTodo size={19} aria-hidden="true" /></div>
        <div className="attention-tabs" role="group" aria-label="Công việc cần chú ý">
          <button aria-pressed={attention === 'overdue'} onClick={() => setAttention('overdue')}>Quá hạn <span>{summary.counts.overdue}</span></button>
          <button aria-pressed={attention === 'week'} onClick={() => setAttention('week')}>Trong 7 ngày tới</button>
        </div>
        {tasks.length ? <ul className="attention-list">{tasks.slice(0, 5).map(note => <li key={note.id ?? note.serverId}>
          <button onClick={() => onOpen(note)}><span className={`attention-marker${attention === 'overdue' ? ' warning' : ''}`} /><span><strong>{note.title}</strong><small><CalendarDays size={12} />{formatTime(note.dueAt)}{note.tag && ` · #${note.tag}`}</small></span><ArrowRight size={15} /></button>
        </li>)}</ul> : <div className="attention-empty"><CheckCheck size={27} strokeWidth={1.5} /><strong>{attention === 'overdue' ? 'Không có công việc quá hạn' : 'Chưa có công việc đến hạn trong 7 ngày tới'}</strong><p>{attention === 'overdue' ? 'Bạn đã bắt kịp các thời hạn hiện tại.' : 'Các công việc có deadline sắp tới sẽ xuất hiện ở đây.'}</p></div>}
        <button className="dashboard-text-link" onClick={() => onNavigate('tasks', attention)}>Xem tất cả{tasks.length > 0 && ` (${tasks.length})`}<ArrowRight size={14} /></button>
      </section>
      <section className="dashboard-activity" aria-labelledby="activity-title">
        <div className="dashboard-section-heading"><div><h2 id="activity-title">Hoạt động công việc</h2><p>14 ngày gần nhất · theo ngày</p></div></div>
        <Suspense fallback={<p className="stats-empty" role="status">Đang tải biểu đồ...</p>}><ActivityChart notes={notes} now={now} /></Suspense>
        <button className="dashboard-text-link" onClick={() => onNavigate('stats')}>Xem thống kê chi tiết<ArrowRight size={14} /></button>
      </section>
    </div>}
    <p className="dashboard-data-note">Số liệu trên thiết bị, gồm thay đổi chưa đồng bộ và không gồm nội dung đã xóa.</p>
  </div>
}
