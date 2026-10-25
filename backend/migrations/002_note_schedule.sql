-- Nâng cấp tại chỗ, có thể chạy lại; không xóa dữ liệu hiện có.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Notes', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Notes. Chạy schema.sql trước.', 1;

  IF COL_LENGTH('dbo.Notes', 'Kind') IS NULL
    ALTER TABLE dbo.Notes ADD Kind NVARCHAR(10) NOT NULL CONSTRAINT DF_Notes_Kind DEFAULT N'task';
  IF COL_LENGTH('dbo.Notes', 'CreatedAt') IS NULL
    ALTER TABLE dbo.Notes ADD CreatedAt BIGINT NULL;
  IF COL_LENGTH('dbo.Notes', 'StartAt') IS NULL
    ALTER TABLE dbo.Notes ADD StartAt BIGINT NULL;
  IF COL_LENGTH('dbo.Notes', 'DueAt') IS NULL
    ALTER TABLE dbo.Notes ADD DueAt BIGINT NULL;
  IF COL_LENGTH('dbo.Notes', 'CompletedAt') IS NULL
    ALTER TABLE dbo.Notes ADD CompletedAt BIGINT NULL;
  IF COL_LENGTH('dbo.Notes', 'DeletedAt') IS NULL
    ALTER TABLE dbo.Notes ADD DeletedAt BIGINT NULL;

  -- SQL động để các cột vừa thêm được phân giải sau ALTER TABLE.
  IF OBJECT_ID(N'dbo.CK_Notes_Schedule', N'C') IS NULL
    EXEC(N'ALTER TABLE dbo.Notes ADD CONSTRAINT CK_Notes_Schedule CHECK (
      Kind IN (N''note'', N''task'') AND (Kind = N''task'' OR Done = 0)
      AND (StartAt IS NULL OR DueAt IS NULL OR DueAt >= StartAt)
      AND (CreatedAt IS NULL OR CreatedAt BETWEEN 0 AND 8640000000000000)
      AND (StartAt IS NULL OR StartAt BETWEEN 0 AND 8640000000000000)
      AND (DueAt IS NULL OR DueAt BETWEEN 0 AND 8640000000000000)
      AND (CompletedAt IS NULL OR (Done = 1 AND CompletedAt BETWEEN 0 AND 8640000000000000))
      AND (DeletedAt IS NULL OR (Deleted = 1 AND DeletedAt BETWEEN 0 AND 8640000000000000))
    )');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
