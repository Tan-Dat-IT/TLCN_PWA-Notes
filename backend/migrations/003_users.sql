-- Nâng cấp tại chỗ, có thể chạy lại; không xóa dữ liệu hiện có.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Notes', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Notes. Chạy schema.sql trước.', 1;

  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    CREATE TABLE dbo.Users (
      Id           INT IDENTITY(1,1) PRIMARY KEY,
      Username     NVARCHAR(100) NOT NULL UNIQUE,
      PasswordHash NVARCHAR(255) NOT NULL,
      DisplayName  NVARCHAR(100) NOT NULL,
      CreatedAt    BIGINT NOT NULL
    );
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
