import './env.js'
import sql from 'mssql'

// Cấu hình kết nối SQL Server Express. Với instance dạng "SQLEXPRESS"
// (mặc định khi cài SQL Server Express), dùng `instanceName` thay vì
// `port` trực tiếp - driver sẽ tự dò cổng qua SQL Server Browser service.
const config = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'PwaNotesDB',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    ...(process.env.DB_PORT ? {} : { instanceName: process.env.DB_INSTANCE || 'SQLEXPRESS' }),
    trustServerCertificate: process.env.DB_TRUST_CERTIFICATE ? process.env.DB_TRUST_CERTIFICATE === 'true' : process.env.NODE_ENV !== 'production',
    encrypt: process.env.DB_ENCRYPT ? process.env.DB_ENCRYPT === 'true' : process.env.NODE_ENV === 'production'
  }
}

// Kết nối thẳng TCP khi có cổng, không cần SQL Server Browser dò instance.
if (process.env.DB_PORT) {
  const port = Number(process.env.DB_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT phải là số nguyên từ 1 đến 65535')
  }
  config.port = port
}

let poolPromise

// Kết nối pool 1 lần, tái sử dụng cho mọi request thay vì mở kết nối mới
// mỗi lần - đúng best practice khi làm việc với SQL Server.
export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config).catch(err => {
      poolPromise = null // reset để lần gọi sau có thể thử kết nối lại
      throw err
    })
  }
  return poolPromise
}

// Chuyển 1 dòng Notes (SQL) sang định dạng JSON mà client dùng. BIGINT được
// driver mssql trả về dạng chuỗi nên phải Number() lại.
function mapNote(n) {
  return {
    serverId: n.ServerId, title: n.Title, content: n.Content || '',
    kind: n.Kind, createdAt: n.CreatedAt === null ? null : Number(n.CreatedAt),
    startAt: n.StartAt === null ? null : Number(n.StartAt), dueAt: n.DueAt === null ? null : Number(n.DueAt),
    completedAt: n.CompletedAt === null ? null : Number(n.CompletedAt), deletedAt: n.DeletedAt === null ? null : Number(n.DeletedAt),
    tag: n.Tag || 'chung', done: Boolean(n.Done),
    updatedAt: Number(n.UpdatedAt), deleted: n.Deleted ? 1 : 0, version: n.Version
  }
}

const NOTE_COLUMNS = 'ServerId, Title, Content, Kind, CreatedAt, StartAt, DueAt, CompletedAt, DeletedAt, Tag, Done, UpdatedAt, Deleted, Version'

// Toàn bộ ghi chú của 1 user - dùng cho trang quản trị (xem chỉ đọc).
export async function getAllNotes(userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`SELECT ${NOTE_COLUMNS} FROM Notes WHERE UserId = @UserId ORDER BY UpdatedAt DESC`)
  return result.recordset.map(mapNote)
}

// Ghi chú đang hoạt động dùng làm kho tri thức. Chỉ lấy đúng UserId từ JWT,
// không nhận UserId từ client; giới hạn số lượng để một request không làm máy
// chạy Ollama phải lập chỉ mục vô hạn.
export async function getKnowledgeNotes(userId, limit = 1000) {
  const pool = await getPool()
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .input('Limit', sql.Int, limit)
    .query(`SELECT TOP (@Limit) ${NOTE_COLUMNS}
            FROM Notes WHERE UserId = @UserId AND Deleted = 0
            ORDER BY UpdatedAt DESC`)
  return result.recordset.map(mapNote)
}

// Danh sách công việc đang mở cho mô phỏng tiến độ. Ưu tiên công việc có hạn
// gần trước; giới hạn số lượng để prompt AI và thời gian mô phỏng có biên rõ.
export async function getPlanningTasks(userId, limit = 60) {
  const pool = await getPool()
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .input('Limit', sql.Int, limit)
    .query(`SELECT TOP (@Limit) ${NOTE_COLUMNS}
            FROM Notes
            WHERE UserId = @UserId AND Kind = N'task' AND Done = 0 AND Deleted = 0
            ORDER BY CASE WHEN DueAt IS NULL THEN 1 ELSE 0 END, DueAt ASC, UpdatedAt DESC`)
  return result.recordset.map(mapNote)
}

export async function getKnowledgeEmbeddings(userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`SELECT ServerId, NoteVersion, ContentHash, Model, Embedding
            FROM NoteEmbeddings WHERE UserId = @UserId`)
  return result.recordset.flatMap(row => {
    try {
      const embedding = JSON.parse(row.Embedding)
      return [{
        serverId: row.ServerId,
        noteVersion: row.NoteVersion,
        contentHash: row.ContentHash,
        model: row.Model,
        embedding
      }]
    } catch { return [] }
  })
}

// Ghi cache theo batch qua OPENJSON để lần đầu lập chỉ mục nhiều ghi chú vẫn
// chỉ cần một round-trip SQL cho mỗi batch embedding từ Ollama.
export async function saveKnowledgeEmbeddings(userId, items) {
  if (!items.length) return
  const payload = items.map(item => ({
    serverId: item.serverId,
    noteVersion: item.noteVersion,
    contentHash: item.contentHash,
    model: item.model,
    embedding: JSON.stringify(item.embedding)
  }))
  const pool = await getPool()
  await pool.request()
    .input('UserId', sql.Int, userId)
    .input('Items', sql.NVarChar(sql.MAX), JSON.stringify(payload))
    .input('IndexedAt', sql.BigInt, Date.now())
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @Parsed TABLE (
        ServerId NVARCHAR(100), NoteVersion INT, ContentHash CHAR(64),
        Model NVARCHAR(100), Embedding NVARCHAR(MAX)
      );
      INSERT INTO @Parsed (ServerId, NoteVersion, ContentHash, Model, Embedding)
      SELECT ServerId, NoteVersion, ContentHash, Model, Embedding
      FROM OPENJSON(@Items) WITH (
        ServerId NVARCHAR(100) '$.serverId',
        NoteVersion INT '$.noteVersion',
        ContentHash CHAR(64) '$.contentHash',
        Model NVARCHAR(100) '$.model',
        Embedding NVARCHAR(MAX) '$.embedding'
      );

      UPDATE target SET NoteVersion = source.NoteVersion,
        ContentHash = source.ContentHash, Model = source.Model,
        Embedding = source.Embedding, IndexedAt = @IndexedAt
      FROM NoteEmbeddings target
      JOIN @Parsed source ON source.ServerId = target.ServerId
      WHERE target.UserId = @UserId;

      INSERT INTO NoteEmbeddings (UserId, ServerId, NoteVersion, ContentHash, Model, Embedding, IndexedAt)
      SELECT @UserId, source.ServerId, source.NoteVersion, source.ContentHash,
             source.Model, source.Embedding, @IndexedAt
      FROM @Parsed source
      WHERE EXISTS (SELECT 1 FROM Notes n WHERE n.ServerId = source.ServerId AND n.UserId = @UserId AND n.Deleted = 0)
        AND NOT EXISTS (SELECT 1 FROM NoteEmbeddings target WITH (UPDLOCK, HOLDLOCK)
                        WHERE target.UserId = @UserId AND target.ServerId = source.ServerId);
      COMMIT TRANSACTION;
    `)
}

export async function deleteStaleKnowledgeEmbeddings(userId) {
  const pool = await getPool()
  await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`DELETE e FROM NoteEmbeddings e
            WHERE e.UserId = @UserId
              AND NOT EXISTS (SELECT 1 FROM Notes n
                              WHERE n.ServerId = e.ServerId AND n.UserId = @UserId AND n.Deleted = 0)`)
}

// Đồng bộ delta: chỉ trả các ghi chú đã thay đổi SAU con trỏ `since` (giá trị
// RowVer dạng chuỗi số thập phân, '0' = lấy toàn bộ), tối đa `limit` dòng/trang.
//  - Chỉ lấy dòng có RowVer < MIN_ACTIVE_ROWVERSION(): một giao dịch đang
//    chạy dở có thể đã nhận RowVer nhỏ hơn dòng khác vừa commit; nếu trả dòng
//    lớn hơn trước thì con trỏ nhảy qua và dòng kia bị bỏ sót vĩnh viễn.
//  - Con trỏ lớn hơn @@DBTS (RowVer lớn nhất database từng cấp) nghĩa là
//    database đã bị khôi phục/tạo lại -> con trỏ vô hiệu, trả lại từ đầu và
//    báo reset=true để client biết.
//  - Lấy limit+1 dòng để biết còn trang sau (hasMore) mà không cần COUNT.
export async function getNotesSince(userId, since, limit) {
  const pool = await getPool()
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .input('Since', sql.VarChar(20), since)
    .input('Take', sql.Int, limit + 1)
    .query(`
      DECLARE @From BIGINT = CONVERT(BIGINT, @Since);
      DECLARE @Reset BIT = CASE WHEN @From > CONVERT(BIGINT, @@DBTS) THEN 1 ELSE 0 END;
      IF @Reset = 1 SET @From = 0;
      SELECT TOP (@Take) ${NOTE_COLUMNS}, CONVERT(BIGINT, RowVer) AS Seq
      FROM Notes
      WHERE UserId = @UserId AND RowVer > CONVERT(BINARY(8), @From) AND RowVer < MIN_ACTIVE_ROWVERSION()
      ORDER BY RowVer;
      SELECT @Reset AS Reset;
    `)
  const rows = result.recordsets[0]
  const reset = Boolean(result.recordsets[1][0].Reset)
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const cursor = page.length ? String(page[page.length - 1].Seq) : (reset ? '0' : since)
  return { notes: page.map(mapNote), cursor, hasMore, reset }
}

export async function getNote(serverId, userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('ServerId', sql.NVarChar(100), serverId)
    .input('UserId', sql.Int, userId)
    .query(`SELECT ${NOTE_COLUMNS} FROM Notes WHERE ServerId = @ServerId AND UserId = @UserId`)
  return result.recordset[0] ? mapNote(result.recordset[0]) : null
}

// Ghi 1 ghi chú theo khóa lạc quan (optimistic concurrency) bằng Version,
// không so UpdatedAt do client tự đặt (đồng hồ thiết bị có thể lệch).
// Trong 1 giao dịch, khóa dòng (UPDLOCK, HOLDLOCK - khóa cả khoảng khóa nên
// 2 request chèn cùng ServerId không chen nhau được) rồi quyết định:
//  - chưa có dòng            -> INSERT, Version = 1                  (applied)
//  - dòng của tài khoản khác -> không đụng tới                        (rejected)
//    (client tự đổi ServerId khác rồi gửi lại, không lộ dữ liệu người khác)
//  - baseVersion = Version   -> UPDATE, Version + 1                  (applied)
//  - lệch Version nhưng nội dung đã y hệt server (request gửi lại sau khi mất
//    phản hồi, hoặc 2 thiết bị sửa giống nhau) -> không ghi, coi như (applied).
//    So sánh dạng nhị phân để phân biệt hoa/thường và khoảng trắng cuối
//    (phép = của SQL Server bỏ qua cả hai với collation mặc định).
//  - còn lại                 -> không ghi đè                         (conflict)
export async function upsertNote(incoming, userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('ServerId', sql.NVarChar(100), incoming.serverId)
    .input('UserId', sql.Int, userId)
    .input('BaseVersion', sql.Int, incoming.baseVersion)
    .input('Title', sql.NVarChar(255), incoming.title)
    .input('Content', sql.NVarChar(sql.MAX), incoming.content || '')
    .input('Tag', sql.NVarChar(100), incoming.tag || 'chung')
    .input('Done', sql.Bit, incoming.done ? 1 : 0)
    .input('UpdatedAt', sql.BigInt, incoming.updatedAt)
    .input('Deleted', sql.Bit, incoming.deleted ? 1 : 0)
    .input('Kind', sql.NVarChar(10), incoming.kind)
    .input('CreatedAt', sql.BigInt, incoming.createdAt)
    .input('StartAt', sql.BigInt, incoming.startAt)
    .input('DueAt', sql.BigInt, incoming.dueAt)
    .input('CompletedAt', sql.BigInt, incoming.completedAt)
    .input('DeletedAt', sql.BigInt, incoming.deletedAt)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @CurUser INT, @CurVersion INT, @Status NVARCHAR(10), @NewVersion INT;
      SELECT @CurUser = UserId, @CurVersion = Version
      FROM Notes WITH (UPDLOCK, HOLDLOCK) WHERE ServerId = @ServerId;

      IF @CurUser IS NULL
      BEGIN
        INSERT INTO Notes (ServerId, UserId, Title, Content, Tag, Done, UpdatedAt, Deleted, Kind, CreatedAt, StartAt, DueAt, CompletedAt, DeletedAt, Version)
        VALUES (@ServerId, @UserId, @Title, @Content, @Tag, @Done, @UpdatedAt, @Deleted, @Kind, @CreatedAt, @StartAt, @DueAt, @CompletedAt, @DeletedAt, 1);
        SELECT @Status = N'applied', @NewVersion = 1;
      END
      ELSE IF @CurUser <> @UserId
        SET @Status = N'rejected';
      ELSE IF @BaseVersion = @CurVersion
      BEGIN
        UPDATE Notes SET Title=@Title, Content=@Content, Tag=@Tag,
               Done=@Done, UpdatedAt=@UpdatedAt, Deleted=@Deleted,
               Kind=@Kind, CreatedAt=COALESCE(CreatedAt, @CreatedAt),
               StartAt=@StartAt, DueAt=@DueAt, CompletedAt=@CompletedAt, DeletedAt=@DeletedAt,
               Version = Version + 1
        WHERE ServerId = @ServerId;
        SELECT @Status = N'applied', @NewVersion = @CurVersion + 1;
      END
      ELSE IF EXISTS (
        SELECT 1 FROM Notes WHERE ServerId = @ServerId
          AND CONVERT(VARBINARY(MAX), Title) = CONVERT(VARBINARY(MAX), @Title)
          AND CONVERT(VARBINARY(MAX), ISNULL(Content, N'')) = CONVERT(VARBINARY(MAX), @Content)
          AND CONVERT(VARBINARY(MAX), ISNULL(Tag, N'chung')) = CONVERT(VARBINARY(MAX), @Tag)
          AND Done = @Done AND Deleted = @Deleted AND Kind = @Kind
          AND (StartAt = @StartAt OR (StartAt IS NULL AND @StartAt IS NULL))
          AND (DueAt = @DueAt OR (DueAt IS NULL AND @DueAt IS NULL))
          AND (CompletedAt = @CompletedAt OR (CompletedAt IS NULL AND @CompletedAt IS NULL))
          AND (DeletedAt = @DeletedAt OR (DeletedAt IS NULL AND @DeletedAt IS NULL)))
        SELECT @Status = N'applied', @NewVersion = @CurVersion;
      ELSE
        SET @Status = N'conflict';
      COMMIT TRANSACTION;
      SELECT @Status AS Status, @NewVersion AS Version;
    `)
  const { Status: status, Version: version } = result.recordset[0]
  if (status === 'applied') return { status, version }
  if (status === 'conflict') return { status, server: await getNote(incoming.serverId, userId) }
  return { status }
}

// --- Nhắc việc bằng Web Push ---

// Lưu/ghi đè đăng ký push theo Endpoint (duy nhất theo trình duyệt). Cùng 1
// trình duyệt đổi sang tài khoản khác rồi bật nhắc việc thì dòng cũ được gán
// lại cho tài khoản mới - không để 1 thiết bị nhận thông báo của 2 người.
export async function savePushSubscription(userId, { endpoint, p256dh, auth }) {
  const pool = await getPool()
  await pool.request()
    .input('UserId', sql.Int, userId)
    .input('Endpoint', sql.VarChar(1000), endpoint)
    .input('P256dh', sql.VarChar(200), p256dh)
    .input('Auth', sql.VarChar(100), auth)
    .input('CreatedAt', sql.BigInt, Date.now())
    .query(`
      MERGE PushSubscriptions WITH (HOLDLOCK) AS target
      USING (SELECT @Endpoint AS Endpoint) AS source ON target.Endpoint = source.Endpoint
      WHEN MATCHED THEN UPDATE SET UserId = @UserId, P256dh = @P256dh, Auth = @Auth
      WHEN NOT MATCHED THEN INSERT (UserId, Endpoint, P256dh, Auth, CreatedAt) VALUES (@UserId, @Endpoint, @P256dh, @Auth, @CreatedAt);
    `)
}

// Chỉ xóa được đăng ký của chính mình (người dùng tắt nhắc việc/đăng xuất).
export async function deletePushSubscription(userId, endpoint) {
  const pool = await getPool()
  await pool.request()
    .input('UserId', sql.Int, userId)
    .input('Endpoint', sql.VarChar(1000), endpoint)
    .query('DELETE FROM PushSubscriptions WHERE Endpoint = @Endpoint AND UserId = @UserId')
}

// Dịch vụ push báo Endpoint không còn hiệu lực (404/410: trình duyệt đã hủy
// đăng ký, xóa dữ liệu trang...) -> dọn khỏi DB, không gửi tiếp.
export async function deletePushSubscriptionByEndpoint(endpoint) {
  const pool = await getPool()
  await pool.request()
    .input('Endpoint', sql.VarChar(1000), endpoint)
    .query('DELETE FROM PushSubscriptions WHERE Endpoint = @Endpoint')
}

export async function getPushSubscriptions(userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query('SELECT Endpoint, P256dh, Auth FROM PushSubscriptions WHERE UserId = @UserId')
  return result.recordset.map(r => ({ endpoint: r.Endpoint, keys: { p256dh: r.P256dh, auth: r.Auth } }))
}

export async function getReminderSettings(userId, endpoint) {
  const pool = await getPool()
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .input('Endpoint', sql.VarChar(1000), endpoint)
    .query(`
      SELECT u.ReminderLeadMinutes,
             CASE WHEN EXISTS (SELECT 1 FROM PushSubscriptions WHERE UserId = @UserId AND Endpoint = @Endpoint) THEN 1 ELSE 0 END AS Subscribed
      FROM Users u WHERE u.Id = @UserId
    `)
  const row = result.recordset[0]
  return { leadMinutes: row ? row.ReminderLeadMinutes : 15, subscribed: Boolean(row?.Subscribed) }
}

export async function setReminderLeadMinutes(userId, minutes) {
  const pool = await getPool()
  await pool.request()
    .input('Id', sql.Int, userId)
    .input('Minutes', sql.Int, minutes)
    .query('UPDATE Users SET ReminderLeadMinutes = @Minutes WHERE Id = @Id')
}

// "Nhận" các công việc đến lúc nhắc: chưa hoàn thành, chưa xóa, có hạn, đã tới
// mốc (hạn - số phút nhắc trước), hạn chưa qua quá `graceMs` (backend tắt một
// lúc rồi bật lại vẫn nhắc bù, nhưng không nhắc dồn việc đã quá hạn từ lâu),
// chủ sở hữu chưa bị khóa và có ít nhất 1 thiết bị bật nhắc, chưa từng nhắc
// với đúng hạn này. INSERT + OUTPUT trong 1 câu: chỉ dòng chèn được (khóa
// chính IGNORE_DUP_KEY) mới được trả về -> 2 lượt quét chồng nhau không gửi trùng.
export async function claimDueReminders(now, graceMs, limit) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Now', sql.BigInt, now)
    .input('Oldest', sql.BigInt, now - graceMs)
    .input('Limit', sql.Int, limit)
    .query(`
      DECLARE @Claimed TABLE (ServerId NVARCHAR(100), DueAt BIGINT);
      INSERT INTO NoteReminders (ServerId, DueAt, SentAt)
      OUTPUT inserted.ServerId, inserted.DueAt INTO @Claimed
      SELECT TOP (@Limit) n.ServerId, n.DueAt, @Now
      FROM Notes n JOIN Users u ON u.Id = n.UserId
      WHERE n.Kind = N'task' AND n.Done = 0 AND n.Deleted = 0 AND n.DueAt IS NOT NULL
        AND n.DueAt - CONVERT(BIGINT, u.ReminderLeadMinutes) * 60000 <= @Now
        AND n.DueAt >= @Oldest
        AND u.Disabled = 0
        AND EXISTS (SELECT 1 FROM PushSubscriptions s WHERE s.UserId = n.UserId)
        AND NOT EXISTS (SELECT 1 FROM NoteReminders r WHERE r.ServerId = n.ServerId AND r.DueAt = n.DueAt)
      ORDER BY n.DueAt;
      SELECT n.ServerId, n.UserId, n.Title, c.DueAt
      FROM @Claimed c JOIN Notes n ON n.ServerId = c.ServerId
      ORDER BY n.UserId, c.DueAt;
    `)
  return result.recordset.map(r => ({ serverId: r.ServerId, userId: r.UserId, title: r.Title, dueAt: Number(r.DueAt) }))
}

// Gửi thất bại tạm thời trên mọi thiết bị -> trả lại để lượt quét sau thử lại.
export async function releaseReminder(serverId, dueAt) {
  const pool = await getPool()
  await pool.request()
    .input('ServerId', sql.NVarChar(100), serverId)
    .input('DueAt', sql.BigInt, dueAt)
    .query('DELETE FROM NoteReminders WHERE ServerId = @ServerId AND DueAt = @DueAt')
}

export async function checkDatabase() {
  const pool = await getPool()
  await pool.request().query('SELECT TOP (0) ServerId, UserId, Kind, CreatedAt, StartAt, DueAt, CompletedAt, DeletedAt, Version, RowVer FROM dbo.Notes')
  await pool.request().query('SELECT TOP (0) Id, Username, PasswordHash, Email, ResetTokenHash, ResetTokenExpiresAt, Role, ManagedByAdminId, Disabled, ReminderLeadMinutes, FailedLoginCount, LastFailedLoginAt, LoginLockedUntil FROM dbo.Users')
  await pool.request().query('SELECT TOP (0) Id, UserId, Endpoint, P256dh, Auth, CreatedAt FROM dbo.PushSubscriptions')
  await pool.request().query('SELECT TOP (0) ServerId, DueAt, SentAt FROM dbo.NoteReminders')
  await pool.request().query('SELECT TOP (0) Id, ActorUserId, TargetUserId, Action, CreatedAt FROM dbo.AdminAuditLog')
  await pool.request().query('SELECT TOP (0) UserId, ServerId, NoteVersion, ContentHash, Model, Embedding, IndexedAt FROM dbo.NoteEmbeddings')
}

export async function createUser({ username, passwordHash, displayName, email }) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Username', sql.NVarChar(100), username)
    .input('PasswordHash', sql.NVarChar(255), passwordHash)
    .input('DisplayName', sql.NVarChar(100), displayName || username)
    .input('Email', sql.NVarChar(255), email || null)
    .input('CreatedAt', sql.BigInt, Date.now())
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      IF EXISTS (SELECT 1 FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Username = @Username)
        THROW 50002, N'Tên đăng nhập đã tồn tại', 1;
      IF @Email IS NOT NULL AND EXISTS (SELECT 1 FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email)
        THROW 50003, N'Email đã được dùng cho tài khoản khác', 1;
      INSERT INTO Users (Username, PasswordHash, DisplayName, Email, CreatedAt)
      OUTPUT INSERTED.Id, INSERTED.Username, INSERTED.DisplayName, INSERTED.Email, INSERTED.Role, INSERTED.Disabled
      VALUES (@Username, @PasswordHash, @DisplayName, @Email, @CreatedAt);
      COMMIT TRANSACTION;
    `)
  return result.recordset[0]
}

export async function getUserByUsername(username) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Username', sql.NVarChar(100), username)
    .query('SELECT Id, Username, PasswordHash, DisplayName, Email, Role, ManagedByAdminId, Disabled, FailedLoginCount, LoginLockedUntil FROM Users WHERE Username = @Username')
  return result.recordset[0] || null
}

export async function getUserById(id) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Id', sql.Int, id)
    .query('SELECT Id, Username, PasswordHash, DisplayName, Email, Role, ManagedByAdminId, Disabled, FailedLoginCount, LoginLockedUntil FROM Users WHERE Id = @Id')
  return result.recordset[0] || null
}

export async function updatePassword(userId, passwordHash) {
  const pool = await getPool()
  await pool.request()
    .input('Id', sql.Int, userId)
    .input('PasswordHash', sql.NVarChar(255), passwordHash)
    // Đổi/đặt lại mật khẩu thành công thì gỡ luôn chặn đăng nhập do nhập sai.
    .query('UPDATE Users SET PasswordHash = @PasswordHash, FailedLoginCount = 0, LastFailedLoginAt = NULL, LoginLockedUntil = NULL WHERE Id = @Id')
}

export async function updateEmail(userId, email) {
  const pool = await getPool()
  await pool.request()
    .input('Id', sql.Int, userId)
    .input('Email', sql.NVarChar(255), email)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      IF EXISTS (SELECT 1 FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email AND Id <> @Id)
        THROW 50003, N'Email đã được dùng cho tài khoản khác', 1;
      UPDATE Users SET Email = @Email WHERE Id = @Id;
      COMMIT TRANSACTION;
    `)
}

export async function getUserByEmail(email) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Email', sql.NVarChar(255), email)
    .query('SELECT Id, Username, DisplayName, Email FROM Users WHERE Email = @Email')
  return result.recordset[0] || null
}

// Lưu token đặt lại mật khẩu: chỉ lưu bản băm + hạn dùng, không lưu token gốc.
export async function setResetToken(userId, tokenHash, expiresAt) {
  const pool = await getPool()
  await pool.request()
    .input('Id', sql.Int, userId)
    .input('TokenHash', sql.NVarChar(64), tokenHash)
    .input('ExpiresAt', sql.BigInt, expiresAt)
    .query('UPDATE Users SET ResetTokenHash = @TokenHash, ResetTokenExpiresAt = @ExpiresAt WHERE Id = @Id')
}

// Đặt mật khẩu mới bằng token: kiểm tra hash khớp và còn hạn ngay trong
// UPDATE (tránh race condition giữa kiểm tra và ghi), token dùng 1 lần nên
// luôn xóa sau khi dùng dù thành công hay không còn khớp.
export async function resetPasswordWithToken(tokenHash, passwordHash, now) {
  const pool = await getPool()
  const result = await pool.request()
    .input('TokenHash', sql.NVarChar(64), tokenHash)
    .input('PasswordHash', sql.NVarChar(255), passwordHash)
    .input('Now', sql.BigInt, now)
    .query(`
      UPDATE Users SET PasswordHash = @PasswordHash, ResetTokenHash = NULL, ResetTokenExpiresAt = NULL,
             FailedLoginCount = 0, LastFailedLoginAt = NULL, LoginLockedUntil = NULL
      WHERE ResetTokenHash = @TokenHash AND ResetTokenExpiresAt > @Now
    `)
  return result.rowsAffected[0] > 0
}

// Danh sách user kèm số liệu ghi chú/công việc, dùng cho trang quản trị -
// LEFT JOIN để user chưa có ghi chú nào vẫn xuất hiện (COUNT trả 0), LEFT
// JOIN thêm Users để hiện tên admin đang quản lý mỗi user (nếu có).
// scopeAdminId: null (root) = thấy toàn bộ; có giá trị (admin thường) = chỉ
// thấy user có ManagedByAdminId đúng bằng admin đó - ranh giới quản lý do
// root gán, admin thường không tự mở rộng phạm vi được.
export async function getAllUsersWithStats(scopeAdminId = null) {
  const pool = await getPool()
  const now = Date.now()
  const result = await pool.request()
    .input('Now', sql.BigInt, now)
    .input('ScopeAdminId', sql.Int, scopeAdminId)
    .query(`
      SELECT u.Id, u.Username, u.DisplayName, u.Email, u.Role, u.Disabled, u.CreatedAt, u.FailedLoginCount, u.LoginLockedUntil,
             u.ManagedByAdminId, m.Username AS ManagedByUsername,
             COUNT(n.ServerId) AS NoteCount,
             ISNULL(SUM(CASE WHEN n.Deleted = 0 THEN 1 ELSE 0 END), 0) AS ActiveCount,
             -- "Chưa xong"/"Hoàn thành" chỉ tính công việc (Kind='task'), khớp định nghĩa
             -- todo/done dùng ở frontend (useNotes.ts) - ghi chú (Kind='note') không có
             -- khái niệm hoàn thành nên không được gộp vào 2 cột này.
             ISNULL(SUM(CASE WHEN n.Deleted = 0 AND n.Kind = N'task' AND n.Done = 0 THEN 1 ELSE 0 END), 0) AS TodoCount,
             ISNULL(SUM(CASE WHEN n.Deleted = 0 AND n.Kind = N'task' AND n.Done = 1 THEN 1 ELSE 0 END), 0) AS DoneCount,
             ISNULL(SUM(CASE WHEN n.Deleted = 0 AND n.Kind = N'task' AND n.Done = 0 AND n.DueAt IS NOT NULL AND n.DueAt < @Now THEN 1 ELSE 0 END), 0) AS OverdueCount
      FROM Users u
      LEFT JOIN Notes n ON n.UserId = u.Id
      LEFT JOIN Users m ON m.Id = u.ManagedByAdminId
      WHERE @ScopeAdminId IS NULL OR u.ManagedByAdminId = @ScopeAdminId
      GROUP BY u.Id, u.Username, u.DisplayName, u.Email, u.Role, u.Disabled, u.CreatedAt, u.FailedLoginCount, u.LoginLockedUntil, u.ManagedByAdminId, m.Username
      ORDER BY u.CreatedAt DESC
    `)
  return result.recordset.map(u => ({
    id: u.Id, username: u.Username, displayName: u.DisplayName, email: u.Email,
    role: u.Role, disabled: Boolean(u.Disabled), createdAt: Number(u.CreatedAt),
    // Chỉ trả thời điểm hết chặn khi còn hiệu lực - chặn đã hết hạn coi như không chặn.
    loginLockedUntil: u.LoginLockedUntil !== null && Number(u.LoginLockedUntil) > now ? Number(u.LoginLockedUntil) : null,
    failedLoginCount: u.FailedLoginCount,
    managedByAdminId: u.ManagedByAdminId, managedByUsername: u.ManagedByUsername,
    noteCount: u.NoteCount, activeCount: u.ActiveCount, todoCount: u.TodoCount, doneCount: u.DoneCount, overdueCount: u.OverdueCount
  }))
}

// Root phân quyền admin cho 1 user thường (không thăng cấp được user đã là
// admin/root). Không tự gán quản lý gì cho admin mới - root gán riêng bằng
// assignUserToAdmin() sau đó.
export async function promoteToAdmin(userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Id', sql.Int, userId)
    // User được thăng cấp không còn là "thành viên" do admin khác quản lý.
    .query(`UPDATE Users SET Role = N'admin', ManagedByAdminId = NULL WHERE Id = @Id AND Role = N'user'`)
  return result.rowsAffected[0] > 0
}

// Hạ cấp admin thường về user - đồng thời BỎ GÁN mọi user đang do admin đó
// quản lý (ManagedByAdminId = NULL), tránh còn sót tham chiếu tới một admin
// không còn quyền quản lý ai. Không hạ được root (chỉ nhắm Role='admin').
export async function demoteToUser(userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Id', sql.Int, userId)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @Affected INT = 0;
      IF EXISTS (SELECT 1 FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Id = @Id AND Role = N'admin')
      BEGIN
        UPDATE Users SET ManagedByAdminId = NULL WHERE ManagedByAdminId = @Id;
        UPDATE Users SET Role = N'user' WHERE Id = @Id AND Role = N'admin';
        SET @Affected = @@ROWCOUNT;
      END
      COMMIT TRANSACTION;
      SELECT @Affected AS affected;
    `)
  return result.recordset[0].affected > 0
}

// Root gán 1 user thường (Role='user') cho 1 admin thường (Role='admin')
// quản lý. Không cho gán admin/root làm "thành viên" của ai, và không cho
// gán vào 1 tài khoản không phải admin - tránh dữ liệu phân quyền sai logic.
export async function assignUserToAdmin(userId, adminId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Id', sql.Int, userId)
    .input('AdminId', sql.Int, adminId)
    .query(`
      UPDATE Users SET ManagedByAdminId = @AdminId
      WHERE Id = @Id AND Role = N'user'
        AND EXISTS (SELECT 1 FROM Users WHERE Id = @AdminId AND Role = N'admin');
    `)
  return result.rowsAffected[0] > 0
}

export async function unassignUser(userId) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Id', sql.Int, userId)
    .query(`UPDATE Users SET ManagedByAdminId = NULL WHERE Id = @Id AND Role = N'user' AND ManagedByAdminId IS NOT NULL`)
  return result.rowsAffected[0] > 0
}

// Ghi nhận 1 lần đăng nhập sai và trả { count, lockedUntil } SAU khi ghi.
// Trong 1 câu lệnh có khóa dòng (UPDLOCK) nên 2 lần sai gửi cùng lúc không đếm lệch.
// Bộ đếm tính lại từ 1 khi: lần sai trước đã quá cửa sổ `windowMs`, hoặc lần
// chặn trước đã hết hạn. Đủ `maxAttempts` lần -> chặn tới now + lockMs.
export async function recordFailedLogin(userId, now, { maxAttempts, windowMs, lockMs }) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Id', sql.Int, userId)
    .input('Now', sql.BigInt, now)
    .input('Window', sql.BigInt, windowMs)
    .input('Max', sql.Int, maxAttempts)
    .input('LockUntil', sql.BigInt, now + lockMs)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @Count INT;
      SELECT @Count = CASE
          WHEN LoginLockedUntil IS NOT NULL AND LoginLockedUntil <= @Now THEN 1
          WHEN LastFailedLoginAt IS NULL OR @Now - LastFailedLoginAt > @Window THEN 1
          ELSE FailedLoginCount + 1 END
      FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Id = @Id;
      UPDATE Users SET FailedLoginCount = @Count, LastFailedLoginAt = @Now,
             LoginLockedUntil = CASE WHEN @Count >= @Max THEN @LockUntil ELSE NULL END
      WHERE Id = @Id;
      COMMIT TRANSACTION;
      SELECT FailedLoginCount, LoginLockedUntil FROM Users WHERE Id = @Id;
    `)
  const row = result.recordset[0]
  return { count: row.FailedLoginCount, lockedUntil: row.LoginLockedUntil === null ? null : Number(row.LoginLockedUntil) }
}

// Đăng nhập đúng, hoặc admin quản lý tài khoản (root: mọi tài khoản) mở chặn.
export async function clearLoginLock(userId) {
  const pool = await getPool()
  await pool.request()
    .input('Id', sql.Int, userId)
    .query('UPDATE Users SET FailedLoginCount = 0, LastFailedLoginAt = NULL, LoginLockedUntil = NULL WHERE Id = @Id')
}

export async function setUserDisabled(userId, disabled) {
  const pool = await getPool()
  await pool.request()
    .input('Id', sql.Int, userId)
    .input('Disabled', sql.Bit, disabled ? 1 : 0)
    .query('UPDATE Users SET Disabled = @Disabled WHERE Id = @Id')
}

export async function updateUserByAdmin(userId, { displayName, email }) {
  const pool = await getPool()
  await pool.request()
    .input('Id', sql.Int, userId)
    .input('DisplayName', sql.NVarChar(100), displayName)
    .input('Email', sql.NVarChar(255), email)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      IF @Email IS NOT NULL AND EXISTS (SELECT 1 FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email AND Id <> @Id)
        THROW 50003, N'Email đã được dùng cho tài khoản khác', 1;
      UPDATE Users SET DisplayName = @DisplayName, Email = @Email WHERE Id = @Id;
      COMMIT TRANSACTION;
    `)
}

// Nhật ký hành động quản trị - ghi lại ai (actor) làm gì (action) với ai
// (target, có thể null cho hành động không gắn 1 target cụ thể) lúc nào.
// Không throw ra ngoài nếu actor/target không còn tồn tại - FK đảm bảo tính
// toàn vẹn, còn việc ghi log thất bại không được làm hỏng hành động chính đã
// thực hiện thành công trước đó (app.js gọi hàm này kiểu "cố ghi log, lỗi thì
// chỉ log ra console" - xem app.js).
export async function logAdminAction({ actorId, actorUsername, targetId = null, targetUsername = null, action, details = null }) {
  const pool = await getPool()
  await pool.request()
    .input('ActorUserId', sql.Int, actorId)
    .input('ActorUsername', sql.NVarChar(100), actorUsername)
    .input('TargetUserId', sql.Int, targetId)
    .input('TargetUsername', sql.NVarChar(100), targetUsername)
    .input('Action', sql.NVarChar(30), action)
    .input('Details', sql.NVarChar(500), details)
    .input('CreatedAt', sql.BigInt, Date.now())
    .query(`
      INSERT INTO AdminAuditLog (ActorUserId, ActorUsername, TargetUserId, TargetUsername, Action, Details, CreatedAt)
      VALUES (@ActorUserId, @ActorUsername, @TargetUserId, @TargetUsername, @Action, @Details, @CreatedAt);
    `)
}

// Chỉ root xem được (app.js) - 200 dòng gần nhất là đủ cho phạm vi demo,
// không cần phân trang (đã quyết định không làm phân trang ở giai đoạn này).
export async function getAdminAuditLog(limit = 200) {
  const pool = await getPool()
  const result = await pool.request()
    .input('Limit', sql.Int, limit)
    .query(`SELECT TOP (@Limit) * FROM AdminAuditLog ORDER BY CreatedAt DESC, Id DESC`)
  return result.recordset.map(r => ({
    id: r.Id, actorId: r.ActorUserId, actorUsername: r.ActorUsername,
    targetId: r.TargetUserId, targetUsername: r.TargetUsername,
    action: r.Action, details: r.Details, createdAt: Number(r.CreatedAt)
  }))
}

export async function closeDatabase() { await sql.close() }
