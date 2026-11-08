import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Note } from '../db/database'
import StatsCharts from './StatsCharts'

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
    render(<StatsCharts notes={[]} />)
    expect(screen.getByText('Không có công việc hoàn thành trong 14 ngày gần nhất.')).toBeTruthy()
    expect(screen.getByText('Chưa có dữ liệu.')).toBeTruthy()
    expect(screen.queryByTestId('pie-tag')).toBeNull()
  })

  it('supplies the tag chart with the count for a single tag', () => {
    render(<StatsCharts notes={[note('hoc-tap'), note('hoc-tap')]} />)
    const chart = screen.getByTestId('pie-tag')
    expect(JSON.parse(chart.getAttribute('data-values')!)).toEqual([{ tag: 'hoc-tap', count: 2 }])
  })

  it('orders multiple tags by count and retains the 14-day completion chart', () => {
    render(<StatsCharts notes={[
      note('ca-nhan'), note('cong-viec'), note('cong-viec'),
      note('xong', { kind: 'task', done: true, completedAt: Date.now() })
    ]} />)
    const tags = JSON.parse(screen.getByTestId('pie-tag').getAttribute('data-values')!)
    expect(tags[0]).toEqual({ tag: 'cong-viec', count: 2 })
    expect(screen.queryByText('Không có công việc hoàn thành trong 14 ngày gần nhất.')).toBeNull()
    expect(screen.getByTestId('bar-completed')).toBeTruthy()
    expect(screen.getByLabelText('Tỷ lệ hoàn thành 100%')).toBeTruthy()
  })
})
