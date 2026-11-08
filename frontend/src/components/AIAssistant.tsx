import { useEffect, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { warmUpAi } from '../db/ai'
import type { AiDraftController } from '../hooks/useAiDraft'

interface Props {
  text: string
  onTextChange: (text: string) => void
  isOnline: boolean
  focusRequest: number
  controller: AiDraftController
  onManual?: () => void
}

/** Composer only; the request belongs to App, not this visible surface. */
export default function AIAssistant({ text, onTextChange, isOnline, focusRequest, controller, onManual }: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { input.current?.focus({ preventScroll: true }) }, [focusRequest])
  return <section className="ai-assistant ai-chat-composer" aria-label="Mô tả để tạo nội dung">
    <p className="ai-chat-description">Bạn cần làm gì? Mô tả một công việc hoặc ghi chú, AI sẽ điền sẵn form để bạn kiểm tra.</p>
    <label className="sr-only" htmlFor="ai-description">Yêu cầu AI</label>
    <textarea id="ai-description" ref={input} aria-label="Yêu cầu AI" rows={4} maxLength={2000} disabled={controller.loading}
      placeholder="Ví dụ: Mai 5 giờ chiều nộp báo cáo chương 3, cần rà soát số liệu trước khi gửi."
      value={text} onChange={event => onTextChange(event.target.value)} onFocus={() => { if (isOnline) warmUpAi() }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void controller.generate() }
      }} />
    <div className="ai-chat-send-row"><span>{isOnline ? 'Enter để gửi · Shift+Enter xuống dòng' : 'AI cần kết nối máy chủ.'}</span>
      {controller.loading ? <button type="button" className="ai-chat-cancel" onClick={controller.cancel}>Hủy yêu cầu</button> : <button type="button" onClick={() => void controller.generate()} disabled={!text.trim() || !isOnline}>Gửi mô tả <ArrowUp size={17} aria-hidden="true" /></button>}
    </div>
    {controller.loading && <p className="ai-chat-progress" role="status"><span className="ai-spinner" aria-hidden="true" />Đang phân tích… {controller.elapsed} giây{controller.elapsed >= 8 && <span>Model có thể cần thêm thời gian.</span>}</p>}
    {controller.error && <p className="ai-chat-error" role="alert">{controller.error}</p>}
    {onManual && <footer className="ai-chat-footer"><button type="button" onClick={onManual}>Nhập thủ công</button></footer>}
  </section>
}
