import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeTheme, useThemePreference } from './theme'

describe('theme preference', () => {
  let prefersDark = false
  let onSystemChange: (() => void) | null = null

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    prefersDark = false
    onSystemChange = null
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        get matches() { return prefersDark },
        addEventListener: (_event: string, listener: () => void) => { onSystemChange = listener },
        removeEventListener: () => { onSystemChange = null }
      }))
    })
  })

  it('defaults to system and follows a change in system appearance', () => {
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.preference).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    act(() => { prefersDark = true; onSystemChange?.() })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists a manual choice and ignores subsequent system changes', () => {
    const { result } = renderHook(() => useThemePreference())
    act(() => result.current.changePreference('dark'))
    expect(localStorage.getItem('pwa-notes-theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    act(() => { prefersDark = false; onSystemChange?.() })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('initializes the saved appearance before mounting', () => {
    localStorage.setItem('pwa-notes-theme', 'dark')
    initializeTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('keeps mounted controls in sync and follows another tab', () => {
    const first = renderHook(() => useThemePreference())
    const second = renderHook(() => useThemePreference())
    act(() => first.result.current.changePreference('dark'))
    expect(second.result.current.preference).toBe('dark')
    act(() => {
      localStorage.setItem('pwa-notes-theme', 'light')
      window.dispatchEvent(new StorageEvent('storage', { key: 'pwa-notes-theme', newValue: 'light' }))
    })
    expect(first.result.current.preference).toBe('light')
    expect(second.result.current.preference).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies a choice even when browser storage is blocked', () => {
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useThemePreference())
    act(() => result.current.changePreference('dark'))
    expect(result.current.preference).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    setter.mockRestore()
  })
})
