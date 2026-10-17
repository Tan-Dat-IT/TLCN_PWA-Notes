# Kiến trúc xác thực và phân quyền

[← Mục lục](00-MUC-LUC.md)

## 1. Đăng nhập và xác minh mỗi request

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    actor U as Người dùng
    participant UI as LoginForm
    participant API as /api/auth/login
    participant SQL as Users
    participant JWT as JWT signer

    U->>UI: username + password
    UI->>API: POST login
    API->>SQL: Tìm user và trạng thái khóa
    alt Đang bị tạm chặn
        API-->>UI: 429 + lockedUntil
    else Sai thông tin
        API->>SQL: Tăng FailedLoginCount
        API-->>UI: 401 hoặc 429
    else Đúng và chưa disabled
        API->>SQL: Xóa bộ đếm lỗi nếu có
        API->>JWT: Ký token chứa sub + username
        JWT-->>UI: token + profile
    end
```

Với mỗi API được bảo vệ, `requireAuth` không chỉ kiểm tra chữ ký JWT mà còn tải lại user từ SQL. Vì vậy thao tác khóa tài khoản hoặc đổi role có hiệu lực ngay, không phải chờ token hết hạn.

## 2. Chuỗi middleware RBAC

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    Request --> Auth{requireAuth}
    Auth -->|Không hợp lệ/disabled| E401[401]
    Auth -->|User hiện tại| NeedAdmin{Route admin?}
    NeedAdmin -->|Không| UserRoute[Route người dùng]
    NeedAdmin -->|Có| Admin{requireAdmin}
    Admin -->|role=user| E403[403]
    Admin -->|admin/root| NeedRoot{Route chỉ root?}
    NeedRoot -->|Không| Scope[Kiểm tra phạm vi quản lý]
    NeedRoot -->|Có| Root{requireRoot}
    Root -->|admin| E403
    Root -->|root| RootRoute[Route root]
```

## 3. Ma trận quyền

| Khả năng | User | Admin | Root |
| --- | :---: | :---: | :---: |
| CRUD và đồng bộ note của chính mình | Có | Có | Có |
| Xem trang quản trị | Không | Có | Có |
| Xem note user khác | Không | Chỉ user được giao, chỉ đọc | Mọi user, chỉ đọc |
| Sửa/khóa/reset mật khẩu user | Không | Chỉ user được giao | Mọi tài khoản hợp lệ |
| Tạo user từ trang quản trị | Không | Không | Có |
| Thăng/hạ admin | Không | Không | Có |
| Gán/bỏ gán user cho admin | Không | Không | Có |
| Xem audit log | Không | Không | Có |

Admin/root không có route sửa hoặc xóa note thay người dùng; quyền quản trị nội dung chỉ là xem tiến độ và xem chi tiết ở chế độ đọc.

## 4. Phạm vi quản lý

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart TD
    Root[Root] -->|promote| AdminA[Admin]
    Root -->|assign ManagedByAdminId| UserA[User A]
    Root -->|assign ManagedByAdminId| UserB[User B]
    AdminA -->|được quản lý| UserA
    AdminA -->|được quản lý| UserB
    AdminA -. không thể tự mở rộng phạm vi .-> UserC[User khác]
```

- Chỉ user thường được mang `ManagedByAdminId`.
- Thăng user thành admin sẽ xóa liên kết quản lý cũ.
- Hạ admin thành user sẽ bỏ gán toàn bộ thành viên của admin đó trong một transaction.
- Migration 012 bảo vệ bất biến admin/root không có `ManagedByAdminId` ở tầng database.

## 5. Bảo vệ đăng nhập

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
stateDiagram-v2
    [*] --> Ready
    Ready --> Failed1: Sai mật khẩu
    Failed1 --> FailedN: Tiếp tục sai trong 15 phút
    FailedN --> Locked: Lần sai thứ 5
    Locked --> Ready: Hết 15 phút
    Locked --> Ready: Admin/root mở chặn
    FailedN --> Ready: Đăng nhập đúng
    Locked --> Ready: Đặt lại mật khẩu
```

- Tài khoản có thật được đếm trong SQL để không mất trạng thái khi restart.
- Username không tồn tại được đếm tương tự trong RAM và nhận cùng kiểu phản hồi, hạn chế dò tài khoản.
- `Disabled` là khóa thủ công; `LoginLockedUntil` là tạm chặn do nhập sai. Hai trạng thái độc lập.
- Register và forgot-password có rate limit theo IP; `trust proxy` chỉ bật khi cấu hình rõ ràng.

## 6. Khôi phục mật khẩu

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    actor U as Người dùng
    participant API as Backend
    participant SQL as SQL Server
    participant SMTP as SMTP

    U->>API: Gửi email khôi phục
    API->>SQL: Tìm email
    API-->>U: Luôn trả thông báo chung
    opt Email tồn tại
        API->>SQL: Lưu SHA-256(token) + hạn dùng
        API->>SMTP: Gửi link chứa token gốc
        U->>API: Token + mật khẩu mới
        API->>SQL: UPDATE nếu hash khớp và chưa hết hạn
        SQL-->>API: Xóa token, gỡ login lock
    end
```

Database chỉ lưu hash của reset token. Token được dùng một lần; response quên mật khẩu không tiết lộ email có tồn tại hay không.

## 7. Lưu ý triển khai bảo mật

- Production phải dùng HTTPS và đặt bí mật JWT/SMTP/VAPID ngoài source.
- `ALLOWED_ORIGINS` phải giới hạn đúng domain frontend.
- Chỉ bật `TRUST_PROXY=true` sau reverse proxy đáng tin cậy.
- JWT đang nằm trong localStorage; cần tiếp tục kiểm soát XSS và không render HTML tùy ý từ nội dung người dùng.
- Không ghi mật khẩu, reset token gốc hoặc khóa bí mật vào audit log.

