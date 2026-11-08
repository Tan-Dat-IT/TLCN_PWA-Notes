import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import DialogFrame, { useDialogController } from './DialogFrame'

function Host() {
  const { dialogRef, open, restoreFocus } = useDialogController()
  return <div className="sidebar-tools">
    <button type="button" onClick={open}>Mở thống kê</button>
    <DialogFrame dialogRef={dialogRef} onClose={restoreFocus} size="medium"
      eyebrow="TỔNG QUAN" title="Thống kê" titleId="dialog-test-title">
      <p>Nội dung kiểm tra</p>
    </DialogFrame>
  </div>
}

describe('shared dialog frame', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  })

  it('renders outside sidebar styles and restores focus after closing', () => {
    render(<Host />)
    const trigger = screen.getByRole('button', { name: 'Mở thống kê' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Thống kê' }) as HTMLDialogElement
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.querySelector('.ui-dialog-header')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Đóng Thống kê' }))
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('closes with Escape cancellation and restores focus', () => {
    render(<Host />)
    const trigger = screen.getByRole('button', { name: 'Mở thống kê' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Thống kê' }) as HTMLDialogElement
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })
})
