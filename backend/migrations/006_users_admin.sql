-- Thêm quyền admin + trạng thái khóa tài khoản. Nâng cấp tại chỗ, có thể
-- chạy lại; không xóa dữ liệu hiện có. Tài khoản cũ mặc định IsAdmin=0,
-- Disabled=0 (không đổi hành vi đăng nhập hiện tại của ai cả).
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users. Chạy migration 003 trước.', 1;

  IF COL_LENGTH('dbo.Users', 'IsAdmin') IS NULL
    ALTER TABLE dbo.Users ADD IsAdmin BIT NOT NULL CONSTRAINT DF_Users_IsAdmin DEFAULT 0;

  IF COL_LENGTH('dbo.Users', 'Disabled') IS NULL
    ALTER TABLE dbo.Users ADD Disabled BIT NOT NULL CONSTRAINT DF_Users_Disabled DEFAULT 0;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
