import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftFromText, AiFailure, basicDraft, warmUp } from './ai.js'

function withFetch(impl, run) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  return run().finally(() => { globalThis.fetch = original })
}

test('draftFromText trả về bản nháp hợp lệ khi Ollama phản hồi JSON đúng', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'Họp nhóm', content: 'Bàn kế hoạch', tag: 'hoc tap', kind: 'task', startAt: 1000, dueAt: 2000 })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('nhắc tôi họp nhóm đầu tháng sau', 500)
      assert.equal(draft.title, 'Họp nhóm')
      assert.equal(draft.kind, 'task')
      assert.equal(draft.tag, 'hoc-tap')
      assert.equal(draft.startAt, 1000)
      assert.equal(draft.dueAt, 2000)
    }
  )
})

test('draftFromText hoán đổi startAt/dueAt nếu model trả ngược thứ tự', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'X', kind: 'task', startAt: 5000, dueAt: 1000 })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('việc x đầu năm sau', 100)
      assert.equal(draft.startAt, 1000)
      assert.equal(draft.dueAt, 5000)
    }
  )
})

test('draftFromText ném AiFailure khi thiếu title', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ response: JSON.stringify({ title: '' }) }), { status: 200 }),
    async () => {
      await assert.rejects(() => draftFromText('rỗng', 1), AiFailure)
    }
  )
})

test('draftFromText ném AiFailure khi Ollama không kết nối được', async () => {
  await withFetch(
    async () => { throw new TypeError('fetch failed') },
    async () => {
      await assert.rejects(() => draftFromText('x', 1), AiFailure)
    }
  )
})

test('draftFromText ném AiFailure khi HTTP không thành công', async () => {
  await withFetch(
    async () => new Response('not found', { status: 404 }),
    async () => {
      await assert.rejects(() => draftFromText('x', 1), AiFailure)
    }
  )
})

test('draftFromText ném AiFailure khi phản hồi không chứa JSON hợp lệ', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ response: 'không phải JSON' }), { status: 200 }),
    async () => {
      await assert.rejects(() => draftFromText('x', 1), AiFailure)
    }
  )
})

test('kind=note vẫn giữ dueAt nếu model có gợi ý (note vẫn được phép có lịch)', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'Ghi chú', kind: 'note', dueAt: 9999 })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('ghi chú đầu tháng sau', 1)
      assert.equal(draft.kind, 'note')
      assert.equal(draft.dueAt, 9999)
    }
  )
})

// Hồi quy: trước đây yêu cầu model tự tính epoch millisecond - model nhỏ hay
// trả rỗng/sai vì không làm phép tính đó được (vd không điền được dueAt dù
// người dùng ghi rõ "ngày 30.09.2026"). Từ nay model chỉ cần viết lại ngày
// dạng "YYYY-MM-DD", backend tự quy đổi sang epoch bằng code xác định.
test('draftFromText quy đổi đúng chuỗi ngày "YYYY-MM-DD" model trả về sang epoch giờ địa phương', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'Báo cáo dự án', kind: 'task', dueAt: '2026-09-30' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('báo cáo dự án cuối quý', 1)
      assert.equal(draft.dueAt, new Date(2026, 8, 30, 0, 0, 0, 0).getTime())
    }
  )
})

test('draftFromText quy đổi đúng chuỗi ngày kèm giờ "YYYY-MM-DD HH:mm"', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'Họp', kind: 'task', startAt: '2026-09-30 14:30' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('họp đầu tuần sau', 1)
      assert.equal(draft.startAt, new Date(2026, 8, 30, 14, 30, 0, 0).getTime())
    }
  )
})

test('draftFromText trả null nếu chuỗi ngày model trả về không đúng định dạng', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'X', kind: 'task', dueAt: 'thứ sáu tuần sau' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('việc x tuần sau nữa', 1)
      assert.equal(draft.dueAt, null)
    }
  )
})

// Hồi quy: mỗi lần gọi AI độc lập, model không nhớ tag đã dùng ở lần trước
// nên hay bịa tag mới cho ghi chú cùng chủ đề (vd "Báo cáo tiến độ dự án" ra
// tag khác với "Báo cáo dự án..." dù cùng chủ đề "báo cáo"). Từ nay backend
// gửi kèm danh sách tag đã có và tự so khớp (không dấu) để tái sử dụng đúng
// tag hiện có thay vì tạo biến thể mới.
test('draftFromText tái sử dụng nguyên văn tag đã có nếu model chọn tag trùng nghĩa (không phân biệt dấu/hoa-thường)', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'Báo cáo tiến độ', kind: 'task', tag: 'Báo Cáo' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('báo cáo tiến độ dự án', 1, ['báo-cáo', 'cong-viec'])
      assert.equal(draft.tag, 'báo-cáo')
    }
  )
})

test('draftFromText tạo tag mới (đã bỏ dấu) nếu không tag nào có sẵn phù hợp', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'X', kind: 'note', tag: 'sức khỏe' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('x', 1, ['báo-cáo', 'cong-viec'])
      assert.equal(draft.tag, 'suc-khoe')
    }
  )
})

test('draftFromText bỏ qua existingTags sai định dạng thay vì lỗi cả request', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'X', kind: 'note', tag: 'hoc tap' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('x', 1, [123, null, 'hoc-tap'])
      assert.equal(draft.tag, 'hoc-tap')
    }
  )
})

// Hồi quy: model local hay bịa chuỗi vô nghĩa khi được yêu cầu tự bỏ dấu
// tiếng Việt (vd "rastreadbailan" cho "rà soát bài làm"). Từ nay model chỉ
// cần trả tag tiếng Việt có dấu bình thường, backend tự bỏ dấu bằng thuật
// toán xác định - test này xác nhận việc bỏ dấu hoạt động đúng.
test('draftFromText tự bỏ dấu tiếng Việt cho tag thay vì tin model', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'Rà soát việc cuối tuần', kind: 'note', tag: 'Rà soát Bài Làm' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('x', 1)
      assert.equal(draft.tag, 'ra-soat-bai-lam')
    }
  )
})

test('draftFromText chuyển đ/Đ thành d khi bỏ dấu tag', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'X', kind: 'note', tag: 'Đề tài' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('x', 1)
      assert.equal(draft.tag, 'de-tai')
    }
  )
})

test('draftFromText trả tag rỗng khi model không có gợi ý tag', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({
      response: JSON.stringify({ title: 'X', kind: 'note' })
    }), { status: 200 }),
    async () => {
      const draft = await draftFromText('x', 1)
      assert.equal(draft.tag, '')
    }
  )
})

// --- Tối ưu tốc độ/độ chính xác (24/09/2026) ---

const THU_NAM = new Date(2026, 8, 24, 10, 0).getTime() // thứ Năm 24/09/2026 10:00

function captureFetch(modelJson) {
  const bodies = []
  const impl = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ response: JSON.stringify(modelJson) }), { status: 200 })
  }
  return { bodies, impl }
}

test('ngày giờ do quy tắc tìm được thắng ngày giờ model đoán sai (lỗi "5h chiều" -> 05:00)', async () => {
  const { impl } = captureFetch({ title: 'Nộp báo cáo', kind: 'note', startAt: '2026-09-24 17:00', dueAt: '2026-09-25 05:00' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('Nhắc tôi nộp báo cáo vào 5h chiều thứ 6 ngày 25/09/2026', THU_NAM)
    assert.equal(draft.dueAt, new Date(2026, 8, 25, 17, 0).getTime())
    assert.equal(draft.startAt, null) // model tự bịa ngày bắt đầu -> bỏ
    assert.equal(draft.kind, 'task') // có hạn cụ thể -> là việc cần làm
  })
})

test('đã biết ngày giờ thì KHÔNG hỏi model về dueAt (prompt ngắn, schema không có dueAt)', async () => {
  const { bodies, impl } = captureFetch({ title: 'Họp', content: '', tag: '', kind: 'task' })
  await withFetch(impl, async () => { await draftFromText('họp lúc 14h30 ngày 30/9', THU_NAM) })
  assert.equal('dueAt' in bodies[0].format.properties, false)
  assert.doesNotMatch(bodies[0].prompt, /dueAt/)
})

test('câu không có dấu hiệu thời gian: bỏ qua hạn model tự bịa', async () => {
  const { bodies, impl } = captureFetch({ title: 'Mua sữa cho mẹ', kind: 'task', dueAt: '2026-09-25' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('Mua sữa cho mẹ', THU_NAM)
    assert.equal(draft.dueAt, null)
  })
  assert.equal('dueAt' in bodies[0].format.properties, false)
})

test('câu có dấu hiệu thời gian mà quy tắc chưa hiểu thì mới hỏi model dueAt', async () => {
  const { bodies, impl } = captureFetch({ title: 'Nộp hồ sơ', kind: 'task', dueAt: '2026-10-01' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('nộp hồ sơ đầu tháng sau', THU_NAM)
    assert.equal(draft.dueAt, new Date(2026, 9, 1).getTime())
  })
  assert.equal('dueAt' in bodies[0].format.properties, true)
  assert.match(bodies[0].prompt, /dueAt/)
})

test('gọi Ollama với JSON schema, keep_alive và giới hạn token để chạy nhanh trên CPU', async () => {
  const { bodies, impl } = captureFetch({ title: 'X', kind: 'note' })
  await withFetch(impl, async () => { await draftFromText('ghi chú x', THU_NAM) })
  const body = bodies[0]
  assert.equal(body.stream, false)
  assert.equal(body.format.type, 'object')
  assert.deepEqual(body.format.properties.kind.enum, ['task', 'note'])
  assert.equal(body.keep_alive, '30m')
  assert.equal(body.options.temperature, 0)
  assert.ok(body.options.num_predict > 0 && body.options.num_predict <= 300)
  assert.ok(body.prompt.length < 1200, `prompt quá dài: ${body.prompt.length} ký tự`)
})

test('không gợi ý tag mặc định "chung" cho model (tag vô nghĩa), vẫn dùng lại tag khác', async () => {
  const { bodies, impl } = captureFetch({ title: 'X', kind: 'note', tag: 'học tập' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('ôn bài', THU_NAM, ['chung', 'học tập'])
    assert.equal(draft.tag, 'học tập')
  })
  assert.doesNotMatch(bodies[0].prompt, /chung/)
})

test('content chỉ lặp lại cụm ngày giờ đã phân tích thì bị bỏ', async () => {
  const { impl } = captureFetch({ title: 'Nộp báo cáo', content: 'Vào 5h chiều thứ 6 ngày 25/09/2026', kind: 'task' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('nộp báo cáo 5h chiều ngày 25/09/2026', THU_NAM)
    assert.equal(draft.content, '')
  })
  const keep = captureFetch({ title: 'Nộp báo cáo', content: 'Gửi bản PDF cho thầy', kind: 'task' })
  await withFetch(keep.impl, async () => {
    const draft = await draftFromText('nộp báo cáo 5h chiều ngày 25/09/2026, gửi bản PDF cho thầy', THU_NAM)
    assert.equal(draft.content, 'Gửi bản PDF cho thầy')
  })
})

test('người dùng hủy (signal) -> AiFailure code "cancelled", dừng yêu cầu tới Ollama', async () => {
  let aborted = false
  const impl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')) })
  })
  const cancel = new AbortController()
  await withFetch(impl, async () => {
    const pending = draftFromText('ghi chú x', THU_NAM, [], { signal: cancel.signal })
    cancel.abort()
    await assert.rejects(pending, error => error instanceof AiFailure && error.code === 'cancelled')
  })
  assert.equal(aborted, true)
})

test('basicDraft: bản nháp không cần AI (tiêu đề sạch + hạn đã phân tích)', () => {
  assert.deepEqual(basicDraft('Nhắc tôi nộp báo cáo vào 5h chiều thứ 6 ngày 25/09/2026', THU_NAM), {
    title: 'Nộp báo cáo', content: '', tag: 'hoc-tap', kind: 'task', startAt: null, dueAt: new Date(2026, 8, 25, 17, 0).getTime()
  })
  assert.deepEqual(basicDraft('mua sữa cho mẹ', THU_NAM), { title: 'Mua sữa cho mẹ', content: '', tag: 'mua-sam', kind: 'note', startAt: null, dueAt: null })
})

test('warmUp gọi Ollama với keep_alive, không ném lỗi khi Ollama chưa chạy', async () => {
  const { bodies, impl } = captureFetch({})
  await withFetch(impl, async () => { assert.equal(await warmUp(), true) })
  assert.equal(bodies[0].keep_alive, '30m')
  assert.equal('prompt' in bodies[0], false)
  await withFetch(async () => { throw new TypeError('fetch failed') }, async () => { assert.equal(await warmUp(), false) })
})

test('model để trống content/tag: dùng nội dung người dùng nói rõ + tag gợi ý theo từ khóa', async () => {
  const { impl } = captureFetch({ title: 'Nộp báo cáo', content: '', tag: '', kind: 'task' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('Nhắc tôi nộp báo cáo vào 5h chiều thứ 6 ngày 25/09/2026 với nội dung là ý tưởng của TLCN', THU_NAM, ['chung', 'Học tập'])
    assert.equal(draft.content, 'Ý tưởng của TLCN')
    assert.equal(draft.tag, 'Học tập') // dùng lại đúng tag đã có
  })
})

test('prompt không còn dặn model "để rỗng" content/tag', async () => {
  const { bodies, impl } = captureFetch({ title: 'X', kind: 'note' })
  await withFetch(impl, async () => { await draftFromText('ghi chú x', THU_NAM) })
  assert.doesNotMatch(bodies[0].prompt, /thường để rỗng|rỗng nếu không rõ/)
  assert.match(bodies[0].prompt, /tag: BẮT BUỘC/)
})

test('cắt ngày giờ khỏi tiêu đề/nội dung model trả về; nội dung chỉ lặp từ của tiêu đề thì bỏ', async () => {
  const { impl } = captureFetch({ title: 'Đóng học phí cuối tháng', content: 'Học phí', tag: 'tài chính', kind: 'task' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('Đóng học phí cuối tháng', THU_NAM)
    assert.equal(draft.title, 'Đóng học phí')
    assert.equal(draft.content, '')
  })
})

test('chữ số đơn lẻ ("mua 2 hộp sữa") không khiến app hỏi model về hạn', async () => {
  const { bodies, impl } = captureFetch({ title: 'Mua 2 hộp sữa', kind: 'task', dueAt: '2026-09-25' })
  await withFetch(impl, async () => {
    const draft = await draftFromText('Mua 2 hộp sữa cho mẹ', THU_NAM)
    assert.equal(draft.dueAt, null)
  })
  assert.equal('dueAt' in bodies[0].format.properties, false)
})
