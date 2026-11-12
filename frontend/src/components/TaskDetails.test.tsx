import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TaskDetails from './TaskDetails'
import type { Note } from '../db/database'

const task: Note = { id:1, serverId:'detail-test', kind:'task', title:'Rà soát báo cáo', content:'Nội dung chi tiết', tag:'hoc-tap',
  done:false, status:'doing', createdAt:null, updatedAt:20, startAt:null, dueAt:100, completedAt:null, deletedAt:null,
  deleted:0, synced:1, baseVersion:1 }
const handlers = () => ({ onMove:vi.fn().mockResolvedValue(undefined), onEdit:vi.fn(), onDelete:vi.fn().mockResolvedValue(undefined),
  onRestore:vi.fn().mockResolvedValue(undefined), onResolve:vi.fn().mockResolvedValue(undefined) })

describe('TaskDetails', () => {
  it('shows time and status for an overdue task and saves a status change', async () => {
    const callbacks = handlers()
    render(<TaskDetails note={task} now={200} {...callbacks} />)
    expect(screen.getByText('Quá hạn')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name:'Bước xử lý công việc' }), { target:{value:'done'} })
    await waitFor(() => expect(callbacks.onMove).toHaveBeenCalledWith(1,'done'))
    fireEvent.click(screen.getByRole('button', { name:'Chỉnh sửa' }))
    expect(callbacks.onEdit).toHaveBeenCalledOnce()
  })

  it('keeps a failed delete open and lets the user retry', async () => {
    const callbacks = handlers()
    callbacks.onDelete.mockRejectedValueOnce(new Error('disk full'))
    render(<TaskDetails note={task} now={200} {...callbacks} />)
    fireEvent.click(screen.getByRole('button', { name:'Xóa' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(task.content)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name:'Xóa' }))
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('omits empty schedule and task controls for an ordinary note', () => {
    render(<TaskDetails note={{...task, kind:'note', status:null, dueAt:null, synced:0}} now={200} {...handlers()} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('region', {name:'Thời gian'})).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Chờ đồng bộ')
    expect(screen.getByText('Chưa có thông tin')).toBeTruthy()
  })

  it('does not invent completion history and offers restore for deleted content', async () => {
    const callbacks = handlers()
    const { rerender } = render(<TaskDetails note={{...task, status:'done', done:true, completedAt:null}} now={200} {...callbacks} />)
    expect(screen.queryByText('Hoàn thành trễ')).toBeNull()
    expect(screen.getAllByText('Chưa có thông tin').length).toBeGreaterThan(0)
    rerender(<TaskDetails note={{...task, deleted:1, deletedAt:150}} now={200} {...callbacks} />)
    expect(screen.queryByRole('button', {name:'Xóa'})).toBeNull()
    fireEvent.click(screen.getByRole('button', {name:'Khôi phục'}))
    await waitFor(() => expect(callbacks.onRestore).toHaveBeenCalledWith(1))
  })
})
