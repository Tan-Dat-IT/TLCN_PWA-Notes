import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { db } from '../db/database'
import { useNotes } from './useNotes'

beforeEach(async () => { await db.notes.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('useNotes', () => {
  it('addNote lưu ghi chú mới và xuất hiện trong danh sách active', async () => {
    const { result } = renderHook(() => useNotes(null, 'active'))
    await act(async () => {
      await result.current.addNote({ title: 'Việc A', content: '', tag: '', kind: 'note', startAt: null, dueAt: null })
    })
    await waitFor(() => expect(result.current.notes).toHaveLength(1))
    expect(result.current.notes[0].title).toBe('Việc A')
    expect(result.current.notes[0].synced).toBe(0)
  })

  it('addNote từ chối tiêu đề rỗng', async () => {
    const { result } = renderHook(() => useNotes(null, 'active'))
    await expect(result.current.addNote({ title: '   ', content: '', tag: '', kind: 'note', startAt: null, dueAt: null }))
      .rejects.toThrow()
  })

  it('addNote từ chối lịch không hợp lệ (dueAt trước startAt)', async () => {
    const { result } = renderHook(() => useNotes(null, 'active'))
    await expect(result.current.addNote({ title: 'x', content: '', tag: '', kind: 'task', startAt: 2000, dueAt: 1000 }))
      .rejects.toThrow()
  })

  it('toggleDone chỉ hoạt động với task, không hoạt động với note', async () => {
    const { result } = renderHook(() => useNotes(null, 'active'))
    await act(async () => {
      await result.current.addNote({ title: 'Việc B', content: '', tag: '', kind: 'task', startAt: null, dueAt: null })
    })
    await waitFor(() => expect(result.current.notes).toHaveLength(1))
    const note = result.current.notes[0]
    await act(async () => { await result.current.toggleDone(note) })
    await waitFor(() => expect(result.current.notes[0].done).toBe(true))
    expect(result.current.notes[0].completedAt).not.toBeNull()
  })

  it('deleteNote đưa ghi chú vào mục trash, restoreNote đưa lại vào active', async () => {
    const { result } = renderHook(() => useNotes(null, 'active'))
    await act(async () => {
      await result.current.addNote({ title: 'Việc C', content: '', tag: '', kind: 'note', startAt: null, dueAt: null })
    })
    await waitFor(() => expect(result.current.notes).toHaveLength(1))
    const id = result.current.notes[0].id!
    await act(async () => { await result.current.deleteNote(id) })
    await waitFor(() => expect(result.current.notes).toHaveLength(0))

    const trash = renderHook(() => useNotes(null, 'trash'))
    await waitFor(() => expect(trash.result.current.notes).toHaveLength(1))

    await act(async () => { await result.current.restoreNote(id) })
    await waitFor(() => expect(result.current.notes).toHaveLength(1))
  })

  it('đổi kind từ task sang note tự đặt lại done=false', async () => {
    const { result } = renderHook(() => useNotes(null, 'active'))
    await act(async () => {
      await result.current.addNote({ title: 'Việc D', content: '', tag: '', kind: 'task', startAt: null, dueAt: null })
    })
    await waitFor(() => expect(result.current.notes).toHaveLength(1))
    const id = result.current.notes[0].id!
    await act(async () => { await result.current.toggleDone(result.current.notes[0]) })
    await waitFor(() => expect(result.current.notes[0].done).toBe(true))
    await act(async () => {
      await result.current.updateNote(id, { title: 'Việc D', content: '', tag: '', kind: 'note', startAt: null, dueAt: null })
    })
    await waitFor(() => expect(result.current.notes[0].done).toBe(false))
  })

  it('tách ghi chú xung đột khỏi mục Chờ đồng bộ', async () => {
    await db.notes.add({
      serverId: 'x', kind: 'note', createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
      title: 'Bản local', content: '', tag: 'chung', done: false, updatedAt: 2, synced: 0, deleted: 0, baseVersion: 1,
      conflict: { serverId: 'x', kind: 'note', createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
        title: 'Bản server', content: '', tag: 'chung', done: false, updatedAt: 3, deleted: 0, version: 2 }
    })
    const pending = renderHook(() => useNotes(null, 'pending'))
    await waitFor(() => expect(pending.result.current.counts.conflict).toBe(1))
    expect(pending.result.current.counts.pending).toBe(0)
    expect(pending.result.current.notes).toHaveLength(0)
  })

  it('chỉ trả tag tồn tại trong loại nội dung đang chọn', async () => {
    const common = {
      createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null,
      content: '', done: false, updatedAt: 1, synced: 1 as const, deleted: 0 as const
    }
    await db.notes.bulkAdd([
      { ...common, serverId: 'note-1', kind: 'note', title: 'Ghi chú AI', tag: 'ai' },
      { ...common, serverId: 'task-1', kind: 'task', title: 'Việc báo cáo', tag: 'bao-cao' },
      { ...common, serverId: 'task-2', kind: 'task', title: 'Việc chung', tag: 'chung' }
    ])

    const tasks = renderHook(() => useNotes(null, 'active', 'task'))
    await waitFor(() => expect(tasks.result.current.notes).toHaveLength(2))
    expect(tasks.result.current.allTags).toEqual(['bao-cao', 'chung'])
    expect(tasks.result.current.notes.every(note => note.kind === 'task')).toBe(true)
  })

  it('lọc Cần làm và Đang làm theo workflow, quá hạn là điều kiện độc lập', async () => {
    const now = Date.now()
    const common = {
      createdAt: now, startAt: null, completedAt: null, deletedAt: null,
      content: '', tag: 'chung', done: false, updatedAt: now, synced: 1 as const, deleted: 0 as const
    }
    await db.notes.bulkAdd([
      { ...common, serverId: 'doing', kind: 'task', status: 'doing', title: 'Đang làm', dueAt: now - 60_000 },
      { ...common, serverId: 'overdue', kind: 'task', status: 'todo', title: 'Trễ hạn', dueAt: now - 60_000 }
    ])

    const todo = renderHook(() => useNotes(null, 'todo'))
    const doing = renderHook(() => useNotes(null, 'doing'))
    const overdue = renderHook(() => useNotes(null, 'overdue'))
    await waitFor(() => expect(doing.result.current.notes).toHaveLength(1))
    await waitFor(() => expect(todo.result.current.notes).toHaveLength(1))
    await waitFor(() => expect(overdue.result.current.notes).toHaveLength(2))
    expect(doing.result.current.notes[0].title).toBe('Đang làm')
    expect(todo.result.current.notes[0].title).toBe('Trễ hạn')
    expect(doing.result.current.counts.todo).toBe(1)
    expect(doing.result.current.counts.doing).toBe(1)
    expect(doing.result.current.counts.overdue).toBe(2)
  })

  it('chuyển cột offline, lưu bền sau mở lại DB, không thay lịch đã đặt', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { result } = renderHook(() => useNotes(null))
    await act(async () => { await result.current.addNote({ title: 'Offline', content: '', tag: '', kind: 'task', startAt: null, dueAt: 1000 }) })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const note = (await db.notes.toArray())[0]
    await act(async () => { await result.current.moveTask(note.id!, 'doing') })
    expect(await db.notes.get(note.id!)).toMatchObject({ status: 'doing', done: false, synced: 0, startAt: null, dueAt: 1000, completedAt: null })
    db.close()
    await db.open()
    expect(await db.notes.get(note.id!)).toMatchObject({ status: 'doing' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('hoàn thành ghi timestamp, mở lại xóa timestamp; thả vào cùng cột không ghi lại', async () => {
    const { result } = renderHook(() => useNotes(null))
    await act(async () => { await result.current.addNote({ title: 'Tiến độ', content: '', tag: '', kind: 'task', startAt: 10, dueAt: 20 }) })
    const id = (await db.notes.toArray())[0].id!
    await act(async () => { await result.current.moveTask(id, 'done') })
    const completed = (await db.notes.get(id))!
    expect(completed.done).toBe(true)
    expect(completed.status).toBe('done')
    expect(completed.completedAt).toEqual(expect.any(Number))
    await db.notes.update(id, { synced: 1 })
    await act(async () => { await result.current.moveTask(id, 'done') })
    expect(await db.notes.get(id)).toMatchObject({ synced: 1, completedAt: completed.completedAt, updatedAt: completed.updatedAt })
    await act(async () => { await result.current.moveTask(id, 'doing') })
    expect(await db.notes.get(id)).toMatchObject({ status: 'doing', done: false, completedAt: null, startAt: 10, dueAt: 20 })
    await act(async () => { await result.current.toggleDone((await db.notes.get(id))!) })
    expect(await db.notes.get(id)).toMatchObject({ status: 'done', done: true })
    await act(async () => { await result.current.toggleDone((await db.notes.get(id))!) })
    expect(await db.notes.get(id)).toMatchObject({ status: 'todo', done: false, completedAt: null })
  })

  it('sửa tiêu đề giữ bước Đang làm; đổi thành ghi chú xóa workflow', async () => {
    const { result } = renderHook(() => useNotes(null))
    await act(async () => { await result.current.addNote({ title: 'A', content: '', tag: '', kind: 'task', status: 'doing', startAt: null, dueAt: null }) })
    const id = (await db.notes.toArray())[0].id!
    await act(async () => { await result.current.updateNote(id, { title: 'B' }) })
    expect(await db.notes.get(id)).toMatchObject({ title: 'B', status: 'doing', done: false })
    // Optional status bị bỏ trống không được biến việc Đang làm thành Cần làm.
    await act(async () => { await result.current.updateNote(id, { status: undefined, content: 'Bổ sung' }) })
    expect(await db.notes.get(id)).toMatchObject({ status: 'doing', content: 'Bổ sung' })
    await act(async () => { await result.current.updateNote(id, { status: null }) })
    expect(await db.notes.get(id)).toMatchObject({ status: 'doing' })
    await act(async () => { await result.current.updateNote(id, { kind: 'note' }) })
    expect(await db.notes.get(id)).toMatchObject({ status: null, done: false, completedAt: null })
    await expect(result.current.moveTask(id, 'doing')).rejects.toThrow()
    await act(async () => { await result.current.updateNote(id, { kind: 'task' }) })
    expect(await db.notes.get(id)).toMatchObject({ status: 'todo', done: false })
  })
})
