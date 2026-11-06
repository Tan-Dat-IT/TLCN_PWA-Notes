-- Chặn đăng nhập theo TÀI KHOẢN sau nhiều lần sai mật khẩu (thay cho bộ đếm
-- trong RAM theo IP+tên đăng nhập trước đây: mất khi restart backend, đổi IP là
-- né được, admin không thấy/không mở được). Nâng cấp tại chỗ, có thể chạy lại;
-- không xóa dữ liệu hiện có.
--  - FailedLoginCount: số lần sai liên tiếp trong cửa sổ thời gian hiện tại.
--  - LastFailedLoginAt: lần sai gần nhất (quá cửa sổ thì bộ đếm tính lại từ đầu).
--  - LoginLockedUntil: chặn đăng nhập tới thời điểm này (tự hết hạn; admin quản
--    lý tài khoản hoặc root mở sớm được). Khác Disabled (admin khóa thủ công).
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users. Chạy migration 003 trước.', 1;

  IF COL_LENGTH('dbo.Users', 'FailedLoginCount') IS NULL
    ALTER TABLE dbo.Users ADD FailedLoginCount INT NOT NULL CONSTRAINT DF_Users_FailedLoginCount DEFAULT 0;
  IF COL_LENGTH('dbo.Users', 'LastFailedLoginAt') IS NULL
    ALTER TABLE dbo.Users ADD LastFailedLoginAt BIGINT NULL;
  IF COL_LENGTH('dbo.Users', 'LoginLockedUntil') IS NULL
    ALTER TABLE dbo.Users ADD LoginLockedUntil BIGINT NULL;

  -- SQL động để cột vừa thêm được phân giải sau ALTER TABLE.
  IF OBJECT_ID(N'dbo.CK_Users_FailedLoginCount', N'C') IS NULL
    EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_FailedLoginCount CHECK (FailedLoginCount >= 0)');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
