import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { answerQuestion, cosineSimilarity, knowledgeHash, noteToKnowledgeText, KnowledgeFailure } from './knowledge.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function note(overrides = {}) {
  return {
    serverId: 'note-1', title: 'Chuẩn bị bảo vệ', content: 'Hoàn thiện slide và luyện demo',
    tag: 'học tập', kind: 'task', done: false, dueAt: null, updatedAt: 10,
    version: 2, deleted: 0, ...overrides
  }
}

function memoryStore(notes) {
  const cache = new Map()
  return {
    requestedUserIds: [],
    async getKnowledgeNotes(userId) { this.requestedUserIds.push(userId); return notes },
    async getKnowledgeEmbeddings(userId) {
      this.requestedUserIds.push(userId)
      return [...cache.values()]
    },
    async saveKnowledgeEmbeddings(userId, items) {
      this.requestedUserIds.push(userId)
      for (const item of items) cache.set(item.serverId, item)
    },
    async deleteStaleKnowledgeEmbeddings(userId) { this.requestedUserIds.push(userId) },
    cache
  }
}

test('noteToKnowledgeText và hash bao phủ dữ liệu có ý nghĩa tìm kiếm', () => {
  const first = noteToKnowledgeText(note())
  assert.match(first, /Chuẩn bị bảo vệ/)
  assert.match(first, /Chưa hoàn thành/)
  assert.notEqual(knowledgeHash(note()), knowledgeHash(note({ content: 'Nội dung khác' })))
})

test('cosineSimilarity xử lý vector hợp lệ và từ chối vector sai', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.equal(cosineSimilarity([1], [1, 2]), -1)
})

test('answerQuestion lập chỉ mục, tìm ngữ nghĩa và trả nguồn đúng tài khoản', async () => {
  const notes = [
    note(),
    note({ serverId: 'note-2', title: 'Mua sữa', content: 'Mua hai hộp sữa', tag: 'mua sắm', version: 1 })
  ]
  const store = memoryStore(notes)
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), body })
    if (String(url).endsWith('/api/embed')) {
      if (body.input.length === 2) return { ok: true, json: async () => ({ embeddings: [[1, 0], [0, 1]] }) }
      return { ok: true, json: async () => ({ embeddings: [[1, 0]] }) }
    }
    return { ok: true, json: async () => ({ response: 'Bạn cần hoàn thiện slide [1]. Nguồn sai [9].' }) }
  }

  const result = await answerQuestion({ store, userId: 42, question: 'Tôi cần làm gì để bảo vệ?', topK: 3 })
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].serverId, 'note-1')
  assert.equal(result.sources[0].number, 1)
  assert.match(result.answer, /\[1\]/)
  assert.doesNotMatch(result.answer, /\[9\]/)
  assert.ok(store.requestedUserIds.every(id => id === 42))
  assert.equal(store.cache.size, 2)
  assert.equal(calls.filter(call => call.url.endsWith('/api/embed')).length, 2)
})

test('embedding đã cache đúng version/hash/model không bị tạo lại', async () => {
  const notes = [note()]
  const store = memoryStore(notes)
  let embedCalls = 0
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (String(url).endsWith('/api/embed')) {
      embedCalls++
      return { ok: true, json: async () => ({ embeddings: body.input.map(() => [1, 0]) }) }
    }
    return { ok: true, json: async () => ({ response: 'Câu trả lời [1]' }) }
  }
  await answerQuestion({ store, userId: 1, question: 'bảo vệ' })
  await answerQuestion({ store, userId: 1, question: 'slide' })
  // Lần đầu: note + query; lần sau chỉ query.
  assert.equal(embedCalls, 3)
})

test('không có ghi chú thì không gọi Ollama', async () => {
  const store = memoryStore([])
  globalThis.fetch = async () => { throw new Error('không được gọi') }
  const result = await answerQuestion({ store, userId: 1, question: 'Có gì?' })
  assert.equal(result.sources.length, 0)
  assert.match(result.answer, /chưa có ghi chú/i)
})

test('Ollama không kết nối được trả KnowledgeFailure rõ nguyên nhân', async () => {
  const store = memoryStore([note()])
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  await assert.rejects(
    answerQuestion({ store, userId: 1, question: 'bảo vệ' }),
    error => error instanceof KnowledgeFailure && error.code === 'unreachable'
  )
})

