import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import PlanningAssistant from './PlanningAssistant'
import { clearLocalData, db } from '../db/database'
import { loadSavedPlan, planningStorageKey } from '../db/plannerStorage'
import type { PlanningResult } from '../db/planner'

const response: PlanningResult = {
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
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    await db.meta.clear()
    await db.notes.clear()
  })

  it('shows the calendar first without modifying tasks and opens the selected task', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetch)
    const onOpenTask = vi.fn()
    render(<PlanningAssistant accountKey="planner-test" onOpenTask={onOpenTask} />)
    expect(fetch).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    expect(await screen.findByText('Có thể xếp hết công việc.')).toBeTruthy()
    const calendar = screen.getByRole('region', { name: 'Lịch đề xuất' })
    expect(calendar.compareDocumentPosition(document.querySelector('.planning-summary')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('So sánh phương án').closest('details')).toHaveProperty('open', false)
    fireEvent.click(within(calendar).getByRole('button', { name: /Làm slide/ }))
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ serverId: 't1' }))
  })

  it('hiển thị cảnh báo khi AI dùng ước lượng dự phòng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...response, aiUsed: false, warning: 'Ollama chưa chạy' }) }))
    render(<PlanningAssistant accountKey="planner-test" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await waitFor(() => expect(screen.getByText(/AI chưa phản hồi/)).toBeTruthy())
    expect(screen.getByText(/thời lượng ước tính bằng quy tắc/)).toBeTruthy()
  })

  it('hiển thị trạng thái không có công việc đang mở', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...response, sourceTaskCount: 0, tasks: [], days: [], scenarios: [], insights: ['Không có công việc.'] }) }))
    render(<PlanningAssistant accountKey="planner-test" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    expect(await screen.findByText('Chưa có công việc để lên lịch')).toBeTruthy()
  })

  it('sends hours and custom dates through the existing minutes/days API', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetch)
    render(<PlanningAssistant accountKey="planner-test" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Thời gian dành mỗi ngày' }), { target: { value: '120' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Khoảng thời gian' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Số ngày lên kế hoạch'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Ưu tiên cho kế hoạch'), { target: { value: '  Làm slide trước  ' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByRole('region', { name: 'Lịch đề xuất' })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ dailyCapacityMinutes: 120, horizonDays: 5, goal: 'Làm slide trước' })
  })

  it('keeps options after an API error and can retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'Máy chủ đang bận' }) }).mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetch)
    render(<PlanningAssistant accountKey="planner-test" />)
    fireEvent.change(screen.getByLabelText('Ưu tiên cho kế hoạch'), { target: { value: 'Hoàn thành slide' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Máy chủ đang bận')
    expect(screen.getByLabelText('Ưu tiên cho kế hoạch')).toHaveProperty('value', 'Hoàn thành slide')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    expect(await screen.findByRole('region', { name: 'Lịch đề xuất' })).toBeTruthy()
  })

  it('cancels an active request when leaving the page and keeps options', async () => {
    let aborted = false
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('cancelled', 'AbortError')) })
    })))
    const { rerender } = render(<PlanningAssistant accountKey="planner-test" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Thời gian dành mỗi ngày' }), { target: { value: '120' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    rerender(<PlanningAssistant accountKey="planner-test" active={false} />)
    await waitFor(() => expect(aborted).toBe(true))
    rerender(<PlanningAssistant accountKey="planner-test" active />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toBeTruthy())
    expect(screen.getByRole('combobox', { name: 'Thời gian dành mỗi ngày' })).toHaveProperty('value', '120')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables generation offline', () => {
    render(<PlanningAssistant accountKey="planner-test" isOnline={false} />)
    expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', true)
  })

  it('identifies old results after changing the time budget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    render(<PlanningAssistant accountKey="planner-test" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gợi ý kế hoạch' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByRole('region', { name: 'Lịch đề xuất' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Thời gian dành mỗi ngày' }), { target: { value: '60' } })
    expect(screen.getByText(/Bạn đã thay đổi lựa chọn/)).toBeTruthy()
  })

  it('restores the latest saved plan and custom options offline after remounting without another AI call', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...response, dailyCapacityMinutes: 135, horizonDays: 5 }) })
    vi.stubGlobal('fetch', fetch)
    const first = render(<PlanningAssistant accountKey="planner-test" />)
    await screen.findByRole('heading', { name: 'Chưa có kế hoạch' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Thời gian dành mỗi ngày' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Số phút mỗi ngày'), { target: { value: '135' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Khoảng thời gian' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Số ngày lên kế hoạch'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Ưu tiên cho kế hoạch'), { target: { value: '  Làm slide trước  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText('Đã lưu trên thiết bị này')
    expect(await db.notes.count()).toBe(0)
    first.unmount()

    render(<PlanningAssistant accountKey="planner-test" isOnline={false} />)
    await screen.findByRole('region', { name: 'Lịch đề xuất' })
    expect(screen.getByLabelText('Số phút mỗi ngày')).toHaveProperty('value', '135')
    expect(screen.getByLabelText('Số ngày lên kế hoạch')).toHaveProperty('value', '5')
    expect(screen.getByLabelText('Ưu tiên cho kế hoạch')).toHaveProperty('value', 'Làm slide trước')
    expect(screen.getByText(/Có thể xem kế hoạch đã lưu/)).toBeTruthy()
    expect(screen.queryByText(/Bạn đã thay đổi lựa chọn/)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous plan on screen and on disk when regeneration fails or is cancelled', async () => {
    let resolveLate!: (value: unknown) => void
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => response })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'Máy chủ đang bận' }) })
      .mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve }))
    vi.stubGlobal('fetch', fetch)
    render(<PlanningAssistant accountKey="planner-test" />)
    await screen.findByRole('heading', { name: 'Chưa có kế hoạch' })
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText('Đã lưu trên thiết bị này')
    const original = await loadSavedPlan('planner-test')
    fireEvent.change(screen.getByLabelText('Ưu tiên cho kế hoạch'), { target: { value: 'Ưu tiên mới' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText('Máy chủ đang bận')
    expect(screen.getByRole('region', { name: 'Lịch đề xuất' })).toBeTruthy()
    expect(await loadSavedPlan('planner-test')).toEqual(original)

    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hủy yêu cầu' }))
    await act(async () => { resolveLate({ ok: true, json: async () => ({ ...response, insights: ['Kết quả đã hủy'] }) }) })
    await screen.findByRole('button', { name: 'Gợi ý kế hoạch' })
    expect(screen.queryByText('Kết quả đã hủy')).toBeNull()
    expect(screen.getByRole('region', { name: 'Lịch đề xuất' })).toBeTruthy()
    expect(await loadSavedPlan('planner-test')).toEqual(original)
  })

  it('isolates accounts and ignores a previous account’s late AI response', async () => {
    let resolveLate!: (value: unknown) => void
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => response })
      .mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve }))
    vi.stubGlobal('fetch', fetch)
    const { rerender } = render(<PlanningAssistant accountKey="account-a" />)
    await screen.findByRole('heading', { name: 'Chưa có kế hoạch' })
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText('Đã lưu trên thiết bị này')
    rerender(<PlanningAssistant accountKey="account-b" />)
    await screen.findByRole('heading', { name: 'Chưa có kế hoạch' })
    expect(screen.queryByRole('region', { name: 'Lịch đề xuất' })).toBeNull()
    expect(screen.getByLabelText('Ưu tiên cho kế hoạch')).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    rerender(<PlanningAssistant accountKey="account-a" />)
    await screen.findByRole('region', { name: 'Lịch đề xuất' })
    await act(async () => { resolveLate({ ok: true, json: async () => ({ ...response, insights: ['Kế hoạch tài khoản B'] }) }) })
    expect(screen.queryByText('Kế hoạch tài khoản B')).toBeNull()
    expect(await loadSavedPlan('account-b')).toBeNull()
    expect((await loadSavedPlan('account-a'))?.result.insights).toEqual(response.insights)
  })

  it('reports a storage failure, preserves the old saved plan and retries saving without calling AI again', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => response })
      .mockResolvedValue({ ok: true, json: async () => ({ ...response, insights: ['Lịch mới'] }) })
    vi.stubGlobal('fetch', fetch)
    render(<PlanningAssistant accountKey="planner-test" />)
    await screen.findByRole('heading', { name: 'Chưa có kế hoạch' })
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText('Đã lưu trên thiết bị này')
    const original = await loadSavedPlan('planner-test')
    vi.spyOn(db.meta, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText(/Chưa lưu được kế hoạch trên thiết bị/)
    expect(screen.queryByText('Đã lưu trên thiết bị này')).toBeNull()
    expect(await loadSavedPlan('planner-test')).toEqual(original)
    fireEvent.click(screen.getByRole('button', { name: 'Thử lưu lại' }))
    await screen.findByText('Đã lưu trên thiết bị này')
    expect((await loadSavedPlan('planner-test'))?.result.insights).toEqual(['Lịch mới'])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('handles corrupt saved data without deleting other metadata or tasks', async () => {
    await db.meta.bulkPut([{ key: planningStorageKey('planner-test'), value: '{bad json' }, { key: 'syncCursor', value: '42' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    render(<PlanningAssistant accountKey="planner-test" />)
    await screen.findByText(/Bản kế hoạch đã lưu không đọc được/)
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText('Đã lưu trên thiết bị này')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await db.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '42' })
    expect(await db.notes.count()).toBe(0)
  })

  it('does not recreate a plan after local data is cleared during an AI request', async () => {
    let resolveLate!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveLate = resolve })))
    render(<PlanningAssistant accountKey="planner-test" />)
    await screen.findByRole('heading', { name: 'Chưa có kế hoạch' })
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await clearLocalData()
    await act(async () => { resolveLate({ ok: true, json: async () => response }) })
    expect(await loadSavedPlan('planner-test')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Lịch đề xuất' })).toBeNull()
  })

  it('can retry a failed storage read under StrictMode without sending an AI request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    const first = render(<PlanningAssistant accountKey="planner-test" />)
    await screen.findByRole('heading', { name: 'Chưa có kế hoạch' })
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý kế hoạch' }))
    await screen.findByText('Đã lưu trên thiết bị này')
    first.unmount()
    vi.mocked(fetch).mockClear()
    vi.spyOn(db.meta, 'get').mockRejectedValueOnce(new Error('unavailable')).mockRejectedValueOnce(new Error('unavailable'))
    render(<StrictMode><PlanningAssistant accountKey="planner-test" /></StrictMode>)
    await screen.findByText(/Chưa đọc được kế hoạch trên thiết bị/)
    fireEvent.click(screen.getByRole('button', { name: 'Đọc lại bản lưu' }))
    await screen.findByRole('region', { name: 'Lịch đề xuất' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
