import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => { vi.restoreAllMocks() })

  it('restores the latest proposal and custom options after closing and reopening IndexedDB', async () => {
    await savePlan('account-a', plan, () => true)
    const latest: SavedPlan = {
      savedAt: 200,
      options: { dailyCapacityMinutes: 135, horizonDays: 5, goal: 'Ưu tiên báo cáo tuần 9' },
      result: { ...plan.result, generatedAt: 199, dailyCapacityMinutes: 135, horizonDays: 5, insights: ['Dành buổi sáng cho báo cáo.'] }
    }
    await savePlan('account-a', latest, () => true)

    db.close()
    await db.open()

    expect(await loadSavedPlan('account-a')).toEqual(latest)
    expect(await db.meta.count()).toBe(1)
  })

  it('preserves both accounts\' saved proposals and sync metadata after reopening IndexedDB', async () => {
    const otherPlan: SavedPlan = {
      ...plan,
      options: { ...plan.options, goal: 'Kế hoạch tài khoản B' },
      result: { ...plan.result, insights: ['Lịch riêng của tài khoản B.'] }
    }
    await db.meta.put({ key: 'syncCursor', value: '42' })
    await savePlan('account-a', plan, () => true)
    await savePlan('account-b', otherPlan, () => true)

    db.close()
    await db.open()

    expect(await loadSavedPlan('account-a')).toEqual(plan)
    expect(await loadSavedPlan('account-b')).toEqual(otherPlan)
    expect(await db.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '42' })
  })

  it('rolls back an interrupted replacement and restores the previous proposal after reopening IndexedDB', async () => {
    await savePlan('account-a', plan, () => true)
    const write = db.meta.put.bind(db.meta)
    const storageError = new DOMException('Storage write interrupted', 'AbortError')
    // Fail after the replacement write, before the transaction commits.
    vi.spyOn(db.meta, 'put').mockImplementationOnce(record => write(record).then(() => { throw storageError }))

    await expect(savePlan('account-a', {
      ...plan, savedAt: 200, result: { ...plan.result, insights: ['Bản chưa lưu xong.'] }
    }, () => true)).rejects.toThrow('Storage write interrupted')

    db.close()
    await db.open()

    expect(await loadSavedPlan('account-a')).toEqual(plan)
  })

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
