import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPwaUpdates } from './pwaUpdates'

class Workers extends EventTarget {
  controller: ServiceWorker | null = {} as ServiceWorker
  registration = { installing: null, update: vi.fn().mockResolvedValue(undefined) }
  register = vi.fn().mockResolvedValue(this.registration)

  activate() {
    this.controller = {} as ServiceWorker
    this.dispatchEvent(new Event('controllerchange'))
  }
}

describe('PWA app updates', () => {
  let workers: Workers
  let network: { serviceWorker: Workers; onLine: boolean }
  let stop: (() => void) | undefined
  const flush = async () => { await Promise.resolve(); await Promise.resolve() }

  beforeEach(() => {
    vi.useFakeTimers()
    workers = new Workers()
    network = { serviceWorker: workers, onLine: true }
    vi.stubGlobal('navigator', network)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('registers once without using HTTP cache for the worker or its imports', async () => {
    stop = registerPwaUpdates(vi.fn())
    await flush()
    expect(workers.register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/', updateViaCache: 'none' })
    expect(workers.registration.update).toHaveBeenCalledTimes(1)
  })

  it('does not reload on first install, but reloads once when a new worker takes control', () => {
    workers.controller = null
    const reload = vi.fn()
    stop = registerPwaUpdates(reload)
    workers.activate()
    expect(reload).not.toHaveBeenCalled()
    workers.activate()
    workers.activate()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it.each(['form', 'dialog', 'alertdialog', 'native dialog'])('keeps an open %s intact and updates after it closes', async kind => {
    const editor = document.createElement(kind === 'form' ? 'form' : kind === 'native dialog' ? 'dialog' : 'section')
    if (kind === 'native dialog') editor.setAttribute('open', '')
    else if (kind !== 'form') editor.setAttribute('role', kind)
    const input = document.createElement('input')
    input.value = 'Nội dung đang gõ, chưa lưu'
    editor.append(input)
    document.body.append(editor)
    const reload = vi.fn()
    stop = registerPwaUpdates(reload)

    workers.activate()
    expect(reload).not.toHaveBeenCalled()
    expect(input.value).toBe('Nội dung đang gõ, chưa lưu')
    if (kind === 'native dialog') editor.removeAttribute('open')
    else editor.remove()
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('does not let forms in closed account dialogs block updates indefinitely', () => {
    const dialog = document.createElement('dialog')
    dialog.append(document.createElement('form'))
    document.body.append(dialog)
    const reload = vi.fn()
    stop = registerPwaUpdates(reload)
    workers.activate()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('preserves an unsaved AI prompt across navigation until it is cleared or saved', async () => {
    const app = document.createElement('main')
    app.dataset.draftActive = 'true'
    const prompt = document.createElement('textarea')
    prompt.value = 'Công việc đang nhờ AI phân tích'
    app.append(prompt)
    document.body.append(app)
    const reload = vi.fn()
    stop = registerPwaUpdates(reload)
    workers.activate()
    expect(reload).not.toHaveBeenCalled()
    prompt.remove() // Navigating away keeps the prompt in the parent state.
    await flush()
    window.dispatchEvent(new Event('focus'))
    expect(reload).not.toHaveBeenCalled()
    app.removeAttribute('data-draft-active')
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('checks again on focus, reconnect and periodically, but skips offline or hidden tabs', async () => {
    stop = registerPwaUpdates(vi.fn())
    await flush()
    const update = workers.registration.update
    update.mockClear()
    network.onLine = false
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(update).not.toHaveBeenCalled()

    network.onLine = true
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(update).toHaveBeenCalledTimes(2)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('waits for a hidden tab to become visible before reloading', () => {
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const reload = vi.fn()
    stop = registerPwaUpdates(reload)
    workers.activate()
    expect(reload).not.toHaveBeenCalled()
    visible.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('keeps the app running if update checks fail and retries later', async () => {
    workers.registration.update.mockRejectedValue(new TypeError('Backend offline'))
    const reload = vi.fn()
    stop = registerPwaUpdates(reload)
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(workers.registration.update).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('removes listeners and pending reload work on cleanup', async () => {
    document.body.append(document.createElement('form'))
    const reload = vi.fn()
    stop = registerPwaUpdates(reload)
    await flush()
    workers.activate()
    stop()
    workers.registration.update.mockClear()
    document.body.replaceChildren()
    window.dispatchEvent(new Event('focus'))
    workers.activate()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reload).not.toHaveBeenCalled()
    expect(workers.registration.update).not.toHaveBeenCalled()
  })
})
