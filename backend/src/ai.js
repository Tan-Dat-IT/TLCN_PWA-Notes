import './env.js'
import { parseSchedule, fallbackTitle, fold, splitRequest, suggestTag, stripTimePhrases } from './viDate.js'
// Trợ lý AI chạy hoàn toàn local qua Ollama (https://ollama.com) - không gọi
// bất kỳ API đám mây nào. Yêu cầu `ollama serve` đang chạy và đã `ollama pull`
// model cấu hình qua OLLAMA_MODEL trước khi dùng tính năng này.
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2'
// Máy không có GPU chạy model bằng CPU: một lượt có thể mất 10-30 giây, lần
// đầu còn cộng thời gian nạp model vào RAM. Chỉnh qua OLLAMA_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) > 0 ? Number(process.env.OLLAMA_TIMEOUT_MS) : 60000
// Giữ model trong RAM sau mỗi lần dùng (mặc định của Ollama chỉ 5 phút, hết
// hạn thì lần sau phải nạp lại từ đầu - chậm thêm nhiều giây).
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m'
// Tham số sinh: temperature 0 cho kết quả ổn định; giới hạn số token sinh ra
// (JSON bản nháp chỉ cần ~100 token) và cửa sổ ngữ cảnh nhỏ để chạy nhanh hơn trên CPU.
const GENERATE_OPTIONS = { temperature: 0, num_predict: 200, num_ctx: 2048 }

export class AiFailure extends Error {
  constructor(message, code) { super(message); this.name = 'AiFailure'; this.code = code }
}

// Prompt ngắn gọn: trên CPU, thời gian đọc prompt tỉ lệ với số token (bản cũ
// ~560 token mất ~10 giây chỉ để đọc). Khi code đã tự tìm được ngày giờ
// (viDate.js) thì không hỏi model về ngày giờ nữa - câu trả lời ngắn hơn và
// không bị model đọc sai giờ.
export function buildPrompt(text, now, existingTags, askDue) {
  const today = new Date(now)
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const weekday = today.toLocaleDateString('vi-VN', { weekday: 'long' })
  const tagHint = existingTags.length ? `\nTag đã có (ưu tiên dùng lại y nguyên nếu phù hợp): ${existingTags.join(', ')}.` : ''
  const dueHint = askDue ? `\n- dueAt: hạn/thời điểm dạng "YYYY-MM-DD HH:mm" (giờ 24h, tự quy đổi "ngày mai", "thứ 6"... dựa trên hôm nay), null nếu không nhắc tới.` : ''
  return `Chuyển yêu cầu tiếng Việt thành ghi chú dạng JSON. Hôm nay: ${weekday}, ${todayIso}.
Yêu cầu: "${text.replace(/"/g, "'")}"${tagHint}
- title: hành động/nội dung chính, ngắn gọn (vd "Nộp báo cáo", tối đa 80 ký tự), KHÔNG chứa ngày giờ, bỏ "nhắc tôi", "nhớ", nhưng GIỮ NGUYÊN chi tiết cụ thể (số lượng, mã, tên riêng).
- content: chi tiết người dùng nêu thêm ngoài tiêu đề (vd nội dung báo cáo, địa điểm, người cần gặp), KHÔNG lặp ngày giờ; rỗng nếu không có.
- tag: BẮT BUỘC một từ khóa phân loại tiếng Việt có dấu, vd "học tập", "công việc", "tài chính", "mua sắm", "sức khỏe", "gia đình", "cá nhân".
- kind: "task" nếu là việc cần làm, "note" nếu chỉ là thông tin ghi nhớ.${dueHint}`
}

// JSON schema cho "structured output" của Ollama: model bị ép sinh đúng cấu
// trúc này, không lan man thêm chữ ngoài JSON.
function responseSchema(askDue) {
  const properties = {
    title: { type: 'string' }, content: { type: 'string' }, tag: { type: 'string' },
    kind: { type: 'string', enum: ['task', 'note'] }
  }
  if (askDue) properties.dueAt = { type: ['string', 'null'] }
  return { type: 'object', properties, required: Object.keys(properties) }
}

// Model local (đặc biệt bản nhỏ) không làm phép tính epoch millisecond chính
// xác được nếu tự yêu cầu nó tính - hay trả về rỗng hoặc số sai. Nên chỉ nhờ
// model viết lại ngày dạng "YYYY-MM-DD[ HH:mm]" (việc nó làm tốt hơn nhiều so
// với tính toán), còn việc chuyển sang epoch làm bằng code ở đây cho chính xác.
function coerceTimestamp(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Phòng trường hợp model vẫn trả số epoch dạng chuỗi
  if (/^\d{10,}$/.test(trimmed)) {
    const n = Number(trimmed)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  // new Date(năm, tháng, ngày, ...) hiểu theo giờ địa phương của máy backend -
  // khớp với cách app dùng epoch cho giờ thiết bị ở khắp nơi khác trong hệ thống.
  const date = new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 0, mi ? Number(mi) : 0, 0, 0)
  const time = date.getTime()
  return Number.isFinite(time) && time > 0 ? time : null
}

// Model local (đặc biệt bản nhỏ) không đáng tin cậy khi tự bỏ dấu tiếng Việt
// thành slug - hay bịa ra chuỗi vô nghĩa. Nên để model trả tag tiếng Việt có
// dấu bình thường (việc nó làm tốt), còn việc bỏ dấu/tạo slug làm bằng thuật
// toán xác định ở đây.
function slugifyTag(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

// Mỗi lần gọi AI là một request độc lập, model không nhớ đã dùng tag nào ở
// lần trước nên hay bịa tag mới cho những ghi chú cùng chủ đề. So khớp bản
// đã bỏ dấu của tag model chọn với bản đã bỏ dấu của từng tag hiện có; nếu
// trùng, dùng lại NGUYÊN VĂN tag hiện có (giữ đúng tag đã dùng trong các ghi
// chú khác) thay vì tạo thêm một biến thể mới cho cùng một khái niệm.
function reuseExistingTag(rawTag, existingTags) {
  const slug = slugifyTag(rawTag)
  if (!slug) return ''
  const matched = existingTags.find(existing => slugifyTag(existing) === slug)
  return matched ?? slug
}

function extractJson(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new AiFailure('Model AI trả về nội dung không phải JSON.', 'bad_response')
  try { return JSON.parse(raw.slice(start, end + 1)) }
  catch { throw new AiFailure('Không đọc được JSON từ model AI.', 'bad_response') }
}

// Câu có từ/số gợi ý thời gian không (để quyết định có hỏi model về hạn không).
function hasTimeCue(text) {
  // Không tính chữ số đơn lẻ ("mua 2 hộp sữa"): ngày/giờ dạng số đã do viDate.js xử lý.
  return /\b(?:gio|phut|sang|trua|chieu|toi|dem|nay|mai|mot|kia|tuan|thang|nam|thu|chu nhat|cuoi|dau|giua|hom|ngay|han|deadline|truoc|sau)\b/.test(fold(text.normalize('NFC')))
}

// Model nhỏ hay chép lại câu yêu cầu kèm ngày giờ vào content ("Vào 5h chiều
// thứ 6 ngày 25/09/2026") dù đã dặn không. Ngày giờ đã nằm ở dueAt nên chỉ CẮT
// các cụm ngày giờ đó đi (giữ phần chi tiết thật); còn lại rỗng hoặc chỉ lặp
// đúng tiêu đề thì bỏ.
function removeSchedulePhrases(value, text, schedule) {
  let out = value.normalize('NFC')
  const source = text.normalize('NFC')
  for (const [start, end] of schedule.spans) {
    const phrase = fold(source.slice(start, end)).trim()
    if (!phrase) continue
    const at = fold(out).indexOf(phrase)
    if (at >= 0) out = out.slice(0, at) + ' ' + out.slice(at + phrase.length)
  }
  // "cuối tuần/cuối tháng" model có thể viết lại ở vị trí khác câu gốc.
  out = out.replace(/(?<!\p{L})cuối\s+(?:tuần|tháng)(?:\s+(?:này|sau|tới))?(?!\p{L})/giu, ' ')
  return stripTimePhrases(out)
}

function cleanContent(value, text, schedule, title) {
  let content = typeof value === 'string' ? value.trim().normalize('NFC').slice(0, 100000) : ''
  if (!content) return ''
  if (schedule.dueAt !== null) content = removeSchedulePhrases(content, text, schedule)
  const plain = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim()
  // Rỗng, hoặc mọi từ đều đã có trong tiêu đề (model chép lại 1 phần tiêu đề, vd "Mẹ") -> thừa.
  const titleWords = new Set(plain(title).split(' '))
  if (!content || plain(content).split(' ').every(word => titleWords.has(word))) return ''
  return content.charAt(0).toUpperCase() + content.slice(1)
}

export async function draftFromText(text, now = Date.now(), existingTags = [], { signal } = {}) {
  // Giới hạn số lượng/độ dài để prompt không phình to bất thường nếu người
  // dùng đã có rất nhiều tag khác nhau.
  const safeTags = existingTags.filter(t => typeof t === 'string' && t.trim()).slice(0, 30).map(t => t.slice(0, 100))
  // Ngày giờ tìm được bằng quy tắc (viDate.js) luôn thắng ngày giờ model đoán.
  const schedule = parseSchedule(text, now)
  const explicit = splitRequest(text, schedule.spans)
  // Không có dấu hiệu thời gian nào ("mua sữa cho mẹ") thì cũng không hỏi
  // model về hạn - model nhỏ hay tự bịa ra một ngày. Chỉ nhờ model với các
  // cách nói quy tắc chưa bắt được ("cuối tuần", "đầu tháng 10"...).
  const askModelForDue = schedule.dueAt === null && hasTimeCue(text)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Người dùng hủy (đóng kết nối) thì dừng luôn yêu cầu tới Ollama - không để CPU chạy tiếp vô ích.
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL, prompt: buildPrompt(text, now, safeTags.filter(t => t !== 'chung'), askModelForDue), stream: false,
        format: responseSchema(askModelForDue), keep_alive: KEEP_ALIVE, options: GENERATE_OPTIONS
      })
    })
  } catch (error) {
    if (signal?.aborted) throw new AiFailure('Đã hủy yêu cầu tạo bản nháp.', 'cancelled')
    if (controller.signal.aborted) throw new AiFailure(`Model AI local chưa trả lời sau ${Math.max(1, Math.round(TIMEOUT_MS / 1000))} giây (máy chạy bằng CPU có thể rất chậm).`, 'timeout')
    throw new AiFailure(`Không kết nối được tới Ollama tại ${OLLAMA_URL}. Hãy chạy "ollama serve" và "ollama pull ${OLLAMA_MODEL}" trước.`, 'unreachable')
  } finally { clearTimeout(timeout) }

  if (!response.ok) {
    const detail = response.status === 404
      ? `Model "${OLLAMA_MODEL}" chưa được tải. Chạy: ollama pull ${OLLAMA_MODEL}`
      : `Ollama trả lỗi HTTP ${response.status}.`
    throw new AiFailure(detail, 'model_error')
  }

  const payload = await response.json().catch(() => { throw new AiFailure('Phản hồi của Ollama không phải JSON hợp lệ.', 'bad_response') })
  const raw = typeof payload.response === 'string' ? payload.response : ''
  const parsed = extractJson(raw)

  // Model đôi khi vẫn để ngày giờ trong tiêu đề dù đã dặn không -> cắt đi (hạn đã
  // nằm ở dueAt); cắt xong mà rỗng thì giữ nguyên tiêu đề model.
  const rawTitle = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 255) : ''
  const title = (schedule.dueAt !== null && removeSchedulePhrases(rawTitle, text, schedule)) || rawTitle
  if (!title) throw new AiFailure('Model AI không xác định được tiêu đề từ yêu cầu.', 'incomplete')
  let kind = parsed.kind === 'task' ? 'task' : 'note'
  let startAt = askModelForDue ? coerceTimestamp(parsed.startAt) : null
  let dueAt = askModelForDue ? coerceTimestamp(parsed.dueAt) : schedule.dueAt
  if (startAt !== null && dueAt !== null && dueAt < startAt) [startAt, dueAt] = [dueAt, startAt]
  // Câu có hạn/thời điểm cụ thể ("nộp báo cáo lúc 5h chiều") là việc cần làm.
  if (schedule.dueAt !== null) kind = 'task'

  return {
    title,
    // Nội dung người dùng nói rõ ("với nội dung là ...") luôn được dùng nguyên văn;
    // không có thì mới lấy content model viết.
    content: explicit.content || cleanContent(parsed.content, text, schedule, title),
    // Model nhỏ hay để trống tag -> gợi ý theo từ khóa trong câu.
    tag: reuseExistingTag(parsed.tag || suggestTag(text), safeTags),
    kind,
    // Ghi chú (kind=note) vẫn được phép có startAt/dueAt trong mô hình dữ
    // liệu (giống form nhập tay) - không xóa lịch chỉ vì AI phân loại là note.
    startAt,
    dueAt
  }
}

// Bản nháp cơ bản không cần AI - dùng khi model không trả lời kịp/không chạy.
// Người dùng vẫn có ngay tiêu đề + hạn đã phân tích để sửa rồi lưu, thay vì
// chỉ nhận thông báo lỗi.
export function basicDraft(text, now = Date.now(), existingTags = []) {
  const schedule = parseSchedule(text, now)
  const safeTags = existingTags.filter(t => typeof t === 'string' && t.trim()).slice(0, 30)
  return {
    title: fallbackTitle(text, schedule.spans),
    content: splitRequest(text, schedule.spans).content,
    tag: reuseExistingTag(suggestTag(text), safeTags),
    kind: schedule.dueAt !== null ? 'task' : 'note',
    startAt: null,
    dueAt: schedule.dueAt
  }
}

// Nạp sẵn model vào RAM (gọi Ollama với prompt rỗng) để lần tạo bản nháp đầu
// tiên không phải chờ nạp model. Không ném lỗi - Ollama chưa chạy thì thôi.
export async function warmUp() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: KEEP_ALIVE, options: GENERATE_OPTIONS })
    })
    await response.body?.cancel()
    return response.ok
  } catch { return false }
  finally { clearTimeout(timeout) }
}
