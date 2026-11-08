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

function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
function isEndDate(value: unknown) { return value === null || isDate(value) }

function isTask(value: unknown): value is PlannedTask {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.serverId === 'string' && typeof item.title === 'string' &&
    typeof item.tag === 'string' && (item.dueAt === null || (typeof item.dueAt === 'number' && Number.isFinite(item.dueAt))) &&
    isCount(item.estimatedMinutes) && isCount(item.priority) && item.priority >= 1 && item.priority <= 5 &&
    typeof item.reason === 'string' && statuses.has(item.status as PlanTaskStatus) &&
    isCount(item.scheduledMinutes) && isCount(item.unscheduledMinutes) && isEndDate(item.projectedFinishDate) &&
    Array.isArray(item.allocations) && item.allocations.every(allocation => allocation && isDate(allocation.date) && isCount(allocation.minutes))
}

function isScenario(value: unknown): value is PlanScenario {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (item.key === 'reduced' || item.key === 'base' || item.key === 'increased') &&
    typeof item.label === 'string' && isCount(item.dailyCapacityMinutes) &&
    isCount(item.completedTasks) && isCount(item.atRiskTasks) &&
    isCount(item.unscheduledTasks) && isEndDate(item.projectedFinishDate)
}

export function isPlanningResult(value: unknown): value is PlanningResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.generatedAt === 'number' && item.generatedAt > 0 && Number.isFinite(new Date(item.generatedAt).getTime()) &&
    isCount(item.sourceTaskCount) && typeof item.aiUsed === 'boolean' && (item.warning === null || typeof item.warning === 'string') &&
    isCount(item.dailyCapacityMinutes) && item.dailyCapacityMinutes >= 30 && item.dailyCapacityMinutes <= 720 &&
    isCount(item.horizonDays) && item.horizonDays >= 1 && item.horizonDays <= 60 && isCount(item.totalEstimatedMinutes) &&
    isCount(item.completedTasks) && isCount(item.atRiskTasks) && isCount(item.unscheduledTasks) &&
    isEndDate(item.projectedFinishDate) && typeof item.model === 'string' &&
    Array.isArray(item.tasks) && item.tasks.every(isTask) && Array.isArray(item.scenarios) && item.scenarios.every(isScenario) &&
    Array.isArray(item.days) && item.days.every(day => day && isDate(day.date) && isCount(day.capacityMinutes) && isCount(day.usedMinutes) &&
      Array.isArray(day.allocations) && day.allocations.every((allocation: Record<string, unknown> | null) => allocation && typeof allocation.serverId === 'string' && typeof allocation.title === 'string' && isCount(allocation.minutes))) &&
    Array.isArray(item.insights) && item.insights.every(insight => typeof insight === 'string')
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
  if (!isPlanningResult(body)) throw new PlannerError('Kế hoạch trả về thiếu dữ liệu hoặc có nội dung không hợp lệ.')
  return body
}
