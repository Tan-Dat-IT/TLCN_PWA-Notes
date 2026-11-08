import { useLayoutEffect, useId, useRef } from 'react'
import { MessageSquarePlus, Minus, Sparkles } from 'lucide-react'
import AIAssistant from './AIAssistant'
import type { AiDraftController } from '../hooks/useAiDraft'

interface Props {
  open: boolean
  blocked: boolean
  text: string
  onTextChange: (value: string) => void
  isOnline: boolean
  controller: AiDraftController
  focusRequest: number
  onOpen: () => void
  onCollapse: () => void
  onManual: () => void
}

export default function AIChatBox({ open, blocked, onOpen, onCollapse, ...composer }: Props) {
  const id = useId()
  const launcher = useRef<HTMLButtonElement>(null)
  const visible = open && !blocked
  useLayoutEffect(() => {
    if (!visible) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : launcher.current
    return () => {
      if (!document.querySelector('dialog[open]')) (opener?.isConnected ? opener : launcher.current)?.focus({ preventScroll: true })
    }
  }, [visible])

  return <div className="ai-chat" hidden={blocked}>
    {visible && <section className="ai-chat-window" id={id} role="dialog" aria-labelledby={`${id}-title`}
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onCollapse() } }}>
      <header className="ai-chat-header"><span className="ai-chat-mark" aria-hidden="true"><Sparkles size={18} /></span><div><h2 id={`${id}-title`}>Tạo bằng AI</h2><p>Mô tả việc, kiểm tra rồi lưu</p></div><button type="button" className="quiet-icon" aria-label="Thu gọn chatbox" onClick={onCollapse}><Minus size={20} /></button></header>
      <AIAssistant {...composer} />
    </section>}
    <button ref={launcher} className="ai-chat-launcher" type="button" aria-label={open ? 'Thu gọn chatbox tạo bằng AI' : 'Mở chatbox tạo bằng AI'} aria-expanded={visible} aria-controls={visible ? id : undefined}
      onClick={open ? onCollapse : onOpen}>
      {composer.controller.loading ? <span className="ai-spinner" aria-hidden="true" /> : <MessageSquarePlus size={22} aria-hidden="true" />}<span>{composer.controller.loading ? 'Đang phân tích' : 'Tạo bằng AI'}</span>
    </button>
  </div>
}
