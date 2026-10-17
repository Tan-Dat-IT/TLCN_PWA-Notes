import { test } from 'node:test'
import assert from 'node:assert/strict'

test('sendResetPasswordEmail ném MailerNotConfigured khi thiếu biến môi trường SMTP', async () => {
  delete process.env.SMTP_HOST
  delete process.env.SMTP_USER
  delete process.env.SMTP_PASS
  const { sendResetPasswordEmail, MailerNotConfigured } = await import('./mailer.js')
  await assert.rejects(() => sendResetPasswordEmail('a@b.com', 'http://x'), MailerNotConfigured)
})
