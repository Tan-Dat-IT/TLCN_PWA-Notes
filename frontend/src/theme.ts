import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'pwa-notes-theme'
const CHANGE_EVENT = 'notes-theme-change'

function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#111a18' : '#f7f9f8')
}

/** Apply before React mounts so a saved dark preference does not flash light. */
export function initializeTheme() { applyTheme(savedPreference()) }

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(savedPreference)

  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== STORAGE_KEY) return
      setPreference(event instanceof CustomEvent ? event.detail as ThemePreference : savedPreference())
    }
    window.addEventListener('storage', update)
    window.addEventListener(CHANGE_EVENT, update)
    return () => {
      window.removeEventListener('storage', update)
      window.removeEventListener(CHANGE_EVENT, update)
    }
  }, [])

  useEffect(() => {
    applyTheme(preference)
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = () => { if (preference === 'system') applyTheme(preference) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [preference])

  function changePreference(next: ThemePreference) {
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* Private browsing may block storage. */ }
    applyTheme(next)
    setPreference(next)
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }))
  }

  return { preference, changePreference }
}
