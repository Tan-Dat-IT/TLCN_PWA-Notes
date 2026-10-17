import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSchedule, fallbackTitle, fold, splitRequest, suggestTag } from './viDate.js'

// Mốc cố định: thứ Năm 24/09/2026 10:00 (giờ máy chạy test).
const NOW = new Date(2026, 8, 24, 10, 0).getTime()
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const due = text => parseSchedule(text, NOW).dueAt

test('fold bỏ dấu, chữ thường và giữ nguyên độ dài chuỗi', () => {
  const text = 'Nộp Báo Cáo đúng HẠN'
  assert.equal(fold(text), 'nop bao cao dung han')
  assert.equal(fold(text).length, text.length)
})

test('câu trong ảnh chụp lỗi: "5h chiều thứ 6 ngày 25/09/2026" -> 17:00 25/09/2026', () => {
  assert.equal(due('Nhắc tôi nộp báo cáo vào 5h chiều thứ 6 ngày 25/09/2026'), at(2026, 9, 25, 17))
})

test('giờ: các cách viết phổ biến', () => {
  assert.equal(due('họp lúc 14h30 ngày 30/9'), at(2026, 9, 30, 14, 30))
  assert.equal(due('họp 17:45 ngày 30/9'), at(2026, 9, 30, 17, 45))
  assert.equal(due('gọi điện 8 giờ rưỡi tối 30/9'), at(2026, 9, 30, 20, 30))
  assert.equal(due('ăn trưa 1h trưa 30/9'), at(2026, 9, 30, 13))
  assert.equal(due('họp 9 giờ 15 phút sáng 30/9'), at(2026, 9, 30, 9, 15))
  assert.equal(due('trực 11h đêm 30/9'), at(2026, 9, 30, 23))
  assert.equal(due('họp 5h vào buổi chiều 30/9'), at(2026, 9, 30, 17))
})

test('buổi đứng trước giờ ("chiều nay 3h", "tối mai lúc 8h")', () => {
  assert.equal(due('gọi thầy chiều nay 3h'), at(2026, 9, 24, 15))
  assert.equal(due('họp nhóm tối mai lúc 8h'), at(2026, 9, 25, 20))
})

test('chỉ có buổi, không có giờ: lấy giờ mặc định của buổi', () => {
  assert.equal(due('họp chiều nay'), at(2026, 9, 24, 17))
  assert.equal(due('đi chợ sáng mai'), at(2026, 9, 25, 9))
})

test('chỉ có ngày: hạn là cuối ngày 23:59', () => {
  assert.equal(due('nộp bài ngày 30/9'), at(2026, 9, 30, 23, 59))
  assert.equal(due('nộp bài ngày 30 tháng 9 năm 2026'), at(2026, 9, 30, 23, 59))
  assert.equal(due('thi 01-10-2026'), at(2026, 10, 1, 23, 59))
  assert.equal(due('thi 01.10.2026'), at(2026, 10, 1, 23, 59))
})

test('chỉ có giờ: hôm nay nếu còn kịp, đã qua thì ngày mai', () => {
  assert.equal(due('họp 15h'), at(2026, 9, 24, 15))
  assert.equal(due('tập thể dục 6h sáng'), at(2026, 9, 25, 6))
})

test('ngày không ghi năm đã qua trong năm nay thì hiểu là năm sau', () => {
  assert.equal(due('đóng học phí 5/1'), at(2027, 1, 5, 23, 59))
})

test('ngày tương đối', () => {
  assert.equal(due('nộp bài hôm nay'), at(2026, 9, 24, 23, 59))
  assert.equal(due('nộp bài ngày mai'), at(2026, 9, 25, 23, 59))
  assert.equal(due('nộp bài ngày mốt'), at(2026, 9, 26, 23, 59))
  assert.equal(due('nộp bài 3 ngày nữa'), at(2026, 9, 27, 23, 59))
})

test('thứ trong tuần (tuần tính từ thứ 2), tuần sau/tới', () => {
  assert.equal(due('họp thứ 6'), at(2026, 9, 25, 23, 59))        // thứ 6 tuần này
  assert.equal(due('họp thứ sáu'), at(2026, 9, 25, 23, 59))
  assert.equal(due('họp thứ 2'), at(2026, 9, 28, 23, 59))        // thứ 2 tuần này đã qua -> tuần sau
  assert.equal(due('họp thứ 5'), at(2026, 9, 24, 23, 59))        // hôm nay
  assert.equal(due('họp chủ nhật'), at(2026, 9, 27, 23, 59))
  assert.equal(due('họp thứ 6 tuần sau'), at(2026, 10, 2, 23, 59))
  assert.equal(due('họp thứ tư tuần tới 9h'), at(2026, 9, 30, 9))
})

test('cuối tuần = chủ nhật, cuối tháng = ngày cuối tháng', () => {
  assert.equal(due('nộp đồ án cuối tuần này'), at(2026, 9, 27, 23, 59))
  assert.equal(due('nộp đồ án cuối tuần sau'), at(2026, 10, 4, 23, 59))
  assert.equal(due('đóng tiền nhà cuối tháng'), at(2026, 9, 30, 23, 59))
  assert.equal(due('đóng tiền nhà cuối tháng sau'), at(2026, 10, 31, 23, 59))
})

test('KHÔNG nhận nhầm: số lượng, "một", "thứ tự", khoảng số, số thập phân', () => {
  assert.equal(due('mua 2 hộp sữa'), null)
  assert.equal(due('mua 2 gói mì'), null)
  assert.equal(due('làm một việc quan trọng'), null)
  assert.equal(due('sắp xếp thứ tự tài liệu'), null)
  assert.equal(due('học 1-2 tiếng'), null)
  assert.equal(due('lương 5.5 triệu'), null)
  assert.equal(due('mua sữa cho mẹ'), null)
  assert.equal(due('ngày 31/2 nộp bài'), null) // ngày không tồn tại
  assert.equal(due('họp 25h'), null)
  assert.equal(due('ôn lại bài từ đầu cho tới nay'), null) // "tới nay" không phải "tối nay"
  assert.equal(due('họp 8h tới 30/9'), at(2026, 9, 30, 8)) // "8h tới" không phải 8h tối
})

test('chuỗi NFD (dấu tách rời) vẫn nhận được', () => {
  assert.equal(due('họp chiều nay 3h'.normalize('NFD')), at(2026, 9, 24, 15))
})

test('fallbackTitle bỏ lời nhắc + cụm ngày giờ + từ nối thừa', () => {
  const title = text => fallbackTitle(text, parseSchedule(text, NOW).spans)
  assert.equal(title('Nhắc tôi nộp báo cáo vào 5h chiều thứ 6 ngày 25/09/2026'), 'Nộp báo cáo')
  assert.equal(title('Họp nhóm đồ án tối mai lúc 8h'), 'Họp nhóm đồ án')
  assert.equal(title('nhớ gọi điện cho thầy hướng dẫn chiều nay 3h'), 'Gọi điện cho thầy hướng dẫn')
  assert.equal(title('mua sữa cho mẹ'), 'Mua sữa cho mẹ')
  assert.equal(title('nộp đồ án cuối tuần này'), 'Nộp đồ án')
  assert.equal(title('5h chiều'), '5h chiều') // không còn gì ngoài giờ -> giữ nguyên câu
  assert.ok(title('a'.repeat(200)).length <= 80)
})

test('splitRequest tách phần nội dung người dùng nói rõ, bỏ ngày giờ ở cả hai phần', () => {
  const split = text => splitRequest(text, parseSchedule(text, NOW).spans)
  assert.equal(split('Nhắc tôi nộp báo cáo vào 5h chiều thứ 6 ngày 25/09/2026 với nội dung là ý tưởng của TLCN').content, 'Ý tưởng của TLCN')
  assert.equal(split('Họp nhóm, nội dung: chốt phân công ngày 30/9').content, 'Chốt phân công')
  assert.equal(split('Viết email cho thầy, chi tiết là xin lịch bảo vệ').content, 'Xin lịch bảo vệ')
  assert.equal(split('Nộp bài có mô tả gồm 3 phần').content, '3 phần')
  assert.equal(split('Mua sữa cho mẹ').content, '')
  assert.equal(split('Ghi chú là nhóm họp online').content, '') // "ghi chú là" ở đầu câu là lời nhắc, không phải nội dung
})

test('fallbackTitle không kéo theo phần nội dung và từ dẫn trước cụm giờ', () => {
  const title = text => fallbackTitle(text, parseSchedule(text, NOW).spans)
  assert.equal(title('Nhắc tôi nộp báo cáo vào 5h chiều thứ 6 ngày 25/09/2026 với nội dung là ý tưởng của TLCN'), 'Nộp báo cáo')
  assert.equal(title('Họp nhóm đồ án tối mai lúc 8h ở thư viện'), 'Họp nhóm đồ án ở thư viện')
})

test('suggestTag theo từ khóa có dấu, không nhầm các từ trùng khi bỏ dấu', () => {
  assert.equal(suggestTag('Nộp báo cáo ý tưởng TLCN'), 'học tập')
  assert.equal(suggestTag('Họp với khách hàng'), 'công việc')
  assert.equal(suggestTag('Mua 2 hộp sữa cho mẹ'), 'mua sắm')        // "hộp" không phải "họp"
  assert.equal(suggestTag('Đóng học phí kỳ 1'), 'tài chính')          // ưu tiên tài chính hơn "học"
  assert.equal(suggestTag('Đi khám răng'), 'sức khỏe')
  assert.equal(suggestTag('Gọi điện cho bố mẹ'), 'gia đình')
  assert.equal(suggestTag('Nếu trời mưa thì ở nhà'), '')              // "thì" không phải "thi"
  assert.equal(suggestTag('Tôi thấy món này ngon'), '')               // "thấy/món" không phải "thầy/môn"
  assert.equal(suggestTag('Còn 3 việc'), '')                          // "còn" không phải "con"
})
