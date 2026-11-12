import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TaskBoard from './TaskBoard'
import type { Note } from '../db/database'

const task: Note = { id: 1, serverId: 'task-one', kind: 'task', title: 'Viết báo cáo', content: 'Nội dung chi tiết', tag: 'bao-cao',
  done: false, status: 'todo', createdAt: 10, updatedAt: 20, startAt: null, dueAt: 100, completedAt: null, deletedAt: null,
  deleted: 0, synced: 1, baseVersion: 1 }
const callbacks = () => ({ onMove: vi.fn().mockResolvedValue(undefined), onOpen: vi.fn(), onAdd: vi.fn() })
const dragData = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' })

describe('TaskBoard', () => {
  it('giữ công việc quá hạn ở cột xử lý hiện tại và mở chi tiết bằng tiêu đề', () => {
    const handlers = callbacks()
    render(<TaskBoard notes={[{ ...task, status: 'doing' }]} now={200} layout="board" {...handlers} />)
    const column = screen.getByRole('region', { name: 'Đang làm' })
    expect(within(column).getByText(/Quá hạn/)).toBeTruthy()
    fireEvent.click(within(column).getByRole('button', { name: task.title }))
    expect(handlers.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1, status: 'doing' }))
    expect(screen.queryByText(task.content)).toBeNull()
  })

  it('cho phép đổi trạng thái bằng select, không cần kéo thả', async () => {
    const handlers = callbacks()
    render(<TaskBoard notes={[task]} now={50} layout="board" {...handlers} />)
    fireEvent.change(screen.getByRole('combobox', { name: `Chuyển trạng thái ${task.title}` }), { target: { value: 'doing' } })
    await waitFor(() => expect(handlers.onMove).toHaveBeenCalledWith(1, 'doing'))
    expect(await screen.findByText(/Đã chuyển “Viết báo cáo” sang Đang làm/)).toBeTruthy()
  })

  it('thả vào cột trống gọi cùng thao tác lưu trạng thái', async () => {
    const handlers = callbacks()
    render(<TaskBoard notes={[task]} now={50} layout="board" {...handlers} />)
    const dataTransfer = dragData()
    fireEvent.dragStart(screen.getByRole('button', { name: task.title }).closest('li')!, { dataTransfer })
    const column = screen.getByRole('region', { name: 'Đang làm' })
    fireEvent.dragOver(column, { dataTransfer })
    expect(within(column).getByText('Thả công việc vào đây')).toBeTruthy()
    fireEvent.drop(column, { dataTransfer })
    await waitFor(() => expect(handlers.onMove).toHaveBeenCalledWith(1, 'doing'))
  })

  it('Escape hủy kéo và không lưu khi thả sau đó', () => {
    const handlers = callbacks()
    render(<TaskBoard notes={[task]} now={50} layout="board" {...handlers} />)
    const dataTransfer = dragData()
    fireEvent.dragStart(screen.getByRole('button', { name: task.title }).closest('li')!, { dataTransfer })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.drop(screen.getByRole('region', { name: 'Đang làm' }), { dataTransfer })
    expect(handlers.onMove).not.toHaveBeenCalled()
  })

  it('thao tác ở nút mở chi tiết không khởi động kéo thẻ cha', () => {
    const handlers = callbacks()
    render(<TaskBoard notes={[task]} now={50} layout="board" {...handlers} />)
    const title = screen.getByRole('button', { name: task.title })
    fireEvent.pointerDown(title)
    fireEvent.dragStart(title.closest('li')!, { dataTransfer: dragData() })
    fireEvent.drop(screen.getByRole('region', { name: 'Đang làm' }), { dataTransfer: dragData() })
    expect(handlers.onMove).not.toHaveBeenCalled()
  })

  it('giữ focus trên select mới sau khi cập nhật local chuyển thẻ qua cột', async () => {
    const handlers = callbacks()
    const { rerender } = render(<TaskBoard notes={[task]} now={50} layout="board" {...handlers} />)
    const select = screen.getByRole('combobox', { name: `Chuyển trạng thái ${task.title}` })
    select.focus()
    fireEvent.change(select, { target: { value: 'doing' } })
    await screen.findByText(/Đã chuyển “Viết báo cáo” sang Đang làm/)
    rerender(<TaskBoard notes={[{ ...task, status: 'doing' }]} now={50} layout="board" {...handlers} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: `Chuyển trạng thái ${task.title}` })))
  })

  it('báo lỗi ghi local và giữ công việc tại cột cũ', async () => {
    const handlers = { ...callbacks(), onMove: vi.fn().mockRejectedValue(new Error('storage unavailable')) }
    render(<TaskBoard notes={[task]} now={50} layout="board" {...handlers} />)
    fireEvent.change(screen.getByRole('combobox', { name: `Chuyển trạng thái ${task.title}` }), { target: { value: 'done' } })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Cần làm' })).getByRole('button', { name: task.title })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: `Chuyển trạng thái ${task.title}` })).toHaveProperty('value', 'todo')
  })

  it('không cho thao tác trùng trong lúc đang lưu', async () => {
    let resolveMove!: () => void
    const handlers = { ...callbacks(), onMove: vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveMove = resolve })) }
    render(<TaskBoard notes={[task]} now={50} layout="board" {...handlers} />)
    const select = screen.getByRole('combobox', { name: `Chuyển trạng thái ${task.title}` })
    fireEvent.change(select, { target: { value: 'doing' } })
    expect(select).toHaveProperty('disabled', true)
    resolveMove()
    await waitFor(() => expect(select).toHaveProperty('disabled', false))
  })

  it('lọc không có kết quả vẫn giữ đủ ba cột và có xóa bộ lọc', () => {
    const onClearFilters = vi.fn()
    render(<TaskBoard notes={[]} now={50} layout="board" isFiltered onClearFilters={onClearFilters} {...callbacks()} />)
    expect(screen.getByText('Không có công việc phù hợp')).toBeTruthy()
    expect(screen.getAllByRole('region')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }))
    expect(onClearFilters).toHaveBeenCalledOnce()
  })

  it('list view dùng cùng dữ liệu và bỏ ghi chú/đã xóa khỏi bảng', () => {
    render(<TaskBoard notes={[task, { ...task, id: 2, kind: 'note', title: 'Ghi chú' }, { ...task, id: 3, deleted: 1, title: 'Đã xóa' }]} now={50} layout="list" {...callbacks()} />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('button', { name: task.title })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ghi chú' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Đã xóa' })).toBeNull()
  })

  it('sửa nội dung không làm thay đổi thứ tự công việc trong cột', () => {
    const newer = { ...task, id: 2, serverId: 'task-two', title: 'Công việc mới', createdAt: 30 }
    const handlers = callbacks()
    const { rerender } = render(<TaskBoard notes={[task, newer]} now={50} layout="board" {...handlers} />)
    const titles = () => within(screen.getByRole('region', { name: 'Cần làm' })).getAllByRole('button')
      .filter(button => button.classList.contains('task-card-title')).map(button => button.textContent)
    expect(titles()).toEqual(['Công việc mới', 'Viết báo cáo'])
    rerender(<TaskBoard notes={[{ ...task, updatedAt: 999999 }, newer]} now={50} layout="board" {...handlers} />)
    expect(titles()).toEqual(['Công việc mới', 'Viết báo cáo'])
  })
})
