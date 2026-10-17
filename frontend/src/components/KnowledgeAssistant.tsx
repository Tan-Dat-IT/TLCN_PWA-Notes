import { useEffect, useRef, useState } from 'react'
import { askKnowledge, KnowledgeCancelled, KnowledgeError, type KnowledgeResult, type KnowledgeSource } from '../db/knowledge'

interface Props {
  onOpenSource?: (source: KnowledgeSource) => void
}

export default function KnowledgeAssistant({ onOpenSource }: Props) {
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
    if (text.length < 2 || loading) return
    const cancel = new AbortController()
    cancelRef.current = cancel
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await askKnowledge(text, cancel.signal))
    } catch (err) {
      if (!(err instanceof KnowledgeCancelled)) {
        setError(err instanceof KnowledgeError ? err.message : 'Không tra cứu được kho ghi chú. Vui lòng thử lại.')
      }
    } finally {
      if (cancelRef.current === cancel) cancelRef.current = null
      setLoading(false)
    }
  }

  return (
    <section className="knowledge-assistant" aria-label="Trợ lý tri thức">
      <div className="knowledge-heading">
        <span className="knowledge-badge" aria-hidden="true">⌕</span>
        <div>
          <h2>Hỏi kho tri thức <span className="ai-local-tag">AI Local · Có nguồn</span></h2>
          <p>Hỏi bằng ngôn ngữ tự nhiên. AI chỉ dùng các ghi chú đã đồng bộ của tài khoản này và hiển thị nguồn để bạn kiểm tra.</p>
        </div>
      </div>
      <div className="knowledge-row">
        <textarea
          aria-label="Câu hỏi kho tri thức" rows={2} maxLength={1000} disabled={loading}
          placeholder='Ví dụ: "Tôi còn phải chuẩn bị những gì cho buổi bảo vệ?"'
          value={question} onChange={event => setQuestion(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void handleAsk()
            }
          }}
        />
        {loading
          ? <button type="button" className="knowledge-cancel" onClick={() => cancelRef.current?.abort()}>Hủy</button>
          : <button type="button" onClick={() => void handleAsk()} disabled={question.trim().length < 2}>Hỏi AI</button>}
      </div>
      {loading && <p className="knowledge-progress" role="status"><span className="ai-spinner" aria-hidden="true" /> Đang tìm nguồn và tổng hợp... {elapsed} giây</p>}
      {error && <p className="knowledge-error" role="alert">{error}</p>}
      {result && (
        <div className="knowledge-result" aria-live="polite">
          <div className="knowledge-answer">
            <h3>Câu trả lời</h3>
            <p>{result.answer}</p>
          </div>
          <div className="knowledge-sources">
            <div className="knowledge-source-heading"><h3>Nguồn đã sử dụng</h3><span>{result.indexed} ghi chú được lập chỉ mục</span></div>
            {result.sources.length === 0
              ? <p className="knowledge-empty">Không có nguồn đủ liên quan.</p>
              : <ol>{result.sources.map(source => (
                <li key={source.serverId}>
                  <button type="button" onClick={() => onOpenSource?.(source)}>
                    <span className="source-number">[{source.number}]</span>
                    <span className="source-content"><strong>{source.title}</strong><small>#{source.tag} · liên quan {Math.round(source.score * 100)}%</small><span>{source.snippet}</span></span>
                  </button>
                </li>
              ))}</ol>}
          </div>
        </div>
      )}
    </section>
  )
}

