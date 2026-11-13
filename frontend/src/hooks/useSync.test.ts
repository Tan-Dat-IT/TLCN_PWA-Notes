import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { clearLocalData } from '../db/database'
import { clearToken, setToken, SyncFailure } from '../db/api'
import { synchronize } from '../db/sync'
import { useSync } from './useSync'

vi.mock('../db/sync', () => ({ synchronize: vi.fn() }))

beforeEach(async () => {
  vi.mocked(synchronize).mockReset()
  await clearLocalData()
  setToken('tok-a')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => { vi.restoreAllMocks(); clearToken() })

describe('useSync khi đổi tài khoản', () => {
  it.each([true, false])('bỏ kết quả lượt cũ (thành công=%s), giữ trạng thái của phiên mới', async oldSuccess => {
    let finishOld!: () => void
    const oldRequest = new Promise<void>((resolve, reject) => {
      finishOld = () => oldSuccess ? resolve() : reject(new SyncFailure('Lỗi phiên cũ', false))
    })
    vi.mocked(synchronize).mockReturnValueOnce(oldRequest)
    if (oldSuccess) vi.mocked(synchronize).mockRejectedValueOnce(new SyncFailure('Lỗi phiên mới', false))
    else vi.mocked(synchronize).mockResolvedValueOnce()

    const { result, rerender } = renderHook(({ enabled }) => useSync(enabled), { initialProps: { enabled: true } })
    let oldWork!: Promise<void>
    act(() => { oldWork = result.current.syncNow() })
    clearToken()
    rerender({ enabled: false })
    await clearLocalData()
    setToken('tok-b')
    rerender({ enabled: true })
    await act(async () => { await result.current.syncNow() })
    const expectedStatus = oldSuccess ? 'error' : 'synced'
    const expectedMessage = oldSuccess ? 'Lỗi phiên mới' : ''
    expect(result.current.status).toBe(expectedStatus)

    await act(async () => { finishOld(); await oldWork })
    expect(result.current.status).toBe(expectedStatus)
    expect(result.current.errorMessage).toBe(expectedMessage)
  })
})
