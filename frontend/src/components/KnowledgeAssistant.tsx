import { useEffect, useRef, useState } from 'react'
import { askKnowledge, KnowledgeCancelled, KnowledgeError, type KnowledgeResult, type KnowledgeSource } from '../db/knowledge'

interface Props {
  onOpenSource?: (source: KnowledgeSource) => void
  isOnline?: boolean
}

export default function KnowledgeAssistant({ onOpenSource, isOnline = true }: Props) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<KnowledgeResult | null>(null)
  const cancelRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [loading])

  useEffect(() => () => cancelRef.current?.abort(), [])

  async function handleAsk() {
    const text = question.trim()
    if (text.length < 2 || cancelRef.current || !isOnline) return
    const cancel = new AbortController()
    cancelRef.current = cancel
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const next = await askKnowledge(text, cancel.signal)
      if (!cancel.signal.aborted) setResult(next)
    } catch (err) {
      if (!(err instanceof KnowledgeCancelled) && !cancel.signal.aborted) {
        setError(err instanceof KnowledgeError ? err.message : 'Không tra cứu được kho ghi chú. Vui lòng thử lại.')
      }
    } finally {
      if (cancelRef.current === cancel) { cancelRef.current = null; setLoading(false) }
    }
  }

  return (
    <section className="knowledge-assistant" aria-label="Hỏi đáp ghi chú" aria-busy={loading}>
      <p className="knowledge-description">Đặt câu hỏi để tìm và tổng hợp thông tin từ ghi chú của bạn.</p>
      <div className="knowledge-row">
        <textarea
          aria-label="Câu hỏi về ghi chú" rows={4} maxLength={1000} disabled={loading}
          placeholder="Ví dụ: Cuộc họp nhóm đã thống nhất những việc gì?"
          value={question} onChange={event => setQuestion(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void handleAsk()
            }
          }}
        />
        {loading
          ? <button type="button" className="knowledge-cancel" onClick={() => cancelRef.current?.abort()}>Hủy yêu cầu</button>
          : <button type="button" onClick={() => void handleAsk()} disabled={question.trim().length < 2 || !isOnline}>Tìm câu trả lời</button>}
      </div>
      <p className="knowledge-scope">{isOnline ? 'Sử dụng ghi chú và công việc đã đồng bộ.' : 'Bạn đang offline. Kết nối lại để tra cứu ghi chú.'}</p>
      {loading && <p className="knowledge-progress" role="status"><span className="ai-spinner" aria-hidden="true" /> Đang tìm nội dung và tổng hợp câu trả lời… {elapsed} giây</p>}
      {error && <p className="knowledge-error" role="alert">{error}</p>}
      {result && (
        <div className="knowledge-result" aria-live="polite">
          <div className="knowledge-answer">
            <h3>Câu trả lời</h3>
            <p>{result.answer}</p>
          </div>
          <div className="knowledge-sources">
            <div className="knowledge-source-heading"><h3>Nội dung tham khảo</h3>{result.sources.length > 0 && <span>{result.sources.length} nội dung</span>}</div>
            {result.sources.length === 0
              ? <p className="knowledge-empty">Chưa tìm thấy nội dung đủ liên quan.</p>
              : <ol>{result.sources.map(source => (
                <li key={source.serverId}>
                  <button type="button" onClick={() => onOpenSource?.(source)}>
                    <span className="source-number">[{source.number}]</span>
                    <span className="source-content"><strong>{source.title}</strong><small>{source.kind === 'task' ? 'Công việc' : 'Ghi chú'}{source.tag && ` · #${source.tag}`}</small><span>{source.snippet}</span></span>
                  </button>
                </li>
              ))}</ol>}
          </div>
        </div>
      )}
    </section>
  )
}

