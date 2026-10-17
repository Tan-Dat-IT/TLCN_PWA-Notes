import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { PlannerCancelled, PlannerError, simulatePlan, type PlannedTask, type PlanningResult } from '../db/planner'

interface Props {
  onOpenTask?: (task: Pick<PlannedTask, 'serverId' | 'title'>) => void
}

const statusLabel = {
  overdue: 'Đang quá hạn',
  at_risk: 'Có nguy cơ trễ',
  on_track: 'Đúng tiến độ',
  planned: 'Đã xếp lịch'
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} phút`
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`
}

function formatDate(date: string | null) {
  if (!date) return 'Ngoài kỳ mô phỏng'
  return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')
}

export default function PlanningAssistant({ onOpenTask }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<AbortController | null>(null)
  const [dailyCapacityMinutes, setDailyCapacityMinutes] = useState(180)
  const [horizonDays, setHorizonDays] = useState(14)
  const [goal, setGoal] = useState('')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PlanningResult | null>(null)

  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [loading])
  useEffect(() => () => cancelRef.current?.abort(), [])

  function openDialog() {
    setError('')
    const element = dialog.current
    if (!element) return
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
  }

  function closeDialog() {
    cancelRef.current?.abort()
    const element = dialog.current
    if (!element) return
    if (typeof element.close === 'function') element.close()
    else element.removeAttribute('open')
  }

  async function handlePlan(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    const cancel = new AbortController()
    cancelRef.current = cancel
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await simulatePlan({ dailyCapacityMinutes, horizonDays, goal: goal.trim() }, cancel.signal))
    } catch (err) {
      if (!(err instanceof PlannerCancelled)) {
        setError(err instanceof PlannerError ? err.message : 'Không lập được kế hoạch. Vui lòng thử lại.')
      }
    } finally {
      if (cancelRef.current === cancel) cancelRef.current = null
      setLoading(false)
    }
  }

  return (
    <>
      <button type="button" className="project-info-button planning-button" onClick={openDialog}>
        <span aria-hidden="true">◫</span> Kế hoạch AI
      </button>
      <dialog ref={dialog} className="project-dialog planning-dialog" aria-labelledby="planning-title">
        <div className="project-dialog-header">
          <p className="eyebrow">AI LOCAL · MÔ PHỎNG KHÔNG THAY ĐỔI DỮ LIỆU</p>
          <button type="button" className="project-close" aria-label="Đóng kế hoạch AI" onClick={closeDialog}>✕</button>
        </div>
        <h2 id="planning-title">Lập kế hoạch và mô phỏng tiến độ</h2>
        <p className="project-description">AI ước lượng khối lượng và độ ưu tiên, thuật toán phân bổ công việc đã đồng bộ theo năng lực mỗi ngày. Kết quả chỉ là mô phỏng để bạn cân nhắc.</p>

        <form className="planning-form" onSubmit={handlePlan}>
          <label>Năng lực mỗi ngày (phút)
            <input aria-label="Năng lực mỗi ngày" type="number" min={30} max={720} step={15} required disabled={loading}
              value={dailyCapacityMinutes} onChange={event => setDailyCapacityMinutes(Number(event.target.value))} />
          </label>
          <label>Số ngày mô phỏng
            <input aria-label="Số ngày mô phỏng" type="number" min={1} max={60} required disabled={loading}
              value={horizonDays} onChange={event => setHorizonDays(Number(event.target.value))} />
          </label>
          <label className="planning-goal">Mục tiêu tùy chọn
            <input aria-label="Mục tiêu lập kế hoạch" maxLength={500} disabled={loading} value={goal}
              onChange={event => setGoal(event.target.value)} placeholder="Ví dụ: ưu tiên hoàn thành phần demo trước" />
          </label>
          {loading
            ? <button type="button" className="planning-cancel" onClick={() => cancelRef.current?.abort()}>Hủy</button>
            : <button type="submit">Mô phỏng tiến độ</button>}
        </form>
        {loading && <p className="planning-progress" role="status"><span className="ai-spinner" aria-hidden="true" /> Đang ước lượng và xếp lịch... {elapsed} giây</p>}
        {error && <p className="planning-error" role="alert">{error}</p>}

        {result && (
          <div className="planning-result" aria-live="polite">
            {result.warning && <p className="planning-warning">Ollama chưa dùng được ({result.warning}). Kế hoạch dưới đây dùng ước lượng dự phòng và vẫn được mô phỏng bằng thuật toán.</p>}
            {result.sourceTaskCount === 0 ? <p className="stats-empty">Không có công việc đang mở đã đồng bộ để lập kế hoạch.</p> : <>
              <div className="planning-summary">
                <div><span>Khối lượng</span><strong>{formatMinutes(result.totalEstimatedMinutes)}</strong></div>
                <div><span>Xếp hết trong kỳ</span><strong>{result.completedTasks}/{result.sourceTaskCount}</strong></div>
                <div><span>Cần chú ý</span><strong>{result.atRiskTasks}</strong></div>
                <div><span>Ngày hoàn tất dự kiến</span><strong>{formatDate(result.projectedFinishDate)}</strong></div>
              </div>

              <section className="planning-insights">
                <h3>Nhận định</h3>
                <ul>{result.insights.map(insight => <li key={insight}>{insight}</li>)}</ul>
              </section>

              <section>
                <h3>So sánh kịch bản năng lực</h3>
                <div className="planning-scenarios">{result.scenarios.map(scenario => (
                  <article key={scenario.key} className={scenario.key === 'base' ? 'base' : ''}>
                    <h4>{scenario.label}</h4>
                    <strong>{formatMinutes(scenario.dailyCapacityMinutes)}/ngày</strong>
                    <span>Hoàn tất {scenario.completedTasks}/{result.sourceTaskCount}</span>
                    <span>{scenario.atRiskTasks} việc cần chú ý</span>
                    <span>Xong: {formatDate(scenario.projectedFinishDate)}</span>
                  </article>
                ))}</div>
              </section>

              <section>
                <h3>Lịch làm việc đề xuất</h3>
                <div className="planning-days">{result.days.filter(day => day.allocations.length > 0).map(day => (
                  <article key={day.date}>
                    <header><strong>{formatDate(day.date)}</strong><span>{formatMinutes(day.usedMinutes)}/{formatMinutes(day.capacityMinutes)}</span></header>
                    <ul>{day.allocations.map((allocation, index) => <li key={`${allocation.serverId}-${index}`}><span>{allocation.title}</span><strong>{formatMinutes(allocation.minutes)}</strong></li>)}</ul>
                  </article>
                ))}</div>
              </section>

              <section>
                <h3>Ước lượng từng công việc <span>{result.aiUsed ? `bởi ${result.model}` : 'dự phòng bằng quy tắc'}</span></h3>
                <div className="planning-tasks">{result.tasks.map(task => (
                  <button type="button" key={task.serverId} className={`planning-task ${task.status}`} onClick={() => { onOpenTask?.(task); closeDialog() }}>
                    <span className="planning-task-main"><strong>{task.title}</strong><small>#{task.tag} · ưu tiên {task.priority}/5 · {formatMinutes(task.estimatedMinutes)}</small><span>{task.reason}</span></span>
                    <span className="planning-task-status">{statusLabel[task.status]}<small>{task.projectedFinishDate ? `Dự kiến ${formatDate(task.projectedFinishDate)}` : `Còn ${formatMinutes(task.unscheduledMinutes)}`}</small></span>
                  </button>
                ))}</div>
              </section>
            </>}
          </div>
        )}
      </dialog>
    </>
  )
}
