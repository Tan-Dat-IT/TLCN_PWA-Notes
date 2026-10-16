# Luồng đồng bộ offline và xử lý xung đột

[← Mục lục](00-MUC-LUC.md)

## 1. Mô hình đồng bộ hiện tại

Mỗi “client” trong sơ đồ là một profile/tab Chrome hoặc Edge desktop mở cùng URL server. Đồng bộ gồm hai cơ chế độc lập:

- `Version`: kiểm soát ghi lạc quan, phát hiện hai profile trình duyệt cùng sửa một bản.
- `RowVer`: cursor đọc delta, chỉ tải những dòng SQL thay đổi sau lần trước.

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    Local[Note local] -->|baseVersion| Push[POST /api/notes/sync]
    Push --> Check{Khớp Version server?}
    Check -->|Có| Applied[Tăng Version và ghi]
    Check -->|Không| Conflict[Trả bản server]
    Check -->|ServerId thuộc user khác| Rejected[Rejected]

    Cursor[syncCursor] --> Pull[GET /api/notes?since=cursor]
    Pull --> Delta[Notes có RowVer mới hơn]
    Delta --> NewCursor[Cursor mới]
```

## 2. Một lượt đồng bộ đầy đủ

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    participant UI as useSync
    participant DB as IndexedDB
    participant API as Express API
    participant SQL as SQL Server

    UI->>API: GET /api/notes/protocol
    API-->>UI: version=3
    UI->>DB: Gán serverId cho note chưa có

    alt Profile trình duyệt chưa có cursor
        UI->>API: GET /api/notes?since=0
        API->>SQL: Đọc delta theo UserId + RowVer
        SQL-->>API: Trang dữ liệu
        API-->>UI: notes, cursor, hasMore, reset
        UI->>DB: Áp dụng remote trước khi push
    end

    loop Mỗi batch tối đa 3 note pending
        UI->>API: POST /api/notes/sync + baseVersion
        API->>SQL: Upsert có kiểm tra Version và UserId
        SQL-->>API: applied / conflict / rejected
        API-->>UI: Kết quả theo từng note
        UI->>DB: Ghi version/conflict/serverId mới
    end

    loop Tới khi hasMore=false
        UI->>API: GET /api/notes?since=cursor
        API->>SQL: Đọc tối đa 500 + 1 dòng
        API-->>UI: Delta và cursor tiếp theo
        UI->>DB: Transaction áp dụng page + lưu cursor
    end
```

## 3. Quyết định khi áp dụng bản remote

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart TD
    Remote[Bản remote] --> Exists{Có local cùng serverId?}
    Exists -->|Không| Add[Thêm local synced=1]
    Exists -->|Có| Legacy{baseVersion undefined?}
    Legacy -->|Có, local đã synced| Replace[Nhận bản server]
    Legacy -->|Có, local pending| Attach[Gắn version; tạo conflict nếu nội dung khác]
    Legacy -->|Không| LocalState{Local đang synced?}
    LocalState -->|Có| Version{Remote mới hơn hoặc bằng?}
    Version -->|Có| Replace
    Version -->|Không| Requeue[Server có thể đã restore; đưa local về pending]
    LocalState -->|Không| HasConflict{Đã có conflict?}
    HasConflict -->|Có| Refresh[Chỉ cập nhật snapshot nếu server mới hơn]
    HasConflict -->|Không| Wait[Giữ local; push sẽ kiểm tra baseVersion]
```

## 4. Xử lý xung đột

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
stateDiagram-v2
    [*] --> Editing: Hai profile cùng có Version N
    Editing --> ServerN1: Profile A ghi thành công
    ServerN1 --> Conflict: Profile B gửi baseVersion N
    Conflict --> AcceptServer: Chọn bản server
    Conflict --> KeepMine: Giữ bản của tôi
    AcceptServer --> Synced
    KeepMine --> NewCopyPending: Tạo UUID mới, baseVersion null
    NewCopyPending --> Synced: Gửi như note mới
```

Không có chiến lược “timestamp mới nhất thắng”. `updatedAt` chỉ hỗ trợ hiển thị và một số quyết định tương thích dữ liệu cũ; quyền ghi được quyết định bởi `Version` server.

## 5. Phục hồi tình huống lỗi

| Tình huống | Cách xử lý |
| --- | --- |
| Mất mạng | Giữ `synced=0`, tự thử lại khi online |
| Server nhận ghi nhưng response bị mất | UUID giữ nguyên; bản server version 1 được nhận làm gốc thay vì tạo conflict giả |
| Cursor không hợp lệ do database restore | Server trả `reset`; client tải lại toàn bộ rồi mới đối chiếu orphan |
| `hasMore=true` nhưng cursor đứng yên | Dừng và báo lỗi để tránh vòng lặp vô hạn |
| Quá 1000 trang trong một lượt | Dừng an toàn, giữ dữ liệu đã có và yêu cầu đồng bộ tiếp |
| Remote sai schema/giới hạn | Không áp dụng vào IndexedDB |
| `serverId` thuộc tài khoản khác | Server trả `rejected`; client đổi UUID rồi gửi lại |
| Đổi tài khoản trên cùng trình duyệt | Xóa cả notes và cursor local trước khi dùng tài khoản mới |

## 6. Các giới hạn có chủ đích

- Không có background sync bảo đảm chạy khi PWA đã đóng hoàn toàn.
- Xung đột cần người dùng chọn, hệ thống không tự ghép nội dung văn bản.
- Một lượt pull giới hạn 1000 trang để chống response/server bất thường.
- Sync theo eventual consistency: dữ liệu giữa hai profile desktop có thể lệch tạm thời trước lượt đồng bộ kế tiếp.
