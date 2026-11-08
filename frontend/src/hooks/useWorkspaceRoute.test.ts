import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readRoute } from '../lib/navigation'
import { useWorkspaceRoute } from './useWorkspaceRoute'

describe('hash routes', () => {
  it('normalizes empty or unknown pages without dropping the password reset query', async () => {
    window.history.replaceState(null, '', '/?resetToken=keep-me#/unknown')
    const { result } = renderHook(useWorkspaceRoute)
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'))
    expect(window.location.search).toBe('?resetToken=keep-me')
    expect(result.current.page).toBe('dashboard')
  })
  it('preserves a valid task filter and ignores it on other pages', () => {
    expect(readRoute('#/tasks?deadline=overdue')).toEqual({ page: 'tasks', deadline: 'overdue' })
    expect(readRoute('#/notes?deadline=week')).toEqual({ page: 'notes', deadline: 'all' })
    expect(readRoute('#/tasks?deadline=invalid')).toEqual({ page: 'tasks', deadline: 'all' })
    expect(readRoute('#/plan?deadline=week')).toEqual({ page: 'plan', deadline: 'all' })
  })
  it('handles navigation, browser Back and Forward', async () => {
    window.history.replaceState(null, '', '/#/dashboard')
    const { result } = renderHook(useWorkspaceRoute)
    act(() => result.current.navigate('tasks', 'week'))
    await waitFor(() => expect(result.current.page).toBe('tasks'))
    await act(async () => { window.history.back() })
    await waitFor(() => expect(result.current.page).toBe('dashboard'))
    await act(async () => { window.history.forward() })
    await waitFor(() => expect(result.current.deadline).toBe('week'))
  })
})
