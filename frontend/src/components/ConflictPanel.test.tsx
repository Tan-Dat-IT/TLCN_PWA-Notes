import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ConflictPanel from './ConflictPanel'
import type { Note, ServerNote } from '../db/database'

const local: Note = { id: 1, serverId: 'x', title: 'Bản của tôi', content: 'giống', tag: 'chung', kind: 'task',
  createdAt: 1, startAt: null, dueAt: null, completedAt: null, deletedAt: null, done: false,
  updatedAt: 2, synced: 0, deleted: 0, baseVersion: 1, conflict: null }
const server: ServerNote = { serverId: 'x', title: 'Bản server', content: 'giống', tag: 'chung', kind: 'task',
  createdAt: 1, startAt: null, dueAt: null, completedAt: 5, deletedAt: null, done: true,
  updatedAt: 3, deleted: 0, version: 2 }

describe('ConflictPanel', () => {
  it('chỉ liệt kê các trường khác nhau giữa 2 bản', () => {
    render(<ConflictPanel note={local} server={server} onResolve={vi.fn()} />)
    expect(screen.getByRole('rowheader', { name: 'Tiêu đề' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'Hoàn thành' })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: 'Nội dung' })).toBeNull()
    expect(screen.getByText('Bản của tôi')).toBeTruthy()
    expect(screen.getByText('Bản server')).toBeTruthy()
  })

  it('báo nội dung giống nhau khi không có trường nào khác', () => {
    render(<ConflictPanel note={local} server={{ ...server, title: local.title, done: false, completedAt: null }} onResolve={vi.fn()} />)
    expect(screen.getByText(/giống nhau/)).toBeTruthy()
  })

  it.each([
    ['Giữ bản của tôi', 'mine'], ['Dùng bản trên server', 'server'], ['Giữ cả hai', 'both']
  ] as const)('nút "%s" gọi onResolve("%s")', async (label, choice) => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    render(<ConflictPanel note={local} server={server} onResolve={onResolve} />)
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(choice))
  })

  it('hiện lỗi khi lưu lựa chọn thất bại', async () => {
    render(<ConflictPanel note={local} server={server} onResolve={vi.fn().mockRejectedValue(new Error('x'))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Giữ cả hai' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
