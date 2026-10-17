-- Nhắc việc bằng Web Push (README mục "Nhắc việc"). Nâng cấp tại chỗ, có thể
-- chạy lại; không xóa dữ liệu hiện có.
--  - PushSubscriptions: mỗi trình duyệt/thiết bị đã bật nhắc việc là 1 dòng
--    (Endpoint do dịch vụ push của trình duyệt cấp, duy nhất theo thiết bị).
--  - Users.ReminderLeadMinutes: nhắc trước hạn bao nhiêu phút (theo tài khoản).
--  - NoteReminders: đánh dấu đã nhắc (ServerId, DueAt) để không gửi trùng;
--    đổi hạn công việc = cặp khóa mới = được nhắc lại theo hạn mới.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL OR OBJECT_ID(N'dbo.Notes', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users/Notes. Chạy schema.sql và các migration trước.', 1;

  IF COL_LENGTH('dbo.Users', 'ReminderLeadMinutes') IS NULL
    ALTER TABLE dbo.Users ADD ReminderLeadMinutes INT NOT NULL CONSTRAINT DF_Users_ReminderLeadMinutes DEFAULT 15;
  IF OBJECT_ID(N'dbo.CK_Users_ReminderLeadMinutes', N'C') IS NULL
    EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_ReminderLeadMinutes CHECK (ReminderLeadMinutes BETWEEN 0 AND 1440)');

  IF OBJECT_ID(N'dbo.PushSubscriptions', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PushSubscriptions (
      Id        INT IDENTITY(1,1) PRIMARY KEY,
      UserId    INT NOT NULL CONSTRAINT FK_PushSubscriptions_UserId REFERENCES dbo.Users(Id),
      Endpoint  VARCHAR(1000) NOT NULL,
      P256dh    VARCHAR(200) NOT NULL,
      Auth      VARCHAR(100) NOT NULL,
      CreatedAt BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX UQ_PushSubscriptions_Endpoint ON dbo.PushSubscriptions(Endpoint);
    CREATE INDEX IX_PushSubscriptions_UserId ON dbo.PushSubscriptions(UserId);
  END

  IF OBJECT_ID(N'dbo.NoteReminders', N'U') IS NULL
  BEGIN
    -- IGNORE_DUP_KEY: 2 lượt quét chạy chồng nhau (vd. 2 tiến trình backend)
    -- cùng chèn 1 cặp khóa thì dòng trùng bị bỏ qua thay vì lỗi, và chỉ lượt
    -- chèn được mới nhận (qua OUTPUT) quyền gửi -> không gửi trùng.
    CREATE TABLE dbo.NoteReminders (
      ServerId NVARCHAR(100) NOT NULL CONSTRAINT FK_NoteReminders_ServerId REFERENCES dbo.Notes(ServerId),
      DueAt    BIGINT NOT NULL,
      SentAt   BIGINT NOT NULL,
      CONSTRAINT PK_NoteReminders PRIMARY KEY (ServerId, DueAt) WITH (IGNORE_DUP_KEY = ON)
    );
  END
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
