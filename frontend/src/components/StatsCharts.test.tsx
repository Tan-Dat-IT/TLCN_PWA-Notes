import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Note } from '../db/database'
import StatsCharts from './StatsCharts'

const now = new Date(2026, 10, 14, 12).getTime()
const weekLabel = '08/11/2026 – 14/11/2026'

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Pie = ({ children, data, nameKey }: { children?: ReactNode; data: unknown[]; nameKey: string }) =>
    <div data-testid={`pie-${nameKey}`} data-values={JSON.stringify(data)}>{children}</div>
  const Bar = ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />
  return {
    ResponsiveContainer: Container, BarChart: Container, Bar,
    XAxis: Container, YAxis: Container, Tooltip: Container, CartesianGrid: Container,
    PieChart: Container, Pie, Cell: Container, Legend: Container
  }
})

function note(tag: string, changes: Partial<Note> = {}): Note {
  return {
    kind: 'note', createdAt: Date.now(), startAt: null, dueAt: null,
    completedAt: null, deletedAt: null, title: 'Ghi chú', content: '', tag,
    done: false, updatedAt: Date.now(), synced: 1, deleted: 0, ...changes
  }
}

describe('statistics presentation', () => {
  it('counts a pending note deletion without including it in the active note total', () => {
    render(<StatsCharts notes={[note('deleted', { deleted: 1, synced: 0 })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }))
    expect(screen.getByText('Tổng ghi chú').parentElement?.textContent).toBe('Tổng ghi chú0')
    expect(screen.getByText('Chờ đồng bộ').parentElement?.textContent).toBe('Chờ đồng bộ1')
  })
  it('explains both empty datasets instead of showing an empty chart', () => {
    render(<StatsCharts notes={[]} now={now} />)
    expect(screen.getByText(`Không có công việc hoàn thành trong ${weekLabel}.`)).toBeTruthy()
    expect(screen.getByText('Chưa có dữ liệu.')).toBeTruthy()
    expect(screen.queryByTestId('pie-tag')).toBeNull()
  })

  it('supplies the tag chart with the count for a single tag', () => {
    render(<StatsCharts notes={[note('hoc-tap'), note('hoc-tap')]} />)
    const chart = screen.getByTestId('pie-tag')
    expect(JSON.parse(chart.getAttribute('data-values')!)).toEqual([{ tag: 'hoc-tap', count: 2 }])
  })

  it('orders multiple tags by count and retains the completion chart', () => {
    render(<StatsCharts notes={[
      note('ca-nhan'), note('cong-viec'), note('cong-viec'),
      note('xong', { kind: 'task', done: true, completedAt: now })
    ]} now={now} />)
    const tags = JSON.parse(screen.getByTestId('pie-tag').getAttribute('data-values')!)
    expect(tags[0]).toEqual({ tag: 'cong-viec', count: 2 })
    expect(screen.queryByText(`Không có công việc hoàn thành trong ${weekLabel}.`)).toBeNull()
    expect(screen.getByTestId('bar-completed')).toBeTruthy()
    expect(screen.getByLabelText('Tỷ lệ hoàn thành 100%')).toBeTruthy()
  })

  it('fills both dates from presets, then clears the selection for a custom range', () => {
    render(<StatsCharts notes={[]} now={now} />)
    expect((screen.getByLabelText('Từ ngày') as HTMLInputElement).value).toBe('2026-11-08')
    expect((screen.getByLabelText('Đến ngày') as HTMLInputElement).value).toBe('2026-11-14')
    expect(screen.getByRole('button', { name: '7 ngày' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '1 tháng' }))
    expect((screen.getByLabelText('Từ ngày') as HTMLInputElement).value).toBe('2026-10-14')
    expect(screen.getByRole('button', { name: '1 tháng' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-11-01' } })
    expect(screen.getByRole('button', { name: '1 tháng' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '7 ngày' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByText(/01\/11\/2026 – 14\/11\/2026/).length).toBeGreaterThan(0)
  })

  it('keeps the last valid period while dates are missing or reversed, and recovers with a preset', () => {
    render(<StatsCharts notes={[]} now={now} />)
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-11-15' } })
    expect(screen.getByRole('alert').textContent).toContain('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.')
    expect(screen.getByText(`Không có công việc hoàn thành trong ${weekLabel}.`)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '' } })
    expect(screen.getByRole('alert').textContent).toContain('Chọn đủ ngày bắt đầu và kết thúc.')
    fireEvent.click(screen.getByRole('button', { name: '7 ngày' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('filters event charts without changing the workspace totals, completion rate or tags', () => {
    render(<StatsCharts notes={[
      note('hoc-tap', { createdAt: new Date(2026, 9, 1).getTime(), kind: 'task', done: true, completedAt: new Date(2026, 9, 2).getTime() }),
      note('cong-viec', { createdAt: now, kind: 'task', done: true, completedAt: now })
    ]} now={now} />)
    const totals = screen.getByText('Tổng nội dung').parentElement?.textContent
    const tagData = screen.getByTestId('pie-tag').getAttribute('data-values')
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-09-30' } })
    expect(screen.getByText('Tổng nội dung').parentElement?.textContent).toBe(totals)
    expect(screen.getByTestId('pie-tag').getAttribute('data-values')).toBe(tagData)
    expect(screen.getByLabelText('Tỷ lệ hoàn thành 100%')).toBeTruthy()
    expect(screen.queryByTestId('bar-completed')).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Phân loại thống kê' })).getByRole('button', { name: 'Tất cả' }).getAttribute('aria-pressed')).toBe('true')
  })
})
