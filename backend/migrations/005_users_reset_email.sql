-- Thêm cột email + token đặt lại mật khẩu cho tính năng "quên mật khẩu" gửi
-- qua email. Nâng cấp tại chỗ, có thể chạy lại; không xóa dữ liệu hiện có.
-- Tài khoản cũ chưa có Email sẽ là NULL - vẫn đăng nhập/dùng app bình
-- thường, chỉ không dùng được luồng quên mật khẩu qua email cho tới khi tự
-- cập nhật email trong mục tài khoản.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users. Chạy migration 003 trước.', 1;

  IF COL_LENGTH('dbo.Users', 'Email') IS NULL
    ALTER TABLE dbo.Users ADD Email NVARCHAR(255) NULL;

  IF COL_LENGTH('dbo.Users', 'ResetTokenHash') IS NULL
    ALTER TABLE dbo.Users ADD ResetTokenHash NVARCHAR(64) NULL;

  IF COL_LENGTH('dbo.Users', 'ResetTokenExpiresAt') IS NULL
    ALTER TABLE dbo.Users ADD ResetTokenExpiresAt BIGINT NULL;

  -- SQL động để cột Email vừa thêm ở trên được phân giải sau ALTER TABLE
  -- (cùng batch không tự thấy cột mới nếu tham chiếu trực tiếp).
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Users_Email' AND object_id = OBJECT_ID('dbo.Users'))
    EXEC(N'CREATE UNIQUE INDEX UQ_Users_Email ON dbo.Users(Email) WHERE Email IS NOT NULL');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
