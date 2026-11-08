import { beforeEach, describe, expect, it, vi } from 'vitest'
import { draftFromText } from './ai'

const draft = { title: 'Công việc', content: '', tag: 'Học tập', kind: 'task', startAt: null, dueAt: null }
beforeEach(() => { vi.unstubAllGlobals() })

describe('AI draft client validation', () => {
  it.each(['', '   ', null])('fills a visible default for a missing tag (%s) without fabricating AI data', async tag => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ draft: { ...draft, tag } }) }))
    expect((await draftFromText('Mô tả')).draft.tag).toBe('chung')
  })
  it('preserves the supplied tag and replaces invalid timestamps with empty fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ draft: { ...draft, startAt: Infinity, dueAt: 1e30 } }) }))
    expect((await draftFromText('Mô tả')).draft).toMatchObject({ tag: 'Học tập', startAt: null, dueAt: null })
  })
})
