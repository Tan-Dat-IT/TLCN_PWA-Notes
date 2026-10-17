// Công cụ vận hành cho người có quyền truy cập trực tiếp máy chủ (không phải
// API công khai) - dùng khi một tài khoản quên mật khẩu và app không có dịch
// vụ gửi email để tự khôi phục. Chạy: npm run reset-password -- <username> <mat-khau-moi>
import { hashPassword, validUsername, validPassword } from './auth.js'
import { getPool, closeDatabase } from './store.js'
import sql from 'mssql'

const [username, newPassword] = process.argv.slice(2)

try {
  if (!validUsername(username) || !validPassword(newPassword)) {
    console.error('Dùng: npm run reset-password -- <username> <mat-khau-moi>')
    console.error('Username: 3-50 ký tự chữ/số/._- . Mật khẩu mới: tối thiểu 6 ký tự.')
    process.exitCode = 1
  } else {
    const pool = await getPool()
    const passwordHash = await hashPassword(newPassword)
    const result = await pool.request()
      .input('Username', sql.NVarChar(100), username)
      .input('PasswordHash', sql.NVarChar(255), passwordHash)
      .query('UPDATE Users SET PasswordHash = @PasswordHash, FailedLoginCount = 0, LastFailedLoginAt = NULL, LoginLockedUntil = NULL WHERE Username = @Username; SELECT @@ROWCOUNT AS affected;')
    if (result.recordset[0].affected === 0) {
      console.error(`Không tìm thấy tài khoản "${username}".`)
      process.exitCode = 1
    } else {
      console.log(`Đã đặt lại mật khẩu (và gỡ chặn đăng nhập nếu có) cho tài khoản "${username}". Báo người dùng đăng nhập lại bằng mật khẩu mới.`)
    }
  }
} catch (error) {
  console.error('Đặt lại mật khẩu thất bại:', error.code || error.name, error.message)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
