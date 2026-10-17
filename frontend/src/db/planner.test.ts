import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlannerCancelled, PlannerError, simulatePlan } from './planner'

const response = {
  generatedAt: 1, sourceTaskCount: 1, aiUsed: true, warning: null,
  dailyCapacityMinutes: 180, horizonDays: 14, totalEstimatedMinutes: 60,
  completedTasks: 1, atRiskTasks: 0, unscheduledTasks: 0, projectedFinishDate: '2026-09-28', model: 'llama3.2',
  tasks: [{ serverId: 't1', title: 'Làm slide', tag: 'học tập', dueAt: null, estimatedMinutes: 60, priority: 3, reason: 'Cần chuẩn bị', status: 'planned', scheduledMinutes: 60, unscheduledMinutes: 0, projectedFinishDate: '2026-09-28', allocations: [{ date: '2026-09-28', minutes: 60 }] }],
  days: [{ date: '2026-09-28', capacityMinutes: 180, usedMinutes: 60, allocations: [{ serverId: 't1', title: 'Làm slide', minutes: 60 }] }],
  scenarios: [{ key: 'base', label: 'Cơ sở', dailyCapacityMinutes: 180, completedTasks: 1, atRiskTasks: 0, unscheduledTasks: 0, projectedFinishDate: '2026-09-28' }],
  insights: ['Có thể xếp hết công việc.']
}

describe('simulatePlan', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    localStorage.setItem('pwa-notes-token', 'jwt-demo')
  })

  it('gửi token, năng lực, kỳ mô phỏng và múi giờ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetchMock)
    const result = await simulatePlan({ dailyCapacityMinutes: 180, horizonDays: 14, goal: 'Ưu tiên demo' })
    expect(result.tasks[0].serverId).toBe('t1')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer jwt-demo')
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({ dailyCapacityMinutes: 180, horizonDays: 14, goal: 'Ưu tiên demo', timezoneOffsetMinutes: expect.any(Number) }))
  })

  it('giữ thông báo lỗi backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Năng lực không hợp lệ' }) }))
    await expect(simulatePlan({ dailyCapacityMinutes: 10, horizonDays: 14 })).rejects.toThrow('Năng lực không hợp lệ')
  })

  it('từ chối response thiếu cấu trúc kế hoạch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: [] }) }))
    await expect(simulatePlan({ dailyCapacityMinutes: 180, horizonDays: 14 })).rejects.toBeInstanceOf(PlannerError)
  })

  it('phân biệt khi người dùng hủy', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const controller = new AbortController()
    const promise = simulatePlan({ dailyCapacityMinutes: 180, horizonDays: 14 }, controller.signal)
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PlannerCancelled)
  })
})

