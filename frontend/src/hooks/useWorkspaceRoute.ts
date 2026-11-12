import { useEffect, useState } from 'react'
import { readRoute, routeHash, type Page } from '../lib/navigation'
import type { DeadlineFilter } from '../lib/stats'

export function useWorkspaceRoute() {
  const [route, setRoute] = useState(() => readRoute(window.location.hash))
  useEffect(() => {
    const update = () => {
      const next = readRoute(window.location.hash)
      const canonical = routeHash(next)
      if (window.location.hash !== canonical) window.history.replaceState(null, '', canonical)
      setRoute(next)
    }
    update()
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  function navigate(page: Page, deadline: DeadlineFilter = 'all') {
    const next = { page, deadline }
    setRoute(next)
    const hash = routeHash(next)
    if (window.location.hash !== hash) window.location.hash = hash
  }
  return { ...route, navigate }
}
