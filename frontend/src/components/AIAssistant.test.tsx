import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AIAssistant from './AIAssistant'

function mockDraftFetchOnce(draft: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ draft })
  }))
}

const baseDraft = { title: 'Nộp báo cáo', content: '', tag: 'cong-viec', kind: 'task', startAt: null, dueAt: null }

describe('AIAssistant', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  // Hồi quy: trước đây bản nháp AI chỉ hiển thị tĩnh (xem/Áp dụng/Hủy), không
  // sửa được - nếu AI đoán sai tiêu đề/tag/ngày, người dùng phải Hủy rồi gõ
  // lại từ đầu prompt, hoặc lưu sai rồi sửa sau. Giờ bản nháp tái dùng
  // NoteForm nên phải sửa được trực tiếp trước khi lưu.
  it('cho phép sửa tiêu đề bản nháp AI trước khi Áp dụng, và gửi đúng giá trị đã sửa', async () => {
    mockDraftFetchOnce(baseDraft)
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(<AIAssistant onApply={onApply} />)

    fireEvent.change(screen.getByLabelText('Yêu cầu AI'), { target: { value: 'Nhắc tôi nộp báo cáo' } })
    fireEvent.click(screen.getByText('Tạo bằng AI'))

    const titleInput = await screen.findByDisplayValue('Nộp báo cáo')
    fireEvent.change(titleInput, { target: { value: 'Nộp báo cáo ĐÃ SỬA' } })
    fireEvent.click(screen.getByText('Áp dụng'))

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(onApply.mock.calls[0][0]).toMatchObject({ title: 'Nộp báo cáo ĐÃ SỬA', kind: 'task' })
  })

  it('bấm Hủy thì ẩn bản nháp, không gọi onApply', async () => {
    mockDraftFetchOnce(baseDraft)
    const onApply = vi.fn()
    render(<AIAssistant onApply={onApply} />)

    fireEvent.change(screen.getByLabelText('Yêu cầu AI'), { target: { value: 'Nhắc tôi nộp báo cáo' } })
    fireEvent.click(screen.getByText('Tạo bằng AI'))
    await screen.findByDisplayValue('Nộp báo cáo')

    fireEvent.click(screen.getByText('Hủy'))
    await waitFor(() => expect(screen.queryByDisplayValue('Nộp báo cáo')).toBeNull())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('lưu bản nháp thành công thì dọn ô nhập yêu cầu và bản nháp', async () => {
    mockDraftFetchOnce(baseDraft)
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(<AIAssistant onApply={onApply} />)

    const textarea = screen.getByLabelText('Yêu cầu AI') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Nhắc tôi nộp báo cáo' } })
    fireEvent.click(screen.getByText('Tạo bằng AI'))
    await screen.findByDisplayValue('Nộp báo cáo')

    fireEvent.click(screen.getByText('Áp dụng'))
    await waitFor(() => expect(screen.queryByDisplayValue('Nộp báo cáo')).toBeNull())
    expect(textarea.value).toBe('')
  })
})

describe('AIAssistant - chờ lâu, hủy, bản nháp dự phòng', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('AI lỗi/quá giờ: hiện bản nháp cơ bản kèm cảnh báo thay vì chỉ báo lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ draft: { ...baseDraft, tag: '' }, fallback: true, warning: 'Model AI local chưa trả lời sau 60 giây', code: 'timeout' })
    }))
    render(<AIAssistant onApply={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Yêu cầu AI'), { target: { value: 'Nhắc tôi nộp báo cáo' } })
    fireEvent.click(screen.getByText('Tạo bằng AI'))
    expect(await screen.findByDisplayValue('Nộp báo cáo')).toBeTruthy()
    expect(screen.getByText(/AI chưa dùng được lúc này \(Model AI local chưa trả lời sau 60 giây\)/)).toBeTruthy()
    expect(screen.getByText('Bản nháp cơ bản')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('đang chờ: hiện tiến trình + nút Hủy; bấm Hủy thì ngắt request, không báo lỗi, cho nhập lại', async () => {
    let receivedSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      if (String(url).endsWith('/ai/warmup')) return Promise.resolve({ ok: true, status: 202, json: async () => ({ ok: true }) })
      receivedSignal = init.signal ?? undefined
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }))
    render(<AIAssistant onApply={vi.fn()} />)
    const textarea = screen.getByLabelText('Yêu cầu AI') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Nhắc tôi nộp báo cáo' } })
    fireEvent.click(screen.getByText('Tạo bằng AI'))
    expect(await screen.findByText(/AI đang phân tích\.\.\. 0 giây/)).toBeTruthy()
    expect(textarea.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo bằng AI' })).toBeTruthy())
    expect(receivedSignal?.aborted).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(textarea.disabled).toBe(false)
    expect(textarea.value).toBe('Nhắc tôi nộp báo cáo')
  })

  it('bấm vào ô nhập thì nhờ backend nạp sẵn model (tối đa 1 lần/5 phút)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIAssistant onApply={vi.fn()} />)
    const textarea = screen.getByLabelText('Yêu cầu AI')
    fireEvent.focus(textarea)
    fireEvent.blur(textarea)
    fireEvent.focus(textarea)
    const warmups = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/ai/warmup'))
    expect(warmups.length).toBeLessThanOrEqual(1)
  })

  it('Ctrl+Enter trong ô nhập = bấm Tạo bằng AI', async () => {
    mockDraftFetchOnce(baseDraft)
    render(<AIAssistant onApply={vi.fn()} />)
    const textarea = screen.getByLabelText('Yêu cầu AI')
    fireEvent.change(textarea, { target: { value: 'Nhắc tôi nộp báo cáo' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByDisplayValue('Nộp báo cáo')).toBeTruthy()
  })
})
