import type { Note } from '../db/database'
import { buildStatsSeries } from '../lib/stats'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

export default function ActivityChart({ notes, now }: { notes: Note[]; now: number }) {
  const series = buildStatsSeries(notes, 'days14', now, 'task')
  if (!series.created && !series.completed) return <div className="dashboard-chart-empty"><p>Chưa có hoạt động công việc trong 14 ngày gần nhất.</p><small>Công việc được tạo hoặc hoàn thành sẽ xuất hiện tại đây.</small></div>
  return <>
    <div className="activity-legend"><span><i />Tạo mới <strong>{series.created}</strong></span><span><i />Hoàn thành <strong>{series.completed}</strong></span></div>
    <div className="activity-chart" role="img" aria-label={`14 ngày gần nhất: tạo ${series.created}, hoàn thành ${series.completed} công việc`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series.buckets} margin={{ top: 12, right: 4, left: -26, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={11} stroke="var(--color-muted)" minTickGap={18} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} fontSize={11} stroke="var(--color-muted)" />
          <Tooltip cursor={{ fill: 'var(--color-surface-muted)' }} />
          <Bar dataKey="tasksCreated" name="Tạo mới" fill="var(--chart-created)" radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
          <Bar dataKey="completed" name="Hoàn thành" fill="var(--color-accent)" radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </>
}
