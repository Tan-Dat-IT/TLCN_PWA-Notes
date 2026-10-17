import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlanningAssistant from './PlanningAssistant'

const response = {
  generatedAt: 1, sourceTaskCount: 1, aiUsed: true, warning: null,
  dailyCapacityMinutes: 180, horizonDays: 14, totalEstimatedMinutes: 60,
  completedTasks: 1, atRiskTasks: 0, unscheduledTasks: 0, projectedFinishDate: '2026-09-28', model: 'llama3.2',
  tasks: [{ serverId: 't1', title: 'Làm slide', tag: 'học tập', dueAt: null, estimatedMinutes: 60, priority: 3, reason: 'Cần chuẩn bị', status: 'planned', scheduledMinutes: 60, unscheduledMinutes: 0, projectedFinishDate: '2026-09-28', allocations: [{ date: '2026-09-28', minutes: 60 }] }],
  days: [{ date: '2026-09-28', capacityMinutes: 180, usedMinutes: 60, allocations: [{ serverId: 't1', title: 'Làm slide', minutes: 60 }] }],
  scenarios: [
    { key: 'reduced', label: 'Năng lực -25%', dailyCapacityMinutes: 135, completedTasks: 1, atRiskTasks: 0, unscheduledTasks: 0, projectedFinishDate: '2026-09-28' },
    { key: 'base', label: 'Cơ sở', dailyCapacityMinutes: 180, completedTasks: 1, atRiskTasks: 0, unscheduledTasks: 0, projectedFinishDate: '2026-09-28' },
    { key: 'increased', label: 'Năng lực +25%', dailyCapacityMinutes: 225, completedTasks: 1, atRiskTasks: 0, unscheduledTasks: 0, projectedFinishDate: '2026-09-28' }
  ],
  insights: ['Có thể xếp hết công việc.']
}

describe('PlanningAssistant', () => {
  beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('hiển thị mô phỏng và mở công việc được chọn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    const onOpenTask = vi.fn()
    render(<PlanningAssistant onOpenTask={onOpenTask} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kế hoạch AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mô phỏng tiến độ' }))
    expect(await screen.findByText('Có thể xếp hết công việc.')).toBeTruthy()
    expect(screen.getByText('Năng lực -25%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Làm slide/ }))
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ serverId: 't1' }))
  })

  it('hiển thị cảnh báo khi AI dùng ước lượng dự phòng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...response, aiUsed: false, warning: 'Ollama chưa chạy' }) }))
    render(<PlanningAssistant />)
    fireEvent.click(screen.getByRole('button', { name: 'Kế hoạch AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mô phỏng tiến độ' }))
    await waitFor(() => expect(screen.getByText(/Ollama chưa dùng được/)).toBeTruthy())
    expect(screen.getByText(/ước lượng dự phòng/)).toBeTruthy()
  })

  it('hiển thị trạng thái không có công việc đang mở', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...response, sourceTaskCount: 0, tasks: [], days: [], scenarios: [], insights: ['Không có công việc.'] }) }))
    render(<PlanningAssistant />)
    fireEvent.click(screen.getByRole('button', { name: 'Kế hoạch AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mô phỏng tiến độ' }))
    expect(await screen.findByText('Không có công việc đang mở đã đồng bộ để lập kế hoạch.')).toBeTruthy()
  })
})
