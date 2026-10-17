import { API_ROOT, getToken } from './api'

export class PlannerError extends Error {}
export class PlannerCancelled extends PlannerError {}

export type PlanTaskStatus = 'overdue' | 'at_risk' | 'on_track' | 'planned'

export interface PlanAllocation { date: string; minutes: number }
export interface PlanDay {
  date: string
  capacityMinutes: number
  usedMinutes: number
  allocations: Array<{ serverId: string; title: string; minutes: number }>
}
export interface PlannedTask {
  serverId: string
  title: string
  tag: string
  dueAt: number | null
  estimatedMinutes: number
  priority: number
  reason: string
  status: PlanTaskStatus
  scheduledMinutes: number
  unscheduledMinutes: number
  projectedFinishDate: string | null
  allocations: PlanAllocation[]
}
export interface PlanScenario {
  key: 'reduced' | 'base' | 'increased'
  label: string
  dailyCapacityMinutes: number
  completedTasks: number
  atRiskTasks: number
  unscheduledTasks: number
  projectedFinishDate: string | null
}
export interface PlanningResult {
  generatedAt: number
  sourceTaskCount: number
  aiUsed: boolean
  warning: string | null
  dailyCapacityMinutes: number
  horizonDays: number
  totalEstimatedMinutes: number
  completedTasks: number
  atRiskTasks: number
  unscheduledTasks: number
  projectedFinishDate: string | null
  tasks: PlannedTask[]
  days: PlanDay[]
  scenarios: PlanScenario[]
  insights: string[]
  model: string
}

export interface PlanningOptions {
  dailyCapacityMinutes: number
  horizonDays: number
  goal?: string
}

const CLIENT_TIMEOUT_MS = 105000
const statuses = new Set<PlanTaskStatus>(['overdue', 'at_risk', 'on_track', 'planned'])

function isTask(value: unknown): value is PlannedTask {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.serverId === 'string' && typeof item.title === 'string' &&
    typeof item.tag === 'string' && (item.dueAt === null || typeof item.dueAt === 'number') &&
    typeof item.estimatedMinutes === 'number' && typeof item.priority === 'number' &&
    typeof item.reason === 'string' && statuses.has(item.status as PlanTaskStatus) &&
    typeof item.scheduledMinutes === 'number' && typeof item.unscheduledMinutes === 'number' &&
    (item.projectedFinishDate === null || typeof item.projectedFinishDate === 'string') && Array.isArray(item.allocations)
}

function isScenario(value: unknown): value is PlanScenario {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (item.key === 'reduced' || item.key === 'base' || item.key === 'increased') &&
    typeof item.label === 'string' && typeof item.dailyCapacityMinutes === 'number' &&
    typeof item.completedTasks === 'number' && typeof item.atRiskTasks === 'number' &&
    typeof item.unscheduledTasks === 'number' && (item.projectedFinishDate === null || typeof item.projectedFinishDate === 'string')
}

export async function simulatePlan(options: PlanningOptions, signal?: AbortSignal): Promise<PlanningResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
  const onCancel = () => controller.abort()
  signal?.addEventListener('abort', onCancel)
  const token = getToken()
  let response: Response
  try {
    response = await fetch(`${API_ROOT}/ai/planner/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...options, timezoneOffsetMinutes: new Date().getTimezoneOffset() }),
      signal: controller.signal,
      cache: 'no-store'
    })
  } catch {
    if (signal?.aborted) throw new PlannerCancelled('Đã hủy.')
    if (controller.signal.aborted) throw new PlannerError('Lập kế hoạch chưa phản hồi kịp. Hãy kiểm tra Ollama rồi thử lại.')
    throw new PlannerError('Không kết nối được tới backend.')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onCancel)
  }

  let body: unknown
  try { body = await response.json() } catch { throw new PlannerError('Phản hồi lập kế hoạch không phải JSON hợp lệ.') }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error : `Máy chủ trả lỗi HTTP ${response.status}.`
    throw new PlannerError(message)
  }
  if (!body || typeof body !== 'object') throw new PlannerError('Kế hoạch trả về không hợp lệ.')
  const value = body as Record<string, unknown>
  if (!Array.isArray(value.tasks) || !value.tasks.every(isTask) ||
      !Array.isArray(value.scenarios) || !value.scenarios.every(isScenario) ||
      !Array.isArray(value.days) || !Array.isArray(value.insights) || !value.insights.every(item => typeof item === 'string')) {
    throw new PlannerError('Kế hoạch thiếu công việc, kịch bản hoặc nhận định.')
  }
  return value as unknown as PlanningResult
}
