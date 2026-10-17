-- Cache embedding cho Trợ lý tri thức AI. Mỗi tài khoản chỉ đọc embedding
-- của chính mình; NoteVersion + ContentHash giúp chỉ lập chỉ mục lại ghi chú
-- đã thay đổi. Migration nâng cấp tại chỗ và an toàn khi chạy lại.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.Users', N'U') IS NULL OR OBJECT_ID(N'dbo.Notes', N'U') IS NULL
    THROW 50001, N'Chưa có bảng Users/Notes. Chạy các migration trước.', 1;

  IF OBJECT_ID(N'dbo.NoteEmbeddings', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.NoteEmbeddings (
      UserId       INT NOT NULL CONSTRAINT FK_NoteEmbeddings_UserId REFERENCES dbo.Users(Id),
      ServerId     NVARCHAR(100) NOT NULL CONSTRAINT FK_NoteEmbeddings_ServerId REFERENCES dbo.Notes(ServerId),
      NoteVersion  INT NOT NULL,
      ContentHash  CHAR(64) NOT NULL,
      Model         NVARCHAR(100) NOT NULL,
      Embedding     NVARCHAR(MAX) NOT NULL,
      IndexedAt     BIGINT NOT NULL,
      CONSTRAINT PK_NoteEmbeddings PRIMARY KEY (UserId, ServerId),
      CONSTRAINT CK_NoteEmbeddings_Version CHECK (NoteVersion >= 1),
      CONSTRAINT CK_NoteEmbeddings_Json CHECK (ISJSON(Embedding) = 1)
    );
    CREATE INDEX IX_NoteEmbeddings_ServerId ON dbo.NoteEmbeddings(ServerId);
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
