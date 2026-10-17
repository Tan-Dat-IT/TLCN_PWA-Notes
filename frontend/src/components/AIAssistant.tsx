import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { draftFromText, warmUpAi, AiError, AiCancelled } from '../db/ai'
import type { NoteInput } from '../db/noteFields'
import NoteForm from './NoteForm'

interface Props {
  onApply: (input: NoteInput) => Promise<void>
}

export default function AIAssistant({ onApply }: Props) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [draft, setDraft] = useState<NoteInput | null>(null)
  const cancelRef = useRef<AbortController | null>(null)
  // Lấy trên toàn bộ ghi chú chưa xóa, không phụ thuộc mục/tag đang lọc ở
  // giao diện, để AI luôn thấy đủ tag đã dùng và ưu tiên tái sử dụng.
  const existingTags = useLiveQuery(async () => {
    const notes = await db.notes.where('deleted').equals(0).toArray()
    return Array.from(new Set(notes.map(n => n.tag).filter(Boolean))).sort()
  }, []) ?? []

  // Đếm giây trong lúc chờ: model chạy CPU có thể mất vài chục giây, người
  // dùng cần thấy ứng dụng vẫn đang làm việc chứ không bị treo.
  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [loading])

  // Rời trang/đóng component khi đang chờ thì hủy luôn yêu cầu.
  useEffect(() => () => cancelRef.current?.abort(), [])

  async function handleGenerate() {
    if (!text.trim() || loading) return
    const cancel = new AbortController()
    cancelRef.current = cancel
    setLoading(true)
    setError('')
    setWarning('')
    setDraft(null)
    try {
      const result = await draftFromText(text.trim(), existingTags, cancel.signal)
      setDraft(result.draft)
      if (result.warning) setWarning(result.warning)
    } catch (err) {
      if (!(err instanceof AiCancelled)) setError(err instanceof AiError ? err.message : 'Không tạo được bản nháp. Vui lòng thử lại.')
    } finally {
      if (cancelRef.current === cancel) cancelRef.current = null
      setLoading(false)
    }
  }

  // Lỗi lưu thất bại được NoteForm tự bắt và hiển thị (giống lúc sửa ghi chú
  // thường) - ở đây chỉ dọn state của AIAssistant khi lưu THÀNH CÔNG.
  async function handleApply(input: NoteInput) {
    await onApply(input)
    setDraft(null)
    setWarning('')
    setText('')
  }

  return (
    <section className="ai-assistant" aria-label="Trợ lý AI">
      <div className="ai-assistant-heading">
        <span className="ai-badge" aria-hidden="true">✨</span>
        <div>
          <h2>Trợ lý AI <span className="ai-local-tag">AI Local</span></h2>
          <p>Mô tả việc cần làm bằng lời tự nhiên - AI tự điền tiêu đề, tag, ngày giờ và bạn có thể chỉnh sửa trước khi lưu.</p>
        </div>
      </div>
      <div className="ai-assistant-row">
        <textarea
          aria-label="Yêu cầu AI" rows={2} maxLength={2000} disabled={loading}
          placeholder='Ví dụ: "Nhắc tôi nộp báo cáo lúc 5 giờ chiều thứ 6 này"'
          value={text} onChange={e => setText(e.target.value)} onFocus={() => warmUpAi()}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void handleGenerate() } }}
        />
        {loading
          ? <button type="button" className="ai-cancel" onClick={() => cancelRef.current?.abort()}>Hủy</button>
          : <button type="button" onClick={() => void handleGenerate()} disabled={!text.trim()}>Tạo bằng AI</button>}
      </div>
      {loading && (
        <p className="ai-progress" role="status">
          <span className="ai-spinner" aria-hidden="true" /> AI đang phân tích... {elapsed} giây
          {elapsed >= 8 && <span className="ai-progress-hint"> - model chạy trên CPU nên có thể mất 10-30 giây, quá lâu sẽ tự tạo bản nháp cơ bản.</span>}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {draft && (
        <div className="ai-draft" aria-live="polite">
          {warning
            ? <p className="ai-draft-warning" role="status">AI chưa dùng được lúc này ({warning}) - đây là bản nháp cơ bản tạo từ câu bạn nhập, hãy kiểm tra lại tiêu đề và thời gian.</p>
            : <p className="ai-draft-hint">Bản nháp AI - chưa được lưu. Kiểm tra, chỉnh sửa nếu cần rồi bấm Áp dụng.</p>}
          <NoteForm
            initial={draft}
            onAdd={handleApply}
            onCancel={() => { setDraft(null); setWarning('') }}
            submitLabel="Áp dụng"
            heading={{ title: warning ? 'Bản nháp cơ bản' : 'Bản nháp AI đề xuất', description: 'Sửa trực tiếp bất kỳ trường nào trước khi lưu.' }}
          />
        </div>
      )}
    </section>
  )
}
