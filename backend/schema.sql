
CREATE DATABASE PwaNotesDB;
GO

USE PwaNotesDB;
GO

-- Tài khoản đăng nhập: mỗi tài khoản chỉ thấy và thao tác trên Notes của
-- chính mình (xem cột Notes.UserId bên dưới) - cô lập theo từng người dùng,
-- không phải multi-tenant nhiều tổ chức.
CREATE TABLE Users (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    Username            NVARCHAR(100) NOT NULL UNIQUE,
    PasswordHash        NVARCHAR(255) NOT NULL,
    DisplayName         NVARCHAR(100) NOT NULL,
    Email               NVARCHAR(255) NULL,              -- đăng ký mới bắt buộc; vẫn NULL-able để giữ tài khoản cũ chưa có email
    ResetTokenHash      NVARCHAR(64) NULL,               -- SHA-256 của token đặt lại mật khẩu đang chờ dùng
    ResetTokenExpiresAt BIGINT NULL,                      -- hạn dùng token (epoch ms)
    -- 'user' (mặc định) | 'admin' (được admin gốc phân quyền, chỉ quản lý user được assign) | 'root' (đúng 1 tài khoản, tạo qua CLI make-admin, không có endpoint tự phong qua HTTP)
    Role                NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_Role DEFAULT N'user'
                          CONSTRAINT CK_Users_Role CHECK (Role IN (N'user', N'admin', N'root')),
    ManagedByAdminId    INT NULL CONSTRAINT FK_Users_ManagedByAdminId REFERENCES Users(Id), -- chỉ có ý nghĩa khi Role='user'; admin gốc gán
    Disabled            BIT NOT NULL CONSTRAINT DF_Users_Disabled DEFAULT 0, -- admin "xóa" user = khóa đăng nhập, không xóa dữ liệu
    CreatedAt           BIGINT NOT NULL,
    ReminderLeadMinutes INT NOT NULL CONSTRAINT DF_Users_ReminderLeadMinutes DEFAULT 15 -- nhắc việc trước hạn bao nhiêu phút
                          CONSTRAINT CK_Users_ReminderLeadMinutes CHECK (ReminderLeadMinutes BETWEEN 0 AND 1440),
    -- Chặn đăng nhập sau nhiều lần sai mật khẩu (theo tài khoản; khác Disabled là admin khóa thủ công)
    FailedLoginCount    INT NOT NULL CONSTRAINT DF_Users_FailedLoginCount DEFAULT 0
                          CONSTRAINT CK_Users_FailedLoginCount CHECK (FailedLoginCount >= 0),
    LastFailedLoginAt   BIGINT NULL,                      -- lần sai gần nhất (quá cửa sổ thì đếm lại từ đầu)
    LoginLockedUntil    BIGINT NULL,                      -- chặn tới thời điểm này; tự hết hạn, admin/root mở sớm được
    CONSTRAINT CK_Users_ManagedRole CHECK (Role = N'user' OR ManagedByAdminId IS NULL)
);
GO

CREATE TABLE Notes (
    ServerId    NVARCHAR(100) PRIMARY KEY,
    UserId      INT NOT NULL CONSTRAINT FK_Notes_UserId REFERENCES Users(Id),
    Title       NVARCHAR(255) NOT NULL,
    Content     NVARCHAR(MAX) NULL,
    Tag         NVARCHAR(100) NULL,
    Done        BIT NOT NULL DEFAULT 0,
    UpdatedAt   BIGINT NOT NULL,      -- mốc client để hiển thị/sắp xếp; Version mới dùng phát hiện xung đột
    Deleted     BIT NOT NULL DEFAULT 0,
    Kind        NVARCHAR(10) NOT NULL CONSTRAINT DF_Notes_Kind DEFAULT N'task',
    CreatedAt   BIGINT NULL,
    StartAt     BIGINT NULL,
    DueAt       BIGINT NULL,
    CompletedAt BIGINT NULL,
    DeletedAt   BIGINT NULL,
    Version     INT NOT NULL CONSTRAINT DF_Notes_Version DEFAULT 1, -- server tự tăng mỗi lần ghi; client gửi baseVersion để phát hiện xung đột
    RowVer      ROWVERSION NOT NULL,                                -- SQL Server tự tăng mỗi lần INSERT/UPDATE; con trỏ cho đồng bộ delta
    CONSTRAINT CK_Notes_Version CHECK (Version >= 1),
    CONSTRAINT CK_Notes_Schedule CHECK (
      Kind IN (N'note', N'task') AND (Kind = N'task' OR Done = 0)
      AND (StartAt IS NULL OR DueAt IS NULL OR DueAt >= StartAt)
      AND (CreatedAt IS NULL OR CreatedAt BETWEEN 0 AND 8640000000000000)
      AND (StartAt IS NULL OR StartAt BETWEEN 0 AND 8640000000000000)
      AND (DueAt IS NULL OR DueAt BETWEEN 0 AND 8640000000000000)
      AND (CompletedAt IS NULL OR (Done = 1 AND CompletedAt BETWEEN 0 AND 8640000000000000))
      AND (DeletedAt IS NULL OR (Deleted = 1 AND DeletedAt BETWEEN 0 AND 8640000000000000))
    )
);
GO

-- Index hỗ trợ lọc theo chủ sở hữu, tag và sắp xếp theo thời gian cập nhật
CREATE INDEX IX_Notes_UserId ON Notes(UserId);
CREATE INDEX IX_Notes_Tag ON Notes(Tag);
CREATE INDEX IX_Notes_UpdatedAt ON Notes(UpdatedAt);
-- Đồng bộ delta: lọc theo chủ sở hữu rồi quét theo RowVer > cursor
CREATE INDEX IX_Notes_UserId_RowVer ON Notes(UserId, RowVer);
GO

-- Cache embedding cho tìm kiếm ngữ nghĩa và hỏi đáp có dẫn nguồn. Embedding
-- luôn gắn với UserId; NoteVersion + ContentHash giúp chỉ tạo lại vector khi
-- nội dung liên quan của ghi chú thay đổi.
CREATE TABLE NoteEmbeddings (
    UserId       INT NOT NULL CONSTRAINT FK_NoteEmbeddings_UserId REFERENCES Users(Id),
    ServerId     NVARCHAR(100) NOT NULL CONSTRAINT FK_NoteEmbeddings_ServerId REFERENCES Notes(ServerId),
    NoteVersion  INT NOT NULL,
    ContentHash  CHAR(64) NOT NULL,
    Model         NVARCHAR(100) NOT NULL,
    Embedding     NVARCHAR(MAX) NOT NULL,
    IndexedAt     BIGINT NOT NULL,
    CONSTRAINT PK_NoteEmbeddings PRIMARY KEY (UserId, ServerId),
    CONSTRAINT CK_NoteEmbeddings_Version CHECK (NoteVersion >= 1),
    CONSTRAINT CK_NoteEmbeddings_Json CHECK (ISJSON(Embedding) = 1)
);
GO

CREATE INDEX IX_NoteEmbeddings_ServerId ON NoteEmbeddings(ServerId);
GO

-- Index lọc null (không dùng UNIQUE constraint thường) vì SQL Server chỉ cho
-- phép 1 giá trị NULL trong UNIQUE constraint/index thường - tài khoản cũ
-- có thể chưa có Email nên cần bỏ qua NULL khi kiểm tra trùng.
CREATE UNIQUE INDEX UQ_Users_Email ON Users(Email) WHERE Email IS NOT NULL;
GO

-- Hỗ trợ truy vấn "user do admin X quản lý" (trang quản trị của admin thường)
CREATE INDEX IX_Users_ManagedByAdminId ON Users(ManagedByAdminId) WHERE ManagedByAdminId IS NOT NULL;
GO

<<<<<<< HEAD
-- Nhật ký hành động quản trị - chỉ root xem được (mục 23.6). Snapshot sẵn
=======
-- Nhật ký hành động quản trị - chỉ root xem được. Snapshot sẵn
>>>>>>> 9a87a8ab6148f883389c49ad230ab49ac92bf3d8
-- Username (không chỉ Id) để log vẫn đọc được rõ ràng ngay cả khi tài khoản
-- liên quan sau này đổi tên hiển thị hoặc bị khóa.
CREATE TABLE AdminAuditLog (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    ActorUserId     INT NOT NULL CONSTRAINT FK_AdminAuditLog_ActorUserId REFERENCES Users(Id),
    ActorUsername   NVARCHAR(100) NOT NULL,
    TargetUserId    INT NULL CONSTRAINT FK_AdminAuditLog_TargetUserId REFERENCES Users(Id),
    TargetUsername  NVARCHAR(100) NULL,
    Action          NVARCHAR(30) NOT NULL,
    Details         NVARCHAR(500) NULL,
    CreatedAt       BIGINT NOT NULL
);
GO

CREATE INDEX IX_AdminAuditLog_CreatedAt ON AdminAuditLog(CreatedAt DESC);
GO

-- Nhắc việc bằng Web Push: mỗi trình duyệt/thiết bị đã bật nhắc việc là 1 dòng.
-- Endpoint do dịch vụ push của trình duyệt cấp, duy nhất theo thiết bị.
CREATE TABLE PushSubscriptions (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    UserId    INT NOT NULL CONSTRAINT FK_PushSubscriptions_UserId REFERENCES Users(Id),
    Endpoint  VARCHAR(1000) NOT NULL,
    P256dh    VARCHAR(200) NOT NULL,
    Auth      VARCHAR(100) NOT NULL,
    CreatedAt BIGINT NOT NULL
);
GO

CREATE UNIQUE INDEX UQ_PushSubscriptions_Endpoint ON PushSubscriptions(Endpoint);
CREATE INDEX IX_PushSubscriptions_UserId ON PushSubscriptions(UserId);
GO

-- Đã nhắc công việc nào với hạn nào - chống gửi trùng. Đổi hạn = cặp khóa mới
-- = được nhắc lại. IGNORE_DUP_KEY: lượt quét chạy chồng nhau không gửi trùng.
CREATE TABLE NoteReminders (
    ServerId NVARCHAR(100) NOT NULL CONSTRAINT FK_NoteReminders_ServerId REFERENCES Notes(ServerId),
    DueAt    BIGINT NOT NULL,
    SentAt   BIGINT NOT NULL,
    CONSTRAINT PK_NoteReminders PRIMARY KEY (ServerId, DueAt) WITH (IGNORE_DUP_KEY = ON)
);
GO
