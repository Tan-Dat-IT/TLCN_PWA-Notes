-- Đồng bộ giao thức v3 (mục "Xử lý xung đột" + "Đồng bộ delta" trong README).
-- Nâng cấp tại chỗ, có thể chạy lại; không xóa dữ liệu hiện có.
--  - Version: số phiên bản của TỪNG ghi chú, server tự tăng mỗi lần ghi thành
--    công. Client gửi kèm baseVersion (phiên bản nó đã thấy trước khi sửa);
--    lệch nhau nghĩa là thiết bị khác đã sửa trước -> xung đột, không ghi đè.
--    Không phụ thuộc đồng hồ thiết bị như cách so UpdatedAt trước đây.
--  - RowVer: rowversion do SQL Server tự tăng trên toàn database mỗi lần
--    INSERT/UPDATE, dùng làm con trỏ (cursor) cho đồng bộ delta: client chỉ
--    tải các dòng có RowVer lớn hơn cursor đã lưu. Bản ghi cũ được SQL Server
--    tự gán giá trị khi thêm cột, không cần backfill.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Notes', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Notes. Chạy schema.sql trước.', 1;

  IF COL_LENGTH('dbo.Notes', 'Version') IS NULL
    ALTER TABLE dbo.Notes ADD Version INT NOT NULL CONSTRAINT DF_Notes_Version DEFAULT 1;
  IF COL_LENGTH('dbo.Notes', 'RowVer') IS NULL
    ALTER TABLE dbo.Notes ADD RowVer ROWVERSION NOT NULL;

  -- SQL động để cột vừa thêm được phân giải sau ALTER TABLE.
  IF OBJECT_ID(N'dbo.CK_Notes_Version', N'C') IS NULL
    EXEC(N'ALTER TABLE dbo.Notes ADD CONSTRAINT CK_Notes_Version CHECK (Version >= 1)');
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Notes_UserId_RowVer' AND object_id = OBJECT_ID(N'dbo.Notes'))
    EXEC(N'CREATE INDEX IX_Notes_UserId_RowVer ON dbo.Notes(UserId, RowVer)');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
