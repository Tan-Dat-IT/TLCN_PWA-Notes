import { API_ROOT, getToken } from './api'
import type { NoteInput } from './noteFields'

export class AiError extends Error {}
export class AiCancelled extends AiError {}

// Backend chờ model tối đa OLLAMA_TIMEOUT_MS (mặc định 60 giây) rồi tự trả bản
// nháp dự phòng - frontend chờ lâu hơn một chút để luôn nhận được phản hồi đó
// thay vì tự bỏ cuộc trước.
const CLIENT_TIMEOUT_MS = 75000

export interface AiDraftResult {
  draft: NoteInput
  // Có giá trị khi AI không dùng được (quá thời gian, Ollama chưa chạy...) và
  // backend trả bản nháp cơ bản dựng bằng quy tắc - hiển thị để người dùng biết.
  warning: string | null
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Gọi endpoint backend /api/ai/draft, chính backend mới nói chuyện với Ollama
// (model chạy local) - trình duyệt không bao giờ gọi thẳng ra ngoài.
// `signal`: người dùng bấm Hủy -> ngắt request, backend cũng dừng yêu cầu tới Ollama.
export async function draftFromText(text: string, existingTags: string[] = [], signal?: AbortSignal): Promise<AiDraftResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
  const onCancel = () => controller.abort()
  signal?.addEventListener('abort', onCancel)
  let response: Response
  try {
    response = await fetch(`${API_ROOT}/ai/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, existingTags }),
      signal: controller.signal, cache: 'no-store'
    })
  } catch {
    if (signal?.aborted) throw new AiCancelled('Đã hủy.')
    if (controller.signal.aborted) throw new AiError(`Máy chủ chưa phản hồi sau ${CLIENT_TIMEOUT_MS / 1000} giây. Kiểm tra backend còn chạy không rồi thử lại.`)
    throw new AiError('Không kết nối được tới backend.')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onCancel)
  }

  let body: unknown
  try { body = await response.json() } catch { throw new AiError('Phản hồi không phải JSON hợp lệ.') }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error : `Máy chủ trả lỗi HTTP ${response.status}.`
    throw new AiError(message)
  }

  const payload = body && typeof body === 'object' ? body as { draft?: unknown; warning?: unknown } : {}
  const draft = payload.draft
  if (!draft || typeof draft !== 'object') throw new AiError('Phản hồi AI thiếu dữ liệu bản nháp.')
  const d = draft as Record<string, unknown>
  if (typeof d.title !== 'string' || !d.title.trim()) throw new AiError('AI không xác định được tiêu đề từ yêu cầu.')
  return {
    draft: {
      title: d.title,
      content: typeof d.content === 'string' ? d.content : '',
      tag: typeof d.tag === 'string' ? d.tag : '',
      kind: d.kind === 'task' ? 'task' : 'note',
      startAt: typeof d.startAt === 'number' ? d.startAt : null,
      dueAt: typeof d.dueAt === 'number' ? d.dueAt : null
    },
    warning: typeof payload.warning === 'string' ? payload.warning : null
  }
}

// Nhờ backend nạp sẵn model vào RAM khi người dùng bắt đầu nhập yêu cầu (lần
// tạo bản nháp ngay sau đó nhanh hơn). Tối đa 1 lần/5 phút, không báo lỗi.
const WARMUP_INTERVAL_MS = 5 * 60 * 1000
let lastWarmUp = 0
export function warmUpAi(now = Date.now()) {
  if (now - lastWarmUp < WARMUP_INTERVAL_MS) return
  lastWarmUp = now
  void fetch(`${API_ROOT}/ai/warmup`, { method: 'POST', headers: authHeaders(), cache: 'no-store' }).catch(() => { lastWarmUp = 0 })
}
