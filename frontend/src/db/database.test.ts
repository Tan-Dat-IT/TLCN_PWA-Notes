import Dexie from 'dexie'
import { describe, it, expect } from 'vitest'
import { NotesDB } from './database'

describe('NotesDB migration v5', () => {
  it('nâng cấp checkbox cũ và bản xung đột mà không đoán lịch sử hoặc mất dữ liệu', async () => {
    const name = `kanban-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(4).stores({ notes: '++id, tag, updatedAt, synced, deleted, serverId, kind, dueAt', meta: 'key' })
    await legacy.table('notes').bulkAdd([
      { id: 1, kind: 'task', title: 'Chưa bắt đầu', done: false, synced: 0, updatedAt: 1, startAt: null, completedAt: null,
        conflict: { kind: 'task', done: true, completedAt: 50 } },
      { id: 2, kind: 'task', title: 'Xong', done: true, synced: 1, updatedAt: 2, completedAt: null },
      { id: 3, kind: 'note', title: 'Ghi chú', done: false, synced: 1, updatedAt: 3 }
    ])
    await legacy.table('meta').put({ key: 'syncCursor', value: '42' })
    legacy.close()
    const upgraded = new NotesDB(name)
    try {
      await upgraded.open()
      expect(await upgraded.notes.get(1)).toMatchObject({ title: 'Chưa bắt đầu', status: 'todo', synced: 0, startAt: null, completedAt: null,
        conflict: { status: 'done', completedAt: 50 } })
      expect(await upgraded.notes.get(2)).toMatchObject({ status: 'done', completedAt: null, synced: 1 })
      expect(await upgraded.notes.get(3)).toMatchObject({ status: null })
      expect(await upgraded.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '42' })
    } finally { upgraded.close(); await Dexie.delete(name) }
  })
})
