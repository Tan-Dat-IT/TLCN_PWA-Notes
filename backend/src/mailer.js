import nodemailer from 'nodemailer'

// Gửi mail qua SMTP thật (vd. Gmail) - đây là dịch vụ hạ tầng chuẩn (SMTP),
// không phải API AI cloud, nên không vi phạm nguyên tắc "AI chạy local" của
// dự án. Không cấu hình SMTP thì coi như tắt tính năng gửi mail (dùng script
// CLI reset-password làm phương án dự phòng - xem README mục 3 Bước 8).
let transporter

function getTransporter() {
  if (transporter !== undefined) return transporter
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    transporter = null
    return transporter
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  })
  return transporter
}

export class MailerNotConfigured extends Error {}

export async function sendResetPasswordEmail(to, resetUrl) {
  const client = getTransporter()
  if (!client) throw new MailerNotConfigured('Máy chủ chưa cấu hình SMTP để gửi email.')
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  await client.sendMail({
    from,
    to,
    subject: '[Notes] Đặt lại mật khẩu',
    text: `Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản Notes (Ghi chú & Công việc) gắn với email này.\n\n` +
      `Mở đường dẫn sau để đặt mật khẩu mới (hết hạn sau ít phút):\n${resetUrl}\n\n` +
      `Nếu bạn không yêu cầu, hãy bỏ qua email này - mật khẩu hiện tại vẫn giữ nguyên.`,
    html: `<p>Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản Notes (Ghi chú &amp; Công việc) gắn với email này.</p>` +
      `<p>Bấm vào đường dẫn sau để đặt mật khẩu mới (đường dẫn hết hạn sau ít phút):</p>` +
      `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
      `<p>Nếu bạn không yêu cầu, hãy bỏ qua email này - mật khẩu hiện tại vẫn giữ nguyên.</p>`
  })
}
