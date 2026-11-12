import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askKnowledge, KnowledgeCancelled, KnowledgeError } from './knowledge'

describe('askKnowledge', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    localStorage.setItem('pwa-notes-token', 'jwt-demo')
  })

  it('gửi token/câu hỏi và đọc câu trả lời có nguồn', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Hoàn thiện slide [1].', indexed: 3, model: 'llama3.2', embeddingModel: 'embeddinggemma',
        sources: [{ number: 1, serverId: 'n1', title: 'Bảo vệ', snippet: 'Luyện demo', tag: 'học tập', kind: 'task', updatedAt: 1, score: 0.91 }]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await askKnowledge('Tôi cần làm gì?')
    expect(result.sources[0].serverId).toBe('n1')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer jwt-demo')
    expect(JSON.parse(init.body).question).toBe('Tôi cần làm gì?')
  })

  it('giữ thông báo lỗi backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Thiếu model embedding' }) }))
    await expect(askKnowledge('Tìm ghi chú')).rejects.toThrow('Thiếu model embedding')
  })

  it('từ chối response thiếu nguồn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'x' }) }))
    await expect(askKnowledge('Tìm ghi chú')).rejects.toBeInstanceOf(KnowledgeError)
  })

  it('phân biệt thao tác hủy của người dùng', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const controller = new AbortController()
    const promise = askKnowledge('Tìm ghi chú', controller.signal)
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(KnowledgeCancelled)
  })
})

