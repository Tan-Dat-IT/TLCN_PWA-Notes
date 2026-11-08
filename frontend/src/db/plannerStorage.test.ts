import { beforeEach, describe, expect, it } from 'vitest'
import { clearLocalData, db, getLocalDataRevision } from './database'
import { loadSavedPlan, PlanSessionChanged, planningStorageKey, SavedPlanInvalid, savePlan, type SavedPlan } from './plannerStorage'

const plan: SavedPlan = {
  savedAt: 100, options: { dailyCapacityMinutes: 180, horizonDays: 14, goal: 'Mục tiêu cá nhân' },
  result: { generatedAt: 99, sourceTaskCount: 0, aiUsed: false, warning: null, dailyCapacityMinutes: 180, horizonDays: 14,
    totalEstimatedMinutes: 0, completedTasks: 0, atRiskTasks: 0, unscheduledTasks: 0, projectedFinishDate: null,
    tasks: [], days: [], scenarios: [], insights: [], model: 'llama3.2' }
}

describe('saved planning proposals', () => {
  beforeEach(async () => { await db.meta.clear() })

  it('keeps proposals separate from sync metadata and clears them with the account cache on logout', async () => {
    await db.meta.put({ key: 'syncCursor', value: '42' })
    await savePlan('account-a', plan, () => true)
    expect(await loadSavedPlan('account-a')).toEqual(plan)
    expect(await loadSavedPlan('account-b')).toBeNull()
    expect(await db.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '42' })
    await clearLocalData()
    expect(await loadSavedPlan('account-a')).toBeNull()
  })

  it('rejects a late write after the account cache has been cleared', async () => {
    const revision = getLocalDataRevision()
    await clearLocalData()
    await expect(savePlan('account-a', plan, () => getLocalDataRevision() === revision)).rejects.toBeInstanceOf(PlanSessionChanged)
    expect(await loadSavedPlan('account-a')).toBeNull()
  })

  it.each([
    { version: 2 },
    { scope: planningStorageKey('another-account') },
    { savedAt: null },
    { options: { ...plan.options, horizonDays: 0 } },
    { options: { ...plan.options, dailyCapacityMinutes: '180' } },
    { options: { ...plan.options, goal: null } },
    { result: { ...plan.result, days: [null] } }
  ])('rejects invalid stored envelopes without deleting them silently', async invalid => {
    const record = { key: planningStorageKey('account-a'), value: JSON.stringify({ version: 1, scope: planningStorageKey('account-a'), ...plan, ...invalid }) }
    await db.meta.put(record)
    await expect(loadSavedPlan('account-a')).rejects.toBeInstanceOf(SavedPlanInvalid)
    expect(await db.meta.get(record.key)).toEqual(record)
  })
})
