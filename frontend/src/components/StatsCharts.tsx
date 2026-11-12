import { useMemo, useState } from 'react'
import type { Note } from '../db/database'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import { buildStatsSeries, buildTaskStatusReport, buildWorkspaceSummary, buildTagDistribution, groupTagDistribution, type StatsContentType, type StatsRange } from '../lib/stats'

const COLORS = Array.from({ length: 8 }, (_, index) => 'var(--chart-' + (index + 1) + ')')
const TYPE_LABELS: Record<StatsContentType, string> = { all: 'Tất cả', note: 'Ghi chú', task: 'Công việc' }

interface Props { notes: Note[]; now?: number }

export default function StatsCharts({ notes, now = Date.now() }: Props) {
  const [contentType, setContentType] = useState<StatsContentType>('all')
  const [range, setRange] = useState<StatsRange>('days14')
  const periodLabel = range === 'days14' ? '14 ngày gần nhất' : '6 tháng gần nhất'
  const unitLabel = range === 'days14' ? 'ngày' : 'tháng'
  const contentNoun = contentType === 'all' ? 'nội dung' : TYPE_LABELS[contentType].toLocaleLowerCase('vi')
  const series = useMemo(() => buildStatsSeries(notes, range, now, contentType), [notes, range, now, contentType])
  const taskStatus = useMemo(() => buildTaskStatusReport(notes, now), [notes, now])
  const summary = useMemo(() => buildWorkspaceSummary(notes, now), [notes, now])

  const activeContent = notes.filter(n => n.deleted === 0)
  const doneTasks = summary.counts.done
  const completionRate = summary.completionRate
  const completionStatus = [
    { status: 'Đã hoàn thành', count: doneTasks, color: 'var(--color-accent)' },
    { status: 'Chưa hoàn thành', count: taskStatus.inProgress + taskStatus.openOverdue, color: 'var(--chart-open)' }
  ]
  const filteredContent = contentType === 'all' ? activeContent : activeContent.filter(n => n.kind === contentType)
  const tagDistribution = useMemo(() => buildTagDistribution(notes, contentType), [notes, contentType])
  const chartTags = groupTagDistribution(tagDistribution)

  const summaryCards = contentType === 'all' ? [
    { label: 'Tổng nội dung', value: summary.counts.active },
    { label: 'Ghi chú', value: summary.noteCount },
    { label: 'Công việc', value: summary.taskCount },
    { label: 'Đã hoàn thành', value: doneTasks }
  ] : contentType === 'note' ? [
    { label: 'Tổng ghi chú', value: summary.noteCount },
    { label: `Tạo trong ${periodLabel}`, value: series.created },
    { label: 'Số tag', value: tagDistribution.length },
    { label: 'Chờ đồng bộ', value: summary.pendingNoteCount }
  ] : [
    { label: 'Đang thực hiện', value: taskStatus.inProgress },
    { label: 'Đang quá hạn', value: taskStatus.openOverdue },
    { label: 'Hoàn thành không trễ', value: taskStatus.completedOnTime },
    { label: 'Hoàn thành trễ', value: taskStatus.completedLate }
  ]

  const overdueStatus = [
    { status: 'Đã hoàn thành trễ', count: series.completedLate, color: 'var(--color-warning)' },
    { status: 'Đang quá hạn', count: series.openOverdue, color: 'var(--color-danger)' }
  ].filter(item => item.count > 0)

  return (
    <div className="stats-report">
      <div className="stats-controls">
      <div className="stats-type-panel">
        <div><strong>Phân loại</strong></div>
        <div className="stats-type-options" role="group" aria-label="Phân loại thống kê">
          {(['all', 'note', 'task'] as const).map(type => (
            <button key={type} type="button" className={contentType === type ? 'active' : ''} aria-pressed={contentType === type} onClick={() => setContentType(type)}>{TYPE_LABELS[type]}</button>
          ))}
        </div>
      </div>

      <div className="stats-range-panel">
        <div><strong>Khoảng thời gian biểu đồ</strong></div>
        <div className="stats-range-options" role="group" aria-label="Khoảng thời gian thống kê">
          <button type="button" className={range === 'days14' ? 'active' : ''} aria-pressed={range === 'days14'} onClick={() => setRange('days14')}>14 ngày</button>
          <button type="button" className={range === 'months6' ? 'active' : ''} aria-pressed={range === 'months6'} onClick={() => setRange('months6')}>6 tháng</button>
        </div>
      </div>
      </div>

      <div className="stats-summary">
        {summaryCards.map(card => <div key={card.label}><span>{card.label}</span><strong>{card.value}</strong></div>)}
      </div>

      {contentType !== 'note' && <section>
        <h3>Tỷ lệ hoàn thành công việc</h3>
        {taskStatus.total === 0 ? <p className="stats-empty">Chưa có công việc.</p> : (
          <div className="stats-chart stats-donut stats-completion-chart" aria-label={`Tỷ lệ hoàn thành ${completionRate}%`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie isAnimationActive={false} data={completionStatus} dataKey="count" nameKey="status" innerRadius={58} outerRadius={86}>
                  {completionStatus.map(item => <Cell key={item.status} fill={item.color} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="stats-donut-label"><strong>{completionRate}%</strong><span>{doneTasks}/{taskStatus.total}</span></div>
          </div>
        )}
      </section>}

      <section>
        <h3>{contentType === 'all' ? 'Nội dung' : TYPE_LABELS[contentType]} được tạo <span>{periodLabel} · theo {unitLabel}</span></h3>
        {series.created === 0 ? <p className="stats-empty">Không có {contentNoun} được tạo trong {periodLabel}.</p> : (
          <div className="stats-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series.buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" fontSize={12} stroke="var(--color-muted)" />
                <YAxis allowDecimals={false} fontSize={12} stroke="var(--color-muted)" />
                <Tooltip />
                {contentType !== 'task' && <Bar isAnimationActive={false} dataKey="notesCreated" name="Ghi chú được tạo" stackId={contentType === 'all' ? 'created' : undefined} fill="var(--chart-notes)" radius={contentType === 'note' ? [4, 4, 0, 0] : undefined} />}
                {contentType !== 'note' && <Bar isAnimationActive={false} dataKey="tasksCreated" name="Công việc được tạo" stackId={contentType === 'all' ? 'created' : undefined} fill="var(--chart-created)" radius={[4, 4, 0, 0]} />}
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {contentType !== 'note' && <>
        <section>
          <h3>Công việc đã hoàn thành <span>{periodLabel} · theo {unitLabel}</span></h3>
          {series.completed === 0 ? <p className="stats-empty">Không có công việc hoàn thành trong {periodLabel}.</p> : (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series.buckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" fontSize={12} stroke="var(--color-muted)" />
                  <YAxis allowDecimals={false} fontSize={12} stroke="var(--color-muted)" />
                  <Tooltip />
                  <Bar isAnimationActive={false} dataKey="completed" name="Đã hoàn thành" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section>
          <h3>Trạng thái công việc quá hạn <span>{periodLabel} · tính theo deadline</span></h3>
          {overdueStatus.length === 0 ? <p className="stats-empty">Không có công việc quá hạn có deadline trong {periodLabel}.</p> : (
            <div className="stats-chart stats-donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie isAnimationActive={false} data={overdueStatus} dataKey="count" nameKey="status" innerRadius={45} outerRadius={85} label>
                    {overdueStatus.map(item => <Cell key={item.status} fill={item.color} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section>
          <h3>Công việc quá hạn theo {unitLabel} <span>{periodLabel} · tính theo deadline</span></h3>
          {series.completedLate === 0 && series.openOverdue === 0 ? <p className="stats-empty">Không có dữ liệu quá hạn trong {periodLabel}.</p> : (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series.buckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" fontSize={12} stroke="var(--color-muted)" />
                  <YAxis allowDecimals={false} fontSize={12} stroke="var(--color-muted)" />
                  <Tooltip />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="completedLate" name="Đã hoàn thành trễ" stackId="overdue" fill="var(--color-warning)" />
                  <Bar isAnimationActive={false} dataKey="openOverdue" name="Đang quá hạn" stackId="overdue" fill="var(--color-danger)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </>}

      <section>
        <h3>Phân bố theo tag <span>{TYPE_LABELS[contentType]} · toàn bộ dữ liệu</span></h3>
        {filteredContent.length === 0 || tagDistribution.length === 0 ? <p className="stats-empty">Chưa có dữ liệu.</p> : (
          <div className="stats-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie isAnimationActive={false} data={chartTags} dataKey="count" nameKey="tag" outerRadius={85} label>
                  {chartTags.map((entry, i) => <Cell key={entry.tag} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  )
}
