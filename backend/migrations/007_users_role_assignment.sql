-- Đổi mô hình quyền admin đơn (IsAdmin BIT) sang 3 cấp: 'user' | 'admin' |
-- 'root'. Root là admin gốc duy nhất (trước đây IsAdmin=1); admin thường được
-- root phân quyền, chỉ quản lý user được root assign (ManagedByAdminId).
-- Nâng cấp tại chỗ, có thể chạy lại; không xóa dữ liệu hiện có.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users. Chạy migration 003 trước.', 1;

  IF COL_LENGTH('dbo.Users', 'Role') IS NULL
  BEGIN
    ALTER TABLE dbo.Users ADD Role NVARCHAR(20) NULL;
    -- Tài khoản IsAdmin=1 hiện có (nếu có) chính là admin gốc đã tạo qua CLI
    -- make-admin trước đây - giữ nguyên vai trò gốc, không mất quyền.
    IF COL_LENGTH('dbo.Users', 'IsAdmin') IS NOT NULL
      EXEC(N'UPDATE dbo.Users SET Role = CASE WHEN IsAdmin = 1 THEN N''root'' ELSE N''user'' END WHERE Role IS NULL');
    ELSE
      EXEC(N'UPDATE dbo.Users SET Role = N''user'' WHERE Role IS NULL');
    EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT DF_Users_Role DEFAULT N''user'' FOR Role');
    EXEC(N'ALTER TABLE dbo.Users ALTER COLUMN Role NVARCHAR(20) NOT NULL');
    EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_Role CHECK (Role IN (N''user'', N''admin'', N''root''))');
  END

  IF COL_LENGTH('dbo.Users', 'ManagedByAdminId') IS NULL
  BEGIN
    ALTER TABLE dbo.Users ADD ManagedByAdminId INT NULL;
    EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT FK_Users_ManagedByAdminId FOREIGN KEY (ManagedByAdminId) REFERENCES dbo.Users(Id)');
  END

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_ManagedByAdminId' AND object_id = OBJECT_ID('dbo.Users'))
    EXEC(N'CREATE INDEX IX_Users_ManagedByAdminId ON dbo.Users(ManagedByAdminId) WHERE ManagedByAdminId IS NOT NULL');

  -- Cột IsAdmin không còn dùng - Role đã thay thế hoàn toàn (kể cả 1 lượt
  -- chạy migration đầu, dữ liệu IsAdmin đã được chuyển sang Role ở trên rồi).
  IF COL_LENGTH('dbo.Users', 'IsAdmin') IS NOT NULL
  BEGIN
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Users_IsAdmin')
      ALTER TABLE dbo.Users DROP CONSTRAINT DF_Users_IsAdmin;
    ALTER TABLE dbo.Users DROP COLUMN IsAdmin;
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
