import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sql from 'mssql'
import { getPool, closeDatabase, upsertNote, getNote } from './store.js'

// RUN_SQL_TESTS=1: chạy với SQL thật đã migrate; mọi bản ghi thử đều rollback.
test('SQL: đồng bộ status, retry và xung đột không làm mất trạng thái doing', {
  skip: process.env.RUN_SQL_TESTS !== '1'
}, async () => {
  const pool = await getPool()
  const originalRequest = pool.request
  const transaction = new sql.Transaction(pool)
  let active = false
  try {
    const { recordset } = await pool.request().query('SELECT TOP (1) Id FROM dbo.Users ORDER BY Id')
    assert.ok(recordset.length, 'Cần ít nhất một tài khoản trong database kiểm thử')
    const userId = recordset[0].Id
    await transaction.begin()
    active = true
    transaction.on('rollback', () => { active = false })
    // Giữ toàn bộ request của store và migration trong giao dịch thử này.
    pool.request = () => transaction.request()
    const migration = await readFile(new URL('../migrations/014_notes_task_status.sql', import.meta.url), 'utf8')
    await pool.request().batch(migration)

    const note = {
      id: 1, serverId: `status-test-${randomUUID()}`, title: 'Status regression test',
      content: '', tag: 'test', kind: 'task', status: 'todo', done: false,
      deleted: 0, updatedAt: 1000, createdAt: 1000, startAt: null, dueAt: null,
      completedAt: null, deletedAt: null, baseVersion: null
    }
    assert.deepEqual(await upsertNote(note, userId), { status: 'applied', version: 1 })
    assert.equal((await getNote(note.serverId, userId)).status, 'todo')

    const doing = { ...note, status: 'doing', baseVersion: 1 }
    assert.deepEqual(await upsertNote(doing, userId), { status: 'applied', version: 2 })
    assert.deepEqual(await upsertNote(doing, userId), { status: 'applied', version: 2 })
    // Cùng Done=false nhưng status khác: phải báo xung đột, không coi là retry.
    const conflict = await upsertNote({ ...note, baseVersion: 1 }, userId)
    assert.equal(conflict.status, 'conflict')
    assert.equal(conflict.server.status, 'doing')

    await pool.request().batch(migration)
    assert.equal((await getNote(note.serverId, userId)).status, 'doing')

    const done = { ...doing, status: 'done', done: true, completedAt: 1100, baseVersion: 2 }
    assert.deepEqual(await upsertNote(done, userId), { status: 'applied', version: 3 })
    assert.equal((await getNote(note.serverId, userId)).done, true)
    assert.equal((await getNote(note.serverId, userId)).status, 'done')

    const reopened = { ...note, baseVersion: 3 }
    assert.deepEqual(await upsertNote(reopened, userId), { status: 'applied', version: 4 })
    const converted = { ...reopened, kind: 'note', status: null, baseVersion: 4 }
    assert.deepEqual(await upsertNote(converted, userId), { status: 'applied', version: 5 })
    assert.equal((await getNote(note.serverId, userId)).status, null)
    assert.deepEqual(await upsertNote(converted, userId), { status: 'applied', version: 5 })

    const plainNote = { ...note, serverId: `status-test-${randomUUID()}`, kind: 'note', status: null }
    assert.deepEqual(await upsertNote(plainNote, userId), { status: 'applied', version: 1 })
    assert.equal((await getNote(plainNote.serverId, userId)).status, null)
  } finally {
    pool.request = originalRequest
    try { if (active) await transaction.rollback() }
    finally { await closeDatabase() }
  }
})
