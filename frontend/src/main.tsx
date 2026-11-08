import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { registerPwaUpdates } from './lib/pwaUpdates'
import { initializeTheme } from './theme'

initializeTheme()
if (import.meta.env.PROD) registerPwaUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>
)
