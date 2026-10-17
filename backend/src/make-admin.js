// Công cụ vận hành cho người có quyền truy cập trực tiếp máy chủ (không phải
// API công khai) - tạo hoặc thăng cấp MỘT tài khoản admin GỐC (Role='root')
// duy nhất. Cố ý không có endpoint HTTP tương đương để không ai tự phong cho
// mình qua API. Chạy: npm run make-admin -- <username> <mat-khau>
// - Nếu username chưa tồn tại: tạo mới với Role='root' (Email để trống, có
//   thể tự thêm email khôi phục sau trong app).
// - Nếu username đã tồn tại: đặt lại mật khẩu theo giá trị truyền vào VÀ đặt
//   Role='root' (thăng cấp tài khoản thường/admin thường thành root).
// - Nếu ĐÃ có một tài khoản root khác (username khác): từ chối chạy - chỉ 1
//   root duy nhất trong hệ thống, tránh vô tình tạo ra 2 tài khoản toàn
//   quyền. Muốn đổi root, tự hạ tài khoản root cũ qua SQL trước.
import { hashPassword, validUsername, validPassword } from './auth.js'
import { getPool, closeDatabase } from './store.js'
import sql from 'mssql'

const [username, password] = process.argv.slice(2)

try {
  if (!validUsername(username) || !validPassword(password)) {
    console.error('Dùng: npm run make-admin -- <username> <mat-khau>')
    console.error('Username: 3-50 ký tự chữ/số/._- . Mật khẩu: tối thiểu 6 ký tự.')
    process.exitCode = 1
  } else {
    const pool = await getPool()

    const existingRoot = await pool.request()
      .input('Username', sql.NVarChar(100), username)
      .query(`SELECT Username FROM Users WHERE Role = N'root' AND Username <> @Username`)
    if (existingRoot.recordset.length > 0) {
      console.error(`Đã có tài khoản root khác là "${existingRoot.recordset[0].Username}". Hệ thống chỉ cho phép 1 tài khoản root - hạ quyền tài khoản đó trước (UPDATE Users SET Role = N'user' WHERE Username = ...) nếu thật sự muốn đổi root.`)
      process.exitCode = 1
    } else {
      const passwordHash = await hashPassword(password)
      const result = await pool.request()
        .input('Username', sql.NVarChar(100), username)
        .input('PasswordHash', sql.NVarChar(255), passwordHash)
        .input('CreatedAt', sql.BigInt, Date.now())
        .query(`
          IF EXISTS (SELECT 1 FROM Users WHERE Username = @Username)
            BEGIN
              UPDATE Users SET PasswordHash = @PasswordHash, Role = N'root', ManagedByAdminId = NULL, Disabled = 0 WHERE Username = @Username;
              SELECT N'updated' AS Action;
            END
          ELSE
            BEGIN
              INSERT INTO Users (Username, PasswordHash, DisplayName, Role, CreatedAt)
              VALUES (@Username, @PasswordHash, @Username, N'root', @CreatedAt);
              SELECT N'created' AS Action;
            END
        `)
      const action = result.recordset[0].Action
      console.log(action === 'created'
        ? `Đã tạo tài khoản root mới "${username}".`
        : `Đã đặt lại mật khẩu và đặt quyền root cho tài khoản "${username}" đã có sẵn.`)
    }
  }
} catch (error) {
  console.error('Tạo/thăng cấp root thất bại:', error.code || error.name, error.message)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
