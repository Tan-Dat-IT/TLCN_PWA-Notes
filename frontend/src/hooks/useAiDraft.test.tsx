import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiDraft } from './useAiDraft'
import { clearToken, setToken } from '../db/api'

const draft = { title: 'Bản nháp', content: '', tag: 'hoc-tap', kind: 'task', startAt: null, dueAt: null }
beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('AI request session ownership', () => {
  it('discards a previous account’s response after switching accounts', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
    const receive = vi.fn()
    const { result, rerender } = renderHook(({ accountKey }) => useAiDraft({ accountKey, text: 'Mô tả', existingTags: [], isOnline: true, onDraft: receive }), { initialProps: { accountKey: 'account-a' } })
    let request!: Promise<void>
    act(() => { request = result.current.generate() })
    rerender({ accountKey: 'account-b' })
    await act(async () => { resolve({ ok: true, json: async () => ({ draft }) }); await request })
    expect(receive).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('discards a result when the login token changes before completion', async () => {
    setToken('session-a')
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
    const receive = vi.fn()
    const { result } = renderHook(() => useAiDraft({ accountKey: 'a', text: 'Mô tả', existingTags: [], isOnline: true, onDraft: receive }))
    let request!: Promise<void>
    act(() => { request = result.current.generate() })
    clearToken()
    await act(async () => { resolve({ ok: true, json: async () => ({ draft }) }); await request })
    expect(receive).not.toHaveBeenCalled()
  })

  it('allows retry after cancellation without accepting the old late response', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolvers.push(done) })))
    const receive = vi.fn()
    const { result } = renderHook(() => useAiDraft({ accountKey: 'a', text: 'Mô tả', existingTags: [], isOnline: true, onDraft: receive }))
    let first!: Promise<void>, second!: Promise<void>
    act(() => { first = result.current.generate() })
    act(() => result.current.cancel())
    act(() => { second = result.current.generate() })
    await act(async () => { resolvers[0]({ ok: true, json: async () => ({ draft: { ...draft, title: 'Cũ' } }) }); await first })
    expect(result.current.loading).toBe(true)
    expect(receive).not.toHaveBeenCalled()
    await act(async () => { resolvers[1]({ ok: true, json: async () => ({ draft }) }); await second })
    expect(receive).toHaveBeenCalledExactlyOnceWith({ draft, warning: null })
  })
})
