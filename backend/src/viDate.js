// Phân tích ngày giờ tiếng Việt bằng quy tắc (không dùng AI). Model local cỡ
// nhỏ chạy CPU vừa chậm vừa hay đọc sai giờ ("5h chiều" thành 05:00, tự bịa
// ngày bắt đầu). Phần này xác định, tức thì và kiểm thử được; kết quả tìm được
// luôn được ưu tiên hơn ngày giờ do model đoán (xem ai.js).
// Mọi mốc thời gian tính theo giờ địa phương của máy backend (giống ai.js).

// Bỏ dấu + chữ thường, GIỮ NGUYÊN độ dài (mỗi ký tự có dấu -> đúng 1 ký tự),
// để vị trí khớp trên bản không dấu dùng lại được trên câu gốc. Câu gốc phải
// ở dạng NFC (chữ có dấu dựng sẵn) - parseSchedule tự chuẩn hóa trước.
export function fold(text) {
  return Array.from(text, ch => {
    if (ch === 'đ' || ch === 'Đ') return 'd'
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return base.length === 1 ? base : ch
  }).join('')
}

function atTime(base, hour, minute) {
  const d = new Date(base)
  d.setHours(hour, minute, 0, 0)
  return d
}
function addDays(base, days) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}
function validDate(y, m, d) {
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null
}

const PERIODS = ['sang', 'trua', 'chieu', 'toi', 'dem']
// Đoạn gốc có chữ "tới" (không phải "tối") thì không được hiểu là buổi tối
// ("cho tới nay", "8h tới"). Đoạn không chứa cả hai thì không liên quan -> true.
function notToi(originalSlice) {
  return !/tới/i.test(originalSlice) || /tối/i.test(originalSlice)
}
function applyPeriod(hour, period) {
  if ((period === 'chieu' || period === 'toi') && hour < 12) return hour + 12
  if (period === 'trua' && hour < 11) return hour + 12
  if (period === 'dem') return hour === 12 ? 0 : hour >= 6 && hour < 12 ? hour + 12 : hour
  if (period === 'sang' && hour === 12) return 0
  return hour
}

// Giờ: "17h", "17h30", "5h chiều", "5 giờ 15 phút sáng", "17:45", "8 giờ rưỡi tối".
// "h"/"giờ" không được dính liền chữ cái phía sau ("2 hộp", "3 giờng" không phải giờ).
const TIME_RE = /(?<![\d/.:-])(\d{1,2})\s*(?:(:)(\d{2})|(?:h|gio)(?![a-z])\s*(\d{1,2}|ruoi)?(?:\s*(?:p|phut)(?![a-z]))?)(?:\s*(?:vao\s+)?(?:buoi\s+)?(sang|trua|chieu|toi|dem)(?![a-z]))?/g

function findTime(folded, original) {
  for (const m of folded.matchAll(TIME_RE)) {
    const hour = Number(m[1])
    const minute = m[2] ? Number(m[3]) : m[4] === 'ruoi' ? 30 : m[4] ? Number(m[4]) : 0
    if (hour > 23 || minute > 59) continue
    // "tới" và "tối" cùng thành "toi" khi bỏ dấu: "8h tới" không phải 8h tối.
    const period = m[5] === 'toi' && !notToi(original.slice(m.index, m.index + m[0].length)) ? null : m[5] || null
    return { hour, minute, period, start: m.index, end: m.index + m[0].length }
  }
  return null
}

// Trả vị trí bắt đầu/độ dài của đoạn ngày tìm được trên chuỗi không dấu.
function findDate(folded, original, now) {
  const today = atTime(now, 0, 0)
  const nextYearIfPast = (date, y, mo, d, explicitYear) =>
    !explicitYear && date < today ? validDate(y + 1, mo, d) || date : date
  // dd/mm/yyyy, dd/mm (dấu "/"); dd-mm-yyyy, dd.mm.yyyy chỉ khi có năm (tránh "1-2 tiếng", "5.5 triệu")
  for (const m of folded.matchAll(/(?<![\d/.-])(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?|[.-](\d{1,2})[.-](\d{4}))(?![\d/.-])/g)) {
    const day = Number(m[1]), month = Number(m[2] ?? m[4])
    const yearText = m[3] ?? m[5]
    let year = yearText ? Number(yearText) : today.getFullYear()
    if (year < 100) year += 2000
    const date = validDate(year, month, day)
    if (date) return { date: nextYearIfPast(date, year, month, day, Boolean(yearText)), index: m.index, length: m[0].length }
  }
  // "ngày 25 tháng 9 (năm 2026)"
  const long = folded.match(/ngay\s+(\d{1,2})\s+thang\s+(\d{1,2})(?:\s+nam\s+(\d{4}))?/)
  if (long) {
    const year = long[3] ? Number(long[3]) : today.getFullYear()
    const date = validDate(year, Number(long[2]), Number(long[1]))
    if (date) return { date: nextYearIfPast(date, year, Number(long[2]), Number(long[1]), Boolean(long[3])), index: long.index, length: long[0].length }
  }
  // Tương đối. "mốt" và "một" giống nhau khi bỏ dấu -> đối chiếu chữ gốc.
  const relative = [
    [/\b(?:hom nay|(?:sang|trua|chieu|toi|dem) nay)\b/g, 0, { test: notToi }],
    [/\b(?:ngay mai|(?:sang|trua|chieu|toi|dem) mai)\b/g, 1, { test: notToi }],
    [/\b(?:ngay kia|(?:ngay )?mot)\b/g, 2, /mốt|kia/i]
  ]
  for (const [re, days, mustMatchOriginal] of relative) {
    for (const m of folded.matchAll(re)) {
      if (mustMatchOriginal && !mustMatchOriginal.test(original.slice(m.index, m.index + m[0].length))) continue
      return { date: addDays(today, days), index: m.index, length: m[0].length }
    }
  }
  const later = folded.match(/\b(\d{1,2})\s+ngay\s+(?:nua|toi)\b/)
  if (later) return { date: addDays(today, Number(later[1])), index: later.index, length: later[0].length }
  // "cuối tuần (này/sau/tới)" = chủ nhật; "cuối tháng (này/sau/tới)" = ngày cuối tháng.
  const endOf = folded.match(/\bcuoi\s+(tuan|thang)(?:\s+(nay|sau|toi))?\b/)
  if (endOf) {
    const next = endOf[2] === 'sau' || endOf[2] === 'toi'
    const date = endOf[1] === 'tuan'
      ? addDays(today, (7 - today.getDay()) % 7 + (next ? 7 : 0))
      : new Date(today.getFullYear(), today.getMonth() + (next ? 2 : 1), 0)
    return { date, index: endOf.index, length: endOf[0].length }
  }

  // "thứ 6", "thứ sáu", "chủ nhật", kèm "tuần sau/tuần tới/tuần này". Dạng chữ
  // đối chiếu chữ gốc có dấu ("thứ tư" khác "thứ tự", "thứ năm" khác "thứ nằm").
  const WORDS = { hai: 1, ba: 2, 'tư': 3, 'năm': 4, 'sáu': 5, 'bảy': 6 }
  for (const m of folded.matchAll(/\b(?:thu\s+([2-7]|hai|ba|tu|nam|sau|bay)|chu nhat)\b(\s+tuan\s+(?:sau|toi|nay))?/g)) {
    let target
    if (!m[1]) target = 0
    else if (/\d/.test(m[1])) target = Number(m[1]) - 1
    else {
      const word = original.slice(m.index, m.index + m[0].length).toLowerCase().match(/^thứ\s+(\S+)/)?.[1]
      if (!(word in WORDS)) continue
      target = WORDS[word]
    }
    const nextWeek = /sau|toi/.test(m[2] || '')
    // Tuần tính từ thứ 2 như cách nói thông thường ở Việt Nam.
    const monday = addDays(today, -((today.getDay() + 6) % 7))
    let date = addDays(monday, (target + 6) % 7 + (nextWeek ? 7 : 0))
    if (!nextWeek && date < today) date = addDays(date, 7)
    return { date, index: m.index, length: m[0].length }
  }
  return null
}

// Trả { dueAt, spans }: dueAt là epoch ms hoặc null; spans là các đoạn [start,
// end) đã dùng để xác định thời gian (tạo tiêu đề dự phòng không lặp ngày giờ).
export function parseSchedule(input, now = Date.now()) {
  const text = input.normalize('NFC')
  const folded = fold(text)
  const date = findDate(folded, text, now)
  const time = findTime(folded, text)
  const spans = []
  if (date) spans.push([date.index, date.index + date.length])
  if (time) spans.push([time.start, time.end])
  if (!date && !time) return { dueAt: null, spans }
  // Buổi có thể nằm trong cụm ngày ("chiều nay 3h", "tối mai lúc 8h"). Chỉ nhận
  // dạng "<buổi> nay/mai" - không tìm chuỗi con, vì "tuần tới" bỏ dấu thành
  // "tuan toi" sẽ bị nhầm thành buổi "tối".
  const datePeriod = date
    ? folded.slice(date.index, date.index + date.length).match(new RegExp(`\\b(${PERIODS.join('|')})\\s+(?:nay|mai)\\b`))?.[1] ?? null
    : null
  if (time) {
    const hour = applyPeriod(time.hour, time.period ?? datePeriod)
    if (date) return { dueAt: atTime(date.date, hour, time.minute).getTime(), spans }
    // Chỉ có giờ: hôm nay nếu còn kịp, không thì ngày mai.
    let due = atTime(now, hour, time.minute)
    if (due.getTime() <= now) due = addDays(due, 1)
    return { dueAt: due.getTime(), spans }
  }
  // Chỉ có ngày: "chiều nay"/"tối mai" lấy giờ mặc định của buổi; còn lại là cuối ngày.
  const defaults = { sang: [9, 0], trua: [12, 0], chieu: [17, 0], toi: [20, 0], dem: [23, 0] }
  const [h, mi] = datePeriod ? defaults[datePeriod] : [23, 59]
  return { dueAt: atTime(date.date, h, mi).getTime(), spans }
}

// Bỏ cụm ngày giờ (đoạn đã dùng + cụm thời gian còn sót - vd câu có cả "thứ 6"
// lẫn "25/09" thì ngày chỉ lấy từ "25/09", "thứ 6" vẫn còn) và từ nối thừa ở cuối.
export function stripTimePhrases(part) {
  let out = part
    .replace(/(?<!\p{L})(?:thứ\s+(?:[2-7]|hai|ba|tư|năm|sáu|bảy)|chủ\s+nhật)(?:\s+tuần\s+(?:này|sau|tới))?(?!\p{L})/giu, ' ')
    .replace(/(?<!\p{L})(?:hôm\s+nay|ngày\s+(?:mai|kia|mốt)|(?:sáng|trưa|chiều|tối|đêm)(?:\s+(?:nay|mai))?)(?!\p{L})/giu, ' ')
    .replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 4; i++) {
    out = out.replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '')
      // (?:^|\s+): cả trường hợp chỉ còn đúng 1 từ dẫn ("Vào" sau khi cắt "5h chiều ...").
      .replace(/(?:^|\s+)(?:vào|lúc|ngày|trước|hạn|buổi|thứ|tuần|này|nay|sau|tới|nhé|nha|giúp|với|cho)$/i, '').trim()
  }
  return out
}
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)

// Cụm người dùng nói rõ phần nội dung: "... với nội dung (là) X", "..., nội
// dung: X", "chi tiết: X", "mô tả: X". Không nhận ở đầu câu ("ghi chú là ..."
// là lời nhắc, không phải nội dung).
const CONTENT_MARKER = /[\s,;.]+(?:với\s+|có\s+)?(?:nội\s+dung|chi\s+tiết|mô\s+tả)(?:\s+(?:là|gồm|như\s+sau))?\s*:?\s+/iu

// Tách câu yêu cầu thành phần chính (để làm tiêu đề) và phần nội dung (nếu
// người dùng nói rõ), đã bỏ cụm ngày giờ ở cả hai. Model nhỏ hay bỏ trống
// content dù người dùng đã nói "với nội dung là ..." - nên tách bằng quy tắc.
export function splitRequest(input, spans = []) {
  const text = input.normalize('NFC')
  // Thay đoạn ngày giờ bằng khoảng trắng CÙNG ĐỘ DÀI để vị trí không lệch.
  let masked = text
  for (const [spanStart, end] of spans) {
    // Kéo cả từ dẫn đứng ngay trước cụm thời gian ("lúc 8h", "vào ngày 25/09") vào vùng bỏ đi.
    const lead = masked.slice(0, spanStart).match(/(?:\s+(?:vào|lúc|ngày|hạn|trước))+\s*$/iu)
    const start = lead ? spanStart - lead[0].length : spanStart
    masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end)
  }
  const marker = masked.match(CONTENT_MARKER)
  const main = marker ? masked.slice(0, marker.index) : masked
  const content = marker ? stripTimePhrases(masked.slice(marker.index + marker[0].length)) : ''
  return { main, content: capitalize(content).slice(0, 2000) }
}

// Tiêu đề dự phòng khi AI không phản hồi: bỏ lời nhắc ("nhắc tôi", "nhớ"...),
// phần nội dung, các đoạn ngày giờ và từ nối thừa ở cuối, viết hoa chữ đầu.
export function fallbackTitle(input, spans = []) {
  const text = input.normalize('NFC')
  let out = stripTimePhrases(splitRequest(text, spans).main)
  out = out.replace(/^(?:hãy\s+)?(?:nhắc(?:\s+nhở)?\s+(?:tôi|mình|em|anh|chị)\s+(?:là\s+|về\s+)?|nhớ\s+(?:là\s+)?|ghi\s+chú\s+(?:là\s+)?)/i, '')
  out = stripTimePhrases(out)
  if (!out) out = text.trim()
  return capitalize(out.slice(0, 80))
}

// Gợi ý tag theo từ khóa khi model để trống. So khớp trên chữ CÓ DẤU (nhiều từ
// trùng nhau khi bỏ dấu: "họp/hộp", "thi/thì", "thầy/thấy", "môn/món", "còn/con").
// Nhóm đứng trước được ưu tiên ("nộp báo cáo TLCN" -> học tập). Trả tên tag
// tiếng Việt có dấu; ai.js tự dùng lại đúng tag đã có nếu trùng nghĩa.
const TAG_KEYWORDS = [
  ['tài chính', ['đóng tiền', 'học phí', 'thanh toán', 'chuyển khoản', 'hóa đơn', 'hoá đơn', 'tiền nhà', 'tiền điện', 'tiền nước', 'trả nợ', 'lương']],
  ['học tập', ['tlcn', 'đồ án', 'luận văn', 'khóa luận', 'khoá luận', 'tiểu luận', 'bài tập', 'ôn thi', 'đi thi', 'lịch thi', 'kỳ thi', 'thi cuối kỳ', 'thi giữa kỳ', 'kiểm tra', 'học', 'môn', 'giảng viên', 'thầy', 'cô giáo', 'lớp', 'nộp bài', 'đề cương', 'thuyết trình', 'seminar', 'báo cáo']],
  ['công việc', ['họp', 'dự án', 'công ty', 'khách hàng', 'sếp', 'hợp đồng', 'email', 'công việc', 'deadline', 'phỏng vấn']],
  ['mua sắm', ['mua', 'đi chợ', 'siêu thị', 'đặt hàng']],
  ['sức khỏe', ['khám', 'bác sĩ', 'bệnh viện', 'uống thuốc', 'thuốc', 'tập thể dục', 'gym', 'chạy bộ', 'yoga']],
  ['gia đình', ['gia đình', 'bố mẹ', 'ba mẹ', 'mẹ', 'bố', 'vợ', 'chồng', 'con cái']]
]
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function suggestTag(input) {
  const text = input.normalize('NFC').toLowerCase()
  for (const [tag, keywords] of TAG_KEYWORDS) {
    if (keywords.some(k => new RegExp(`(?<!\\p{L})${escapeRe(k)}(?!\\p{L})`, 'u').test(text))) return tag
  }
  return ''
}
