import { API_ROOT } from './api'
import { db } from './database'
import { isPlanningResult, type PlanningOptions, type PlanningResult } from './planner'

export interface SavedPlan {
  savedAt: number
  options: Required<PlanningOptions>
  result: PlanningResult
}

export class SavedPlanInvalid extends Error {}
export class PlanSessionChanged extends Error {}

// Reuse the existing metadata store. No database migration or note/API changes.
export function planningStorageKey(accountKey: string) {
  return `planning:latest:${JSON.stringify([new URL(API_ROOT, window.location.href).href, accountKey])}`
}

export async function loadSavedPlan(accountKey: string): Promise<SavedPlan | null> {
  const key = planningStorageKey(accountKey)
  const record = await db.meta.get(key)
  if (!record) return null
  let value: Record<string, unknown>
  try { value = JSON.parse(record.value) } catch { throw new SavedPlanInvalid() }
  if (!value || typeof value !== 'object' || value.version !== 1 || value.scope !== key ||
      typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || value.savedAt <= 0 ||
      !value.options || typeof value.options !== 'object' || !isPlanningResult(value.result)) throw new SavedPlanInvalid()
  const options = value.options as Record<string, unknown>
  if (typeof options.dailyCapacityMinutes !== 'number' || !Number.isInteger(options.dailyCapacityMinutes) || options.dailyCapacityMinutes < 30 || options.dailyCapacityMinutes > 720 ||
      typeof options.horizonDays !== 'number' || !Number.isInteger(options.horizonDays) || options.horizonDays < 1 || options.horizonDays > 60 ||
      typeof options.goal !== 'string' || options.goal.length > 500) throw new SavedPlanInvalid()
  return { savedAt: value.savedAt, options: options as unknown as Required<PlanningOptions>, result: value.result }
}

export async function savePlan(accountKey: string, plan: SavedPlan, isCurrent: () => boolean) {
  const key = planningStorageKey(accountKey)
  await db.transaction('rw', db.meta, async () => {
    if (!isCurrent()) throw new PlanSessionChanged()
    await db.meta.put({ key, value: JSON.stringify({ version: 1, scope: key, ...plan }) })
  })
}
