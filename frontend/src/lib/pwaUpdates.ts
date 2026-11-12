const UPDATE_INTERVAL = 60_000

// Đăng ký bằng API native để kiểm soát cả việc nhận SW mới lẫn tải lại trang.
// Chỉ thay app shell; không xóa IndexedDB hoặc hàng đợi đồng bộ công việc.
export function registerPwaUpdates(reload = () => window.location.reload()) {
  if (!('serviceWorker' in navigator)) return () => {}

  const workers = navigator.serviceWorker
  let controller = workers.controller
  let registration: ServiceWorkerRegistration | undefined
  let stopped = false
  let checking = false
  let updateReady = false
  let reloading = false

  const observer = new MutationObserver(() => tryReload())

  function tryReload() {
    if (stopped || !updateReady || reloading || document.visibilityState !== 'visible') return
    // Include the AI prompt, which persists in App even after navigating away.
    const editing = [...document.querySelectorAll('form, dialog[open], [role="dialog"], [role="alertdialog"], [data-draft-active="true"]')]
      .some(element => !element.closest('dialog:not([open]), [hidden], [aria-hidden="true"]'))
    if (editing) return
    reloading = true
    observer.disconnect()
    reload()
  }

  async function checkForUpdate() {
    if (stopped || checking || !registration || registration.installing ||
      !navigator.onLine || document.visibilityState !== 'visible') return
    checking = true
    try { await registration.update() }
    catch { /* Máy chủ chưa lên: giữ nguyên bản offline và thử lại sau. */ }
    finally { checking = false }
  }

  function controllerChanged() {
    const previous = controller
    controller = workers.controller
    // Lần cài đầu chỉ nhận quyền điều khiển, không cần reload.
    if (!previous || !controller || previous === controller || updateReady) return
    updateReady = true
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'open', 'hidden', 'aria-hidden', 'data-draft-active'] })
    tryReload()
  }

  function resume() {
    tryReload()
    void checkForUpdate()
  }

  workers.addEventListener('controllerchange', controllerChanged)
  window.addEventListener('focus', resume)
  window.addEventListener('online', resume)
  document.addEventListener('visibilitychange', resume)
  const timer = window.setInterval(checkForUpdate, UPDATE_INTERVAL)
  const base = import.meta.env.BASE_URL
  void workers.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .then(value => {
      if (stopped) return
      registration = value
      void checkForUpdate()
    })
    .catch(error => console.warn('Không đăng ký được Service Worker:', error))

  return () => {
    stopped = true
    window.clearInterval(timer)
    observer.disconnect()
    workers.removeEventListener('controllerchange', controllerChanged)
    window.removeEventListener('focus', resume)
    window.removeEventListener('online', resume)
    document.removeEventListener('visibilitychange', resume)
  }
}
