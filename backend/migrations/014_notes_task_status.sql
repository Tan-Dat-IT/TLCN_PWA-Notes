-- Đồng bộ v4: lưu trạng thái Cần làm / Đang làm / Hoàn thành.
-- Có thể chạy lại, giữ nguyên trạng thái đang làm và dữ liệu hiện có.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Notes', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Notes. Chạy schema.sql trước.', 1;

  IF COL_LENGTH('dbo.Notes', 'Status') IS NULL
    ALTER TABLE dbo.Notes ADD Status NVARCHAR(10) NULL;

  EXEC(N'
    UPDATE dbo.Notes SET Status = CASE
      WHEN Kind = N''note'' THEN NULL
      WHEN Done = 1 THEN N''done''
      WHEN Status IN (N''todo'', N''doing'') THEN Status
      ELSE N''todo'' END
    WHERE (Kind = N''note'' AND Status IS NOT NULL)
       OR (Kind = N''task'' AND (
         Status IS NULL OR Status NOT IN (N''todo'', N''doing'', N''done'')
         OR (Done = 1 AND Status <> N''done'')
         OR (Done = 0 AND Status = N''done'')
       ));
  ');

  IF OBJECT_ID(N'dbo.CK_Notes_TaskStatus', N'C') IS NULL
    EXEC(N'ALTER TABLE dbo.Notes WITH CHECK ADD CONSTRAINT CK_Notes_TaskStatus CHECK (
      (Kind = N''note'' AND Status IS NULL AND Done = 0)
      OR (Kind = N''task'' AND Status IS NOT NULL AND (
        (Status IN (N''todo'', N''doing'') AND Done = 0) OR (Status = N''done'' AND Done = 1)
      ))
    )');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
