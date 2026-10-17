-- Bảo đảm chỉ tài khoản Role='user' mới có thể mang liên kết quản lý.
-- Nâng cấp tại chỗ, có thể chạy lại: dọn dữ liệu cũ trước khi thêm CHECK.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users. Chạy migration 003 trước.', 1;

  IF COL_LENGTH('dbo.Users', 'Role') IS NULL OR COL_LENGTH('dbo.Users', 'ManagedByAdminId') IS NULL
    THROW 50002, N'Chưa có Role/ManagedByAdminId. Chạy migration 007 trước.', 1;

  -- SQL động để migration vẫn biên dịch được khi chạy nhầm trên schema quá cũ.
  EXEC(N'UPDATE dbo.Users
         SET ManagedByAdminId = NULL
         WHERE Role <> N''user'' AND ManagedByAdminId IS NOT NULL');

  IF OBJECT_ID(N'dbo.CK_Users_ManagedRole', N'C') IS NULL
    EXEC(N'ALTER TABLE dbo.Users WITH CHECK
           ADD CONSTRAINT CK_Users_ManagedRole
           CHECK (Role = N''user'' OR ManagedByAdminId IS NULL)');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
