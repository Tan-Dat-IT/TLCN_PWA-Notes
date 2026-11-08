import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  title: string
  caption?: string
  onClose: () => void
  children: ReactNode
  focusInput?: boolean
}

/** Native dialog supplies focus containment and makes the workspace inert. */
export default function WorkspacePanel({ title, caption, onClose, children, focusInput }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const titleId = useId()

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const target = focusInput
      ? dialog.current?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')
      : dialog.current?.querySelector<HTMLElement>('.workspace-panel-header button')
    target?.focus()
  }, [focusInput])

  return createPortal(
    <dialog ref={dialog} className="workspace-panel" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); close.current() }}>
      <header className="workspace-panel-header">
        <div>{caption && <p>{caption}</p>}<h2 id={titleId}>{title}</h2></div>
        <button type="button" className="quiet-icon" aria-label="Đóng bảng chi tiết" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="workspace-panel-body">{children}</div>
    </dialog>, document.body
  )
}
