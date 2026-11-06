-- Nâng cấp tại chỗ, có thể chạy lại; không xóa dữ liệu hiện có.
-- LƯU Ý: cột UserId là NOT NULL không có DEFAULT. Nếu bảng Notes đang có bản
-- ghi chưa gắn chủ sở hữu, bước ALTER bên dưới sẽ báo lỗi (loud failure) thay
-- vì âm thầm xóa hay gán bừa dữ liệu - phải tự quyết định xử lý dữ liệu cũ
-- (xóa, hoặc UPDATE gán UserId thủ công) trước khi chạy lại migration này.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Notes', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Notes. Chạy schema.sql trước.', 1;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50003, N'Chưa có bảng Users. Chạy migration 003 trước.', 1;

  IF COL_LENGTH('dbo.Notes', 'UserId') IS NULL
  BEGIN
    ALTER TABLE dbo.Notes ADD UserId INT NOT NULL;
    ALTER TABLE dbo.Notes ADD CONSTRAINT FK_Notes_UserId FOREIGN KEY (UserId) REFERENCES dbo.Users(Id);
    CREATE INDEX IX_Notes_UserId ON dbo.Notes(UserId);
  END
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
