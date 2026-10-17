-- Nhật ký hành động quản trị (ai tạo/sửa/khóa/phân quyền ai, lúc nào) - chỉ
-- root xem được (mục 23.6/23.7). Nâng cấp tại chỗ, có thể chạy lại; không
-- xóa dữ liệu hiện có. Bảng mới hoàn toàn nên không cần backfill.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users. Chạy migration 003 trước.', 1;

  IF OBJECT_ID(N'dbo.AdminAuditLog', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.AdminAuditLog (
      Id              INT IDENTITY(1,1) PRIMARY KEY,
      ActorUserId     INT NOT NULL CONSTRAINT FK_AdminAuditLog_ActorUserId REFERENCES dbo.Users(Id),
      ActorUsername   NVARCHAR(100) NOT NULL,
      TargetUserId    INT NULL CONSTRAINT FK_AdminAuditLog_TargetUserId REFERENCES dbo.Users(Id),
      TargetUsername  NVARCHAR(100) NULL,
      Action          NVARCHAR(30) NOT NULL,
      Details         NVARCHAR(500) NULL,
      CreatedAt       BIGINT NOT NULL
    );
    CREATE INDEX IX_AdminAuditLog_CreatedAt ON dbo.AdminAuditLog(CreatedAt DESC);
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
