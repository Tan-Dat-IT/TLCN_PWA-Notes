import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NoteForm from './NoteForm'
import type { NoteInput } from '../db/noteFields'

const task: NoteInput = { title: 'Viết báo cáo', content: '', tag: 'học-tập', kind: 'task', status: 'doing', startAt: null, dueAt: null }

describe('NoteForm workflow', () => {
  it('editing a title keeps the current workflow', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<NoteForm initial={task} onAdd={save} />)
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Viết báo cáo chương 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Viết báo cáo chương 3', status: 'doing' })))
  })

  it('preserves completion for a legacy task without status', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<NoteForm initial={{ ...task, status: undefined, done: true }} onAdd={save} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' })))
  })

  it('clears task workflow when changing the content into a note', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<NoteForm initial={task} onAdd={save} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Loại nội dung' }), { target: { value: 'note' } })
    expect(screen.queryByRole('combobox', { name: 'Trạng thái công việc' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note', status: null })))
  })

  it('shows the AI-prefilled tag and does not overwrite it when editing the description', () => {
    render(<NoteForm initial={task} existingTags={['học-tập', 'cong-viec']} onAdd={vi.fn()} />)
    expect(screen.getByLabelText('Tag')).toHaveProperty('value', 'học-tập')
    fireEvent.change(screen.getByLabelText('Nội dung'), { target: { value: 'Nội dung đã sửa' } })
    expect(screen.getByLabelText('Tag')).toHaveProperty('value', 'học-tập')
  })

  it('selects an existing tag without saving and preserves its original spelling', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<NoteForm initial={{ ...task, tag: '' }} existingTags={['Học tập', 'cong-viec']} onAdd={save} />)
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'hoc' } })
    expect(screen.queryByRole('button', { name: 'cong-viec' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Học tập' }))
    expect(screen.getByLabelText('Tag')).toHaveProperty('value', 'Học tập')
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ tag: 'Học tập' })))
  })

  it('keeps a manually entered new tag after a storage failure', async () => {
    const save = vi.fn().mockRejectedValue(new Error('full'))
    render(<NoteForm initial={task} existingTags={[]} onAdd={save} />)
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'âm nhạc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Tag')).toHaveProperty('value', 'âm nhạc')
    expect(screen.queryByRole('group', { name: 'Tag đã dùng' })).toBeNull()
  })
})
