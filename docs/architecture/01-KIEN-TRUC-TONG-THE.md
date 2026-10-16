# Kiến trúc tổng thể

[← Mục lục](00-MUC-LUC.md)

## 1. Bối cảnh hệ thống

PWA Notes là ứng dụng web desktop quản lý ghi chú và công việc theo hướng offline-first. Người dùng mở một URL chính thức của server bằng Chrome/Edge trên desktop/laptop; không cài ứng dụng mobile. Thao tác được ghi cục bộ trước, khi có mạng trình duyệt đồng bộ với backend. Backend là biên tin cậy duy nhất cho xác thực, phân quyền và dữ liệu dùng chung giữa các profile trình duyệt.

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    User[Người dùng desktop] --> Browser[Chrome / Edge]
    Admin[Admin / Root] --> Browser

    Browser <-->|URL HTTPS của server<br/>JSON + JWT| API[Express API]
    Browser <-->|IndexedDB| Local[(Dexie / IndexedDB)]
    Browser <-->|Cache app shell| SW[Service Worker]

    API <-->|T-SQL tham số hóa| SQL[(SQL Server)]
    API <-->|HTTP nội bộ| Ollama[Ollama local]
    API -->|SMTP| Mail[Máy chủ email]
    API -->|Web Push + VAPID| Push[FCM / WNS / Mozilla / Apple]
    Push --> Device[Thông báo hệ điều hành desktop]
```

## 2. Kiến trúc container

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart TB
    subgraph Client[Frontend React + TypeScript]
        UI[Components và màn hình]
        Hooks[useAuth / useNotes / useSync]
        ClientAPI[API clients]
        Sync[Sync engine]
        IDB[(IndexedDB)]
        Worker[Workbox Service Worker<br/>+ push-sw.js]

        UI --> Hooks
        Hooks --> ClientAPI
        Hooks --> Sync
        Hooks <--> IDB
        Sync <--> IDB
        Sync --> ClientAPI
        Worker --> UI
    end

    subgraph Server[Backend Node.js + Express]
        Routes[Routes]
        Middleware[Auth / RBAC / Rate limit / Validation]
        Store[Store SQL]
        AISvc[AI service]
        Mailer[Mailer]
        Reminder[Reminder scheduler]

        Routes --> Middleware
        Routes --> Store
        Routes --> AISvc
        Routes --> Mailer
        Reminder --> Store
    end

    ClientAPI <-->|/api/*| Routes
    Store <--> DB[(SQL Server)]
    AISvc --> LocalAI[Ollama]
    Mailer --> SMTP[SMTP]
    Reminder --> WebPush[Push service]
```

## 3. Nguyên tắc thiết kế

| Nguyên tắc | Cách hiện thực |
| --- | --- |
| Offline-first | Ghi vào IndexedDB trước, đồng bộ nền khi có mạng |
| Server là nguồn phân quyền | `UserId` lấy từ JWT; client không được chọn chủ sở hữu dữ liệu |
| Không ghi đè âm thầm | Mỗi bản ghi có `Version`; sai `baseVersion` tạo xung đột |
| Đồng bộ tăng dần | `RowVer` làm cursor, chỉ tải các dòng thay đổi |
| Tách lỗi hạ tầng khỏi dữ liệu | SQL/AI/SMTP/Push có xử lý lỗi độc lập; dữ liệu local vẫn được giữ |
| Tương thích dữ liệu cũ | Migration SQL và Dexie có phiên bản nâng cấp tại chỗ |
| Giảm tải ban đầu | `AdminPanel` và `StatsCharts` được lazy-load |

## 4. Ranh giới tin cậy

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    Untrusted[Client không đáng tin cậy] -->|JWT + dữ liệu cần validate| Boundary{Express middleware}
    Boundary -->|Đã xác thực và chuẩn hóa| Trusted[Store / nghiệp vụ server]
    Trusted --> SQL[(SQL Server)]
    Trusted --> External[Dịch vụ ngoài]

    Boundary -. từ chối .-> E401[401 chưa đăng nhập]
    Boundary -. từ chối .-> E403[403 không đủ quyền]
    Boundary -. từ chối .-> E400[400 dữ liệu sai]
```

Backend không tin `UserId`, role, trạng thái đồng bộ hoặc phiên bản do client tự suy diễn. Mọi truy vấn ghi chú đều lấy chủ sở hữu từ `req.user.sub` sau khi JWT và trạng thái tài khoản đã được xác minh.

## 5. Điểm vào mã nguồn

- Frontend: `frontend/src/main.tsx`, `frontend/src/App.tsx`.
- Local database: `frontend/src/db/database.ts`.
- Sync engine: `frontend/src/db/sync.ts`.
- Backend bootstrap: `backend/src/server.js`.
- API composition: `backend/src/app.js`.
- SQL access: `backend/src/store.js`.
- Schema và migration: `backend/schema.sql`, `backend/migrations/`.
