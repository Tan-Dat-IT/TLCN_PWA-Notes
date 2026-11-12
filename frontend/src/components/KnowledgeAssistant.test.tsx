import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import KnowledgeAssistant from './KnowledgeAssistant'

const response = {
  answer: 'Bạn cần hoàn thiện slide [1].', indexed: 2, model: 'llama3.2', embeddingModel: 'embeddinggemma',
  sources: [{ number: 1, serverId: 'n1', title: 'Chuẩn bị bảo vệ', snippet: 'Luyện demo', tag: 'học tập', kind: 'task', updatedAt: 1, score: 0.92 }]
}

describe('KnowledgeAssistant', () => {
  beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('hiển thị câu trả lời, nguồn và mở đúng nguồn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    const onOpenSource = vi.fn()
    render(<KnowledgeAssistant onOpenSource={onOpenSource} />)
    fireEvent.change(screen.getByLabelText('Câu hỏi về ghi chú'), { target: { value: 'Tôi cần chuẩn bị gì?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tìm câu trả lời' }))
    expect(await screen.findByText('Bạn cần hoàn thiện slide [1].')).toBeTruthy()
    expect(screen.getByText('1 nội dung')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Chuẩn bị bảo vệ/ }))
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'n1' }))
  })

  it('hiển thị lỗi Ollama rõ ràng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Model embedding chưa được tải' }) }))
    render(<KnowledgeAssistant />)
    fireEvent.change(screen.getByLabelText('Câu hỏi về ghi chú'), { target: { value: 'Tìm nội dung' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tìm câu trả lời' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Model embedding chưa được tải')
  })

  it('Ctrl+Enter gửi câu hỏi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    render(<KnowledgeAssistant />)
    const input = screen.getByLabelText('Câu hỏi về ghi chú')
    fireEvent.change(input, { target: { value: 'Tìm nội dung' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.getByText('Bạn cần hoàn thiện slide [1].')).toBeTruthy())
  })

  it('cancels without showing a late answer and preserves the question', async () => {
    let aborted = false
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('cancelled', 'AbortError')) })
    })))
    render(<KnowledgeAssistant />)
    fireEvent.change(screen.getByLabelText('Câu hỏi về ghi chú'), { target: { value: 'Nội dung cần tra cứu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tìm câu trả lời' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hủy yêu cầu' }))
    await waitFor(() => expect(aborted).toBe(true))
    await screen.findByRole('button', { name: 'Tìm câu trả lời' })
    expect(screen.getByLabelText('Câu hỏi về ghi chú')).toHaveProperty('value', 'Nội dung cần tra cứu')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Câu trả lời' })).toBeNull()
  })

  it('disables lookup when offline', () => {
    render(<KnowledgeAssistant isOnline={false} />)
    fireEvent.change(screen.getByLabelText('Câu hỏi về ghi chú'), { target: { value: 'Tìm nội dung' } })
    expect(screen.getByRole('button', { name: 'Tìm câu trả lời' })).toHaveProperty('disabled', true)
  })
})
