import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { db } from '../db/database'
import { useNotes } from './useNotes'

beforeEach(async () => { await db.notes.clear() })

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

  it('tách Đang thực hiện và Đang quá hạn thành hai nhóm không chồng lặp', async () => {
    const now = Date.now()
    const common = {
      createdAt: now, startAt: null, completedAt: null, deletedAt: null,
      content: '', tag: 'chung', done: false, updatedAt: now, synced: 1 as const, deleted: 0 as const
    }
    await db.notes.bulkAdd([
      { ...common, serverId: 'doing', kind: 'task', title: 'Đang làm', dueAt: now + 60_000 },
      { ...common, serverId: 'overdue', kind: 'task', title: 'Trễ hạn', dueAt: now - 60_000 }
    ])

    const doing = renderHook(() => useNotes(null, 'todo'))
    const overdue = renderHook(() => useNotes(null, 'overdue'))
    await waitFor(() => expect(doing.result.current.notes).toHaveLength(1))
    await waitFor(() => expect(overdue.result.current.notes).toHaveLength(1))
    expect(doing.result.current.notes[0].title).toBe('Đang làm')
    expect(overdue.result.current.notes[0].title).toBe('Trễ hạn')
    expect(doing.result.current.counts.todo).toBe(1)
    expect(doing.result.current.counts.overdue).toBe(1)
  })
})
