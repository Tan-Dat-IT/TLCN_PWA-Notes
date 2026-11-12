import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarRange, ChevronDown } from 'lucide-react'
import { PlannerCancelled, PlannerError, simulatePlan, type PlannedTask, type PlanningResult } from '../db/planner'
import { getToken } from '../db/api'
import { getLocalDataRevision } from '../db/database'
import { loadSavedPlan, savePlan, SavedPlanInvalid, PlanSessionChanged, type SavedPlan } from '../db/plannerStorage'

interface Props {
  accountKey: string
  active?: boolean
  isOnline?: boolean
  onOpenTask?: (task: Pick<PlannedTask, 'serverId' | 'title'>) => void
  onShowTasks?: () => void
}
const CAPACITIES = [30, 60, 90, 120, 180, 240, 360, 480, 720]
const RANGES = [7, 14, 30]
const statusLabel = { overdue: 'Đang quá hạn', at_risk: 'Có nguy cơ trễ', on_track: 'Dự kiến đúng hạn', planned: 'Đã xếp lịch' }
const scenarioLabel = { reduced: 'Ít thời gian hơn', base: 'Theo thời gian bạn chọn', increased: 'Nhiều thời gian hơn' }
function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return !hours ? `${rest} phút` : rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`
}
function formatDate(date: string | null) { return date ? new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN') : 'Chưa xếp hết' }

export default function PlanningAssistant(props: Props) {
  // An account change must also discard the previous account's in-memory plan.
  return <PlanningWorkspace key={props.accountKey} {...props} />
}

function PlanningWorkspace({ accountKey, active = true, isOnline = true, onOpenTask, onShowTasks }: Props) {
  const cancelRef = useRef<AbortController | null>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const lifecycle = useRef(0)
  const pendingSave = useRef<{ plan: SavedPlan; isCurrent: () => boolean } | null>(null)
  const [dailyCapacityMinutes, setDailyCapacityMinutes] = useState(180)
  const [horizonDays, setHorizonDays] = useState(14)
  const [customCapacity, setCustomCapacity] = useState(false)
  const [customRange, setCustomRange] = useState(false)
  const [goal, setGoal] = useState('')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<SavedPlan | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [restoreError, setRestoreError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const result: PlanningResult | null = snapshot?.result ?? null
  const plannedGoal = snapshot?.options.goal ?? ''
  const busy = loading || restoring

  function captureSession() {
    const token = getToken(), revision = getLocalDataRevision(), instance = lifecycle.current
    return () => lifecycle.current === instance && getToken() === token && getLocalDataRevision() === revision
  }

  useEffect(() => {
    lifecycle.current++
    const isCurrent = captureSession()
    setRestoring(true)
    setRestoreError('')
    void loadSavedPlan(accountKey).then(saved => {
      if (!isCurrent() || !saved) return
      setSnapshot(saved)
      setDailyCapacityMinutes(saved.options.dailyCapacityMinutes)
      setHorizonDays(saved.options.horizonDays)
      setCustomCapacity(!CAPACITIES.includes(saved.options.dailyCapacityMinutes))
      setCustomRange(!RANGES.includes(saved.options.horizonDays))
      setGoal(saved.options.goal)
      setSaveState('saved')
    }).catch(err => {
      if (isCurrent()) setRestoreError(err instanceof SavedPlanInvalid ? 'Bản kế hoạch đã lưu không đọc được. Bạn có thể tạo đề xuất mới.' : 'Chưa đọc được kế hoạch trên thiết bị. Thử đọc lại bản lưu hoặc tạo đề xuất mới.')
    }).finally(() => { if (isCurrent()) setRestoring(false) })
    return () => { lifecycle.current++; cancelRef.current?.abort() }
  }, [accountKey, restoreAttempt])

  async function persistPlan(pending: NonNullable<typeof pendingSave.current>) {
    const isCurrent = () => pendingSave.current === pending && pending.isCurrent()
    if (!isCurrent()) return
    setSaveState('saving')
    try {
      await savePlan(accountKey, pending.plan, isCurrent)
      if (isCurrent()) setSaveState('saved')
    } catch (err) {
      if (isCurrent() && !(err instanceof PlanSessionChanged)) setSaveState('error')
    }
  }
  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [loading])
  useEffect(() => { if (!active) cancelRef.current?.abort() }, [active])
  useEffect(() => { if (active && result) resultHeading.current?.focus({ preventScroll: true }) }, [active, result])

  async function handlePlan(event: FormEvent) {
    event.preventDefault()
    if (cancelRef.current || !isOnline || restoring) return
    if (!Number.isInteger(dailyCapacityMinutes) || dailyCapacityMinutes < 30 || dailyCapacityMinutes > 720 || !Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 60) {
      setError('Chọn từ 30 phút đến 12 giờ mỗi ngày và khoảng thời gian từ 1 đến 60 ngày.')
      return
    }
    const cancel = new AbortController()
    const sessionIsCurrent = captureSession()
    const isCurrent = () => sessionIsCurrent() && !cancel.signal.aborted
    const options = { dailyCapacityMinutes, horizonDays, goal: goal.trim() }
    cancelRef.current = cancel
    setLoading(true)
    setError('')
    try {
      const next = await simulatePlan(options, cancel.signal)
      if (isCurrent()) {
        const plan = { savedAt: Date.now(), options, result: next }
        setSnapshot(plan)
        setRestoreError('')
        // Persistence follows the session, not the finished HTTP request's controller.
        const pending = { plan, isCurrent: sessionIsCurrent }
        pendingSave.current = pending
        void persistPlan(pending)
      }
    } catch (err) {
      if (!(err instanceof PlannerCancelled) && isCurrent()) setError(err instanceof PlannerError ? err.message : 'Chưa tạo được kế hoạch. Bạn hãy thử lại.')
    } finally {
      if (cancelRef.current === cancel) { cancelRef.current = null; setLoading(false) }
    }
  }
  const scheduledDays = result?.days.filter(day => day.allocations.length > 0) ?? []
  const changed = result && (result.dailyCapacityMinutes !== dailyCapacityMinutes || result.horizonDays !== horizonDays || plannedGoal !== goal.trim())
  return <section className="planning-page" aria-label="Gợi ý kế hoạch" hidden={!active} aria-busy={busy}>
    <form className="planning-form" aria-label="Tùy chọn kế hoạch" onSubmit={handlePlan}>
      <div className="planning-field"><label>Thời gian dành mỗi ngày
        <select value={customCapacity ? 'custom' : dailyCapacityMinutes} disabled={busy} onChange={event => { setCustomCapacity(event.target.value === 'custom'); if (event.target.value !== 'custom') setDailyCapacityMinutes(Number(event.target.value)) }}>
          {CAPACITIES.map(minutes => <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>)}<option value="custom">Tùy chọn…</option>
        </select></label>
        {customCapacity && <label className="planning-custom">Số phút mỗi ngày<input type="number" min={30} max={720} step={15} required disabled={busy} value={dailyCapacityMinutes} onChange={event => setDailyCapacityMinutes(Number(event.target.value))} /></label>}
      </div>
      <div className="planning-field"><label>Khoảng thời gian
        <select value={customRange ? 'custom' : horizonDays} disabled={busy} onChange={event => { setCustomRange(event.target.value === 'custom'); if (event.target.value !== 'custom') setHorizonDays(Number(event.target.value)) }}>
          {RANGES.map(days => <option key={days} value={days}>{days} ngày tới</option>)}<option value="custom">Tùy chọn…</option>
        </select></label>
        {customRange && <label className="planning-custom">Số ngày lên kế hoạch<input type="number" min={1} max={60} required disabled={busy} value={horizonDays} onChange={event => setHorizonDays(Number(event.target.value))} /></label>}
      </div>
      <label className="planning-goal">Bạn muốn ưu tiên việc gì? <span>(không bắt buộc)</span><input aria-label="Ưu tiên cho kế hoạch" maxLength={500} disabled={busy} value={goal} onChange={event => setGoal(event.target.value)} placeholder="Ví dụ: Hoàn thành báo cáo trước cuối tuần" /></label>
      {loading ? <button type="button" className="planning-cancel" onClick={() => cancelRef.current?.abort()}>Hủy yêu cầu</button> : <button type="submit" disabled={!isOnline || restoring}>Gợi ý kế hoạch</button>}
    </form>
    <p className="planning-scope">{isOnline ? 'Sử dụng các công việc chưa hoàn thành đã đồng bộ. Tự lưu bản đề xuất gần nhất trên thiết bị này.' : result ? 'Bạn đang offline. Có thể xem kế hoạch đã lưu; kết nối lại để nhận gợi ý mới.' : 'Bạn đang offline. Kết nối lại để nhận gợi ý kế hoạch.'}</p>
    {restoring && <p className="planning-progress" role="status">Đang đọc kế hoạch đã lưu…</p>}
    {restoreError && <div className="planning-error" role="alert"><span>{restoreError}</span><button type="button" className="planning-storage-retry" disabled={busy} onClick={() => setRestoreAttempt(attempt => attempt + 1)}>Đọc lại bản lưu</button></div>}
    {loading && <p className="planning-progress" role="status"><span className="ai-spinner" aria-hidden="true" /> Đang ước lượng thời gian và sắp xếp công việc… {elapsed} giây</p>}
    {error && <p className="planning-error" role="alert">{error}</p>}
    {!result && !busy && !error && !restoreError && <div className="planning-empty"><CalendarRange size={28} aria-hidden="true" /><h2>Chưa có kế hoạch</h2><p>Chọn thời gian bạn có để nhận lịch làm việc đề xuất.</p></div>}
    {result && <div className="planning-result" aria-live="polite">
      <div className="planning-save-status"><p>Tạo lúc <time dateTime={new Date(result.generatedAt).toISOString()}>{new Date(result.generatedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</time><span role="status">{saveState === 'saved' ? 'Đã lưu trên thiết bị này' : saveState === 'saving' ? 'Đang lưu kế hoạch…' : ''}</span></p></div>
      {saveState === 'error' && <div className="planning-error planning-save-error" role="alert"><span>Chưa lưu được kế hoạch trên thiết bị. Bản mới chỉ còn trong trang này; bản lưu trước đó (nếu có) vẫn được giữ.</span><button type="button" className="planning-storage-retry" onClick={() => { if (pendingSave.current) void persistPlan(pendingSave.current) }}>Thử lưu lại</button></div>}
      {changed && <p className="planning-warning" role="status">Bạn đã thay đổi lựa chọn. Bấm “Gợi ý kế hoạch” để cập nhật lịch.</p>}
      {result.warning && <p className="planning-warning" role="status">AI chưa phản hồi ({result.warning}). Kế hoạch này dùng thời lượng ước tính bằng quy tắc; bạn hãy kiểm tra lại.</p>}
      {result.sourceTaskCount === 0 ? <div className="planning-empty"><CalendarRange size={28} aria-hidden="true" /><h2 ref={resultHeading} tabIndex={-1}>Chưa có công việc để lên lịch</h2><p>Cần có công việc chưa hoàn thành đã đồng bộ để nhận gợi ý.</p>{onShowTasks && <button className="secondary-action" onClick={onShowTasks}>Xem công việc</button>}</div> : <>
        <section className="planning-schedule" aria-labelledby="plan-schedule-title">
          <div className="planning-result-heading"><div><h2 id="plan-schedule-title" ref={resultHeading} tabIndex={-1}>Lịch đề xuất</h2><p>{result.sourceTaskCount} công việc · {result.horizonDays} ngày · {formatMinutes(result.dailyCapacityMinutes)}/ngày</p></div>{result.atRiskTasks > 0 && <span className="planning-risk">{result.atRiskTasks} việc cần chú ý</span>}</div>
          {scheduledDays.length === 0 ? <p className="planning-scope">Chưa xếp được công việc trong khoảng đã chọn. Bạn có thể thử mở rộng khoảng thời gian.</p> : <div className="planning-days">{scheduledDays.map(day => <article key={day.date}>
            <header><strong>{formatDate(day.date)}</strong><span>{formatMinutes(day.usedMinutes)} / {formatMinutes(day.capacityMinutes)}</span></header>
            <ul>{day.allocations.map((allocation, index) => <li key={`${allocation.serverId}-${index}`}><button type="button" onClick={() => onOpenTask?.(allocation)}><span>{allocation.title}</span><strong>{formatMinutes(allocation.minutes)}</strong></button></li>)}</ul>
          </article>)}</div>}
        </section>
        <div className="planning-summary"><div><span>Tổng thời gian ước tính</span><strong>{formatMinutes(result.totalEstimatedMinutes)}</strong></div><div><span>Việc đã xếp đủ thời gian</span><strong>{result.completedTasks}/{result.sourceTaskCount}</strong></div><div><span>Việc cần chú ý</span><strong>{result.atRiskTasks}</strong></div><div><span>Dự kiến hoàn tất</span><strong>{formatDate(result.projectedFinishDate)}</strong></div></div>
        <section className="planning-insights"><h2>Lưu ý cho kế hoạch</h2><ul>{result.insights.map(insight => <li key={insight}>{insight}</li>)}</ul></section>
        <details className="planning-disclosure"><summary>Chi tiết công việc và ước lượng <ChevronDown size={16} aria-hidden="true" /></summary><div className="planning-tasks">{result.tasks.map(task => <button type="button" key={task.serverId} className={`planning-task ${task.status}`} onClick={() => onOpenTask?.(task)}>
          <span className="planning-task-main"><strong>{task.title}</strong><small>{task.tag && `#${task.tag} · `}{formatMinutes(task.estimatedMinutes)} · mức ưu tiên {task.priority}/5</small><span>{task.reason}</span></span><span className="planning-task-status">{statusLabel[task.status]}<small>{task.projectedFinishDate ? `Dự kiến ${formatDate(task.projectedFinishDate)}` : `Còn ${formatMinutes(task.unscheduledMinutes)} chưa xếp`}</small></span>
        </button>)}</div></details>
        <details className="planning-disclosure"><summary>So sánh phương án <ChevronDown size={16} aria-hidden="true" /></summary><p className="planning-scope">Xem lịch thay đổi thế nào khi bạn dành ít hoặc nhiều thời gian hơn mỗi ngày.</p><div className="planning-scenarios">{result.scenarios.map(scenario => <article key={scenario.key} className={scenario.key === 'base' ? 'base' : ''}>
          <h3>{scenarioLabel[scenario.key]}</h3><strong>{formatMinutes(scenario.dailyCapacityMinutes)}/ngày</strong><span>Xếp đủ thời gian cho {scenario.completedTasks}/{result.sourceTaskCount} việc</span><span>{scenario.atRiskTasks} việc cần chú ý</span><span>Dự kiến xong: {formatDate(scenario.projectedFinishDate)}</span>
        </article>)}</div></details>
        <p className="planning-footnote">Thời lượng là ước lượng. Tạo lại đề xuất khi công việc thay đổi. Bản lưu chỉ có trên thiết bị này, được dọn khi đăng xuất và không tự thay đổi công việc.</p>
      </>}
    </div>}
  </section>
}
