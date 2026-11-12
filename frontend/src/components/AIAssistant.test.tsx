import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AIAssistant from './AIAssistant'
import { useState } from 'react'
import { useAiDraft } from '../hooks/useAiDraft'
import type { AiDraftResult } from '../db/ai'

function Assistant({ onDraft, isOnline = true }: { onDraft: (result: AiDraftResult) => void; isOnline?: boolean }) {
  const [text, setText] = useState('')
  const controller = useAiDraft({ accountKey: 'assistant-test', text, existingTags: [], isOnline, onDraft })
  return <AIAssistant text={text} onTextChange={setText} isOnline={isOnline} controller={controller} focusRequest={0} />
}

const draft = { title: 'Nộp báo cáo', content: '', tag: 'cong-viec', kind: 'task', startAt: null, dueAt: null }
function mockDraft(payload: unknown = { draft }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
function generate() {
  fireEvent.change(screen.getByLabelText('Yêu cầu AI'), { target: { value: 'Nhắc tôi nộp báo cáo' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mô tả' }))
}
beforeEach(() => { vi.unstubAllGlobals() })

describe('AI draft handoff', () => {
  it('returns an editable draft to its caller without rendering or saving a form', async () => {
    mockDraft()
    const onDraft = vi.fn()
    render(<Assistant onDraft={onDraft} />)
    generate()
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith({ draft, warning: null }))
    expect(screen.queryByLabelText('Tiêu đề')).toBeNull()
    expect(screen.getByLabelText('Yêu cầu AI')).toHaveProperty('value', 'Nhắc tôi nộp báo cáo')
  })

  it('preserves the backend fallback warning for the confirmation form', async () => {
    mockDraft({ draft, fallback: true, warning: 'Model chưa sẵn sàng', code: 'timeout' })
    const onDraft = vi.fn()
    render(<Assistant onDraft={onDraft} />)
    generate()
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith({ draft, warning: 'Model chưa sẵn sàng' }))
  })

  it('shows progress, aborts a cancelled request and retains the prompt for retry', async () => {
    let signal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }))
    const onDraft = vi.fn()
    render(<Assistant onDraft={onDraft} />)
    generate()
    expect(await screen.findByText(/Đang phân tích/)).toBeTruthy()
    expect(screen.getByLabelText('Yêu cầu AI')).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Hủy yêu cầu' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi mô tả' })).toBeTruthy())
    expect(signal?.aborted).toBe(true)
    expect(onDraft).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Yêu cầu AI')).toHaveProperty('value', 'Nhắc tôi nộp báo cáo')
  })

  it('aborts a pending request when its app controller unmounts', async () => {
    let signal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }))
    const { unmount } = render(<Assistant onDraft={vi.fn()} />)
    generate()
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('requests model warmup on focus at most once within five minutes', () => {
    const fetchMock = mockDraft()
    render(<Assistant onDraft={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Yêu cầu AI'))
    fireEvent.focus(screen.getByLabelText('Yêu cầu AI'))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/ai/warmup')).length).toBeLessThanOrEqual(1)
  })

  it('supports Ctrl+Enter and prevents duplicate generation', async () => {
    const fetchMock = mockDraft()
    const onDraft = vi.fn()
    render(<Assistant onDraft={onDraft} />)
    const input = screen.getByLabelText('Yêu cầu AI')
    fireEvent.change(input, { target: { value: 'Nhắc tôi nộp báo cáo' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onDraft).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/ai/draft'))).toHaveLength(1)
  })

  it('explains offline availability and does not call AI', () => {
    const fetchMock = mockDraft()
    render(<Assistant onDraft={vi.fn()} isOnline={false} />)
    generate()
    expect(screen.getByRole('button', { name: 'Gửi mô tả' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/AI cần kết nối máy chủ/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports network failure without losing the prompt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<Assistant onDraft={vi.fn()} />)
    generate()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Không kết nối được tới backend.')
    expect(screen.getByLabelText('Yêu cầu AI')).toHaveProperty('value', 'Nhắc tôi nộp báo cáo')
  })

  it('sends with Enter but preserves Shift+Enter and Vietnamese composition', async () => {
    const fetchMock = mockDraft()
    render(<Assistant onDraft={vi.fn()} />)
    const input = screen.getByLabelText('Yêu cầu AI')
    fireEvent.change(input, { target: { value: 'Nộp báo cáo' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/ai/draft'))).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/ai/draft'))).toHaveLength(1))
  })
})
