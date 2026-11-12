import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export type DialogSize = 'small' | 'reminder' | 'medium' | 'large'

export function useDialogController() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  function open() {
    if (dialogRef.current?.open) return
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.showModal()
  }

  function close() { dialogRef.current?.close() }
  function restoreFocus() { openerRef.current?.focus() }

  return { dialogRef, open, close, restoreFocus }
}

interface Props {
  dialogRef: React.RefObject<HTMLDialogElement>
  onClose: () => void
  size: DialogSize
  eyebrow: string
  title: string
  titleId: string
  description?: string
  children: ReactNode
}

export default function DialogFrame({ dialogRef, onClose, size, eyebrow, title, titleId, description, children }: Props) {
  return createPortal(
    <dialog ref={dialogRef} className={`ui-dialog ui-dialog--${size}`} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); dialogRef.current?.close() }} onClose={onClose}>
      <header className="ui-dialog-header">
        <div className="ui-dialog-heading">
          <p className="ui-dialog-eyebrow">{eyebrow}</p>
          <h2 id={titleId}>{title}</h2>
          {description && <p className="ui-dialog-description">{description}</p>}
        </div>
        <button type="button" className="ui-dialog-close" aria-label={`Đóng ${title}`} onClick={() => dialogRef.current?.close()}>
          <X size={19} aria-hidden="true" />
        </button>
      </header>
      <div className="ui-dialog-body">{children}</div>
    </dialog>,
    document.body
  )
}
