# Kiến trúc Frontend PWA

[← Mục lục](00-MUC-LUC.md)

Frontend được sử dụng trong tab Chrome/Edge desktop qua URL server. Project không có luồng cài đặt hoặc kiểm thử mobile; thuật ngữ PWA mô tả Service Worker/cache/offline của web desktop.

## 1. Phân lớp frontend

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart TB
    subgraph Presentation[Presentation]
        App[App.tsx]
        Forms[Login / Note / Password / Email]
        Views[NoteList / Stats / Admin / Conflict]
        Status[SyncBar / ReminderDialog]
    end

    subgraph State[Hooks và trạng thái phản ứng]
        AuthHook[useAuth]
        NotesHook[useNotes]
        SyncHook[useSync]
        LiveQuery[Dexie useLiveQuery]
    end

    subgraph Data[Data access]
        AuthDB[db/auth.ts]
        NotesDB[database.ts]
        SyncDB[sync.ts]
        API[api.ts / admin.ts / ai.ts / push.ts]
    end

    subgraph Platform[Nền tảng trình duyệt]
        IDB[(IndexedDB)]
        SW[Service Worker cache]
        PushAPI[PushManager + Notification]
        Storage[localStorage JWT/profile]
    end

    Presentation --> State
    State --> Data
    LiveQuery <--> NotesDB
    NotesDB <--> IDB
    AuthDB <--> Storage
    SyncDB <--> NotesDB
    Data -->|fetch /api| Backend[Backend]
    SW --> Presentation
    API <--> PushAPI
```

## 2. Luồng thao tác ghi chú

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    actor U as Người dùng
    participant UI as React component
    participant H as useNotes
    participant DB as IndexedDB
    participant S as useSync
    participant API as Backend API

    U->>UI: Tạo hoặc sửa ghi chú
    UI->>H: addNote / updateNote
    H->>DB: put synced=0
    DB-->>UI: useLiveQuery cập nhật giao diện
    DB-->>S: pendingKey thay đổi
    S->>S: debounce 400 ms
    S->>API: Đồng bộ nếu online
    API-->>S: applied / conflict / rejected
    S->>DB: Cập nhật synced, baseVersion hoặc conflict
    DB-->>UI: Hiển thị trạng thái mới
```

UI không chờ mạng để hoàn tất thao tác. Đây là lý do ứng dụng vẫn phản hồi nhanh khi backend chậm hoặc mất kết nối.

## 3. Trạng thái dữ liệu cục bộ

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
stateDiagram-v2
    [*] --> LocalPending: Tạo/sửa/xóa
    LocalPending --> Synced: Server chấp nhận
    LocalPending --> Conflict: baseVersion không khớp
    LocalPending --> LocalPending: Mất mạng/lỗi thử lại được
    Conflict --> LocalPending: Giữ bản của tôi thành bản sao
    Conflict --> Synced: Chọn bản server
    Synced --> LocalPending: Người dùng sửa tiếp
```

- `synced=0` và không có `conflict`: có thể tự gửi.
- Có `conflict`: chờ người dùng quyết định, không retry vô ích.
- `deleted=1`: xóa mềm, vẫn cần đồng bộ hành động xóa.

## 4. PWA và cache

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    Build[Vite production build] --> Workbox[vite-plugin-pwa / Workbox]
    Workbox --> Precache[Precache HTML, JS, CSS, icon]
    Workbox --> SW[Service Worker]
    PushSW[public/push-sw.js] -->|importScripts| SW

    Browser -->|Điều hướng| SW
    SW -->|App shell cache-first| Browser
    Browser -->|/api không cache| API[Backend]
```

Các API bị loại khỏi navigation fallback. Service Worker giữ phần giao diện; dữ liệu nghiệp vụ nằm trong IndexedDB, không nằm trong HTTP cache.

## 5. Các cơ chế tự đồng bộ

- Sau thay đổi local: debounce khoảng 400 ms.
- Khi lỗi tạm thời hoặc còn pending: thử lại mỗi 3 giây.
- Khi online lại, focus lại hoặc tab trở nên visible: đồng bộ ngay.
- Khi app đang mở: kiểm tra định kỳ mỗi 30 giây.
- `navigator.locks` ngăn nhiều lượt sync trong cùng trình duyệt chạy chồng nhau; biến `running` ngăn lời gọi trùng trong cùng context.

## 6. Tối ưu giao diện

- Bộ đếm active/todo/done/overdue/pending/conflict/trash được tính trong một lượt duyệt.
- Dexie index các trường lọc thường dùng như `synced`, `deleted`, `serverId`, `kind`, `dueAt`.
- `AdminPanel` và `StatsCharts` là chunk lazy, không làm nặng luồng chính.
- `useLiveQuery` chỉ cập nhật UI khi dữ liệu IndexedDB liên quan thay đổi.
