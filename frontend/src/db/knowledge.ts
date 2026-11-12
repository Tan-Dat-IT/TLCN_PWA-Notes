import { API_ROOT, getToken } from './api'

export class KnowledgeError extends Error {}
export class KnowledgeCancelled extends KnowledgeError {}

export interface KnowledgeSource {
  number: number
  serverId: string
  title: string
  snippet: string
  tag: string
  kind: 'note' | 'task'
  updatedAt: number
  score: number
}

export interface KnowledgeResult {
  answer: string
  sources: KnowledgeSource[]
  indexed: number
  model: string
  embeddingModel: string
}

const CLIENT_TIMEOUT_MS = 105000

function isSource(value: unknown): value is KnowledgeSource {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return Number.isInteger(item.number) && typeof item.serverId === 'string' &&
    typeof item.title === 'string' && typeof item.snippet === 'string' &&
    typeof item.tag === 'string' && (item.kind === 'note' || item.kind === 'task') &&
    typeof item.updatedAt === 'number' && typeof item.score === 'number'
}

export async function askKnowledge(question: string, signal?: AbortSignal): Promise<KnowledgeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
  const onCancel = () => controller.abort()
  signal?.addEventListener('abort', onCancel)
  const token = getToken()
  let response: Response
  try {
    response = await fetch(`${API_ROOT}/ai/knowledge/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ question, topK: 5 }),
      signal: controller.signal,
      cache: 'no-store'
    })
  } catch {
    if (signal?.aborted) throw new KnowledgeCancelled('Đã hủy.')
    if (controller.signal.aborted) throw new KnowledgeError('Trợ lý tri thức chưa phản hồi kịp. Hãy kiểm tra Ollama rồi thử lại.')
    throw new KnowledgeError('Không kết nối được tới backend.')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onCancel)
  }

  let body: unknown
  try { body = await response.json() } catch { throw new KnowledgeError('Phản hồi không phải JSON hợp lệ.') }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error : `Máy chủ trả lỗi HTTP ${response.status}.`
    throw new KnowledgeError(message)
  }
  if (!body || typeof body !== 'object') throw new KnowledgeError('Phản hồi trợ lý tri thức không hợp lệ.')
  const payload = body as Record<string, unknown>
  if (typeof payload.answer !== 'string' || !Array.isArray(payload.sources) || !payload.sources.every(isSource)) {
    throw new KnowledgeError('Phản hồi trợ lý tri thức thiếu câu trả lời hoặc nguồn.')
  }
  return {
    answer: payload.answer,
    sources: payload.sources,
    indexed: typeof payload.indexed === 'number' ? payload.indexed : 0,
    model: typeof payload.model === 'string' ? payload.model : '',
    embeddingModel: typeof payload.embeddingModel === 'string' ? payload.embeddingModel : ''
  }
}

