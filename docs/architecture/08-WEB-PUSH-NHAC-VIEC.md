# Kiến trúc Web Push và nhắc việc

[← Mục lục](00-MUC-LUC.md)

Tính năng này chỉ được mô tả và kiểm thử trên Chrome/Edge desktop mở URL HTTPS của server. Không có phạm vi cài đặt hoặc nhận thông báo trên điện thoại/mobile.

## 1. Các thành phần

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    User[Người dùng] --> Dialog[ReminderDialog]
    Dialog --> Browser[Notification + PushManager]
    Browser --> SW[Service Worker]
    Browser -->|subscription| API[Express Push API]
    API --> SQL[(PushSubscriptions)]

    Scheduler[Scheduler mỗi phút] --> SQL
    Scheduler --> PushLib[web-push + VAPID]
    PushLib --> Provider[FCM / WNS / Mozilla / Apple]
    Provider --> SW
    SW --> Notification[Thông báo hệ điều hành]
```

Nhắc việc chính thức dùng bản production qua URL HTTPS của server có Service Worker; preview chỉ phục vụ kiểm thử tại máy kỹ thuật. Chế độ Vite development không đăng ký Service Worker cho tính năng này.

## 2. Bật nhắc việc trên một profile trình duyệt desktop

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    actor U as Người dùng
    participant UI as Frontend
    participant SW as Service Worker
    participant Push as PushManager
    participant API as Backend
    participant SQL as SQL Server

    U->>UI: Bật nhắc việc
    UI->>API: GET /api/push/config
    API-->>UI: enabled + VAPID public key
    UI->>U: Xin quyền Notification
    U-->>UI: granted
    UI->>SW: Lấy registration
    UI->>Push: subscribe(publicKey)
    Push-->>UI: endpoint + p256dh + auth
    UI->>API: POST /api/push/subscribe
    API->>API: Validate endpoint và keys
    API->>SQL: Upsert subscription theo user
    API-->>UI: ok
```

Mỗi profile Chrome/Edge desktop là một subscription. Đăng xuất sẽ cố xóa subscription trên server rồi hủy subscription trong trình duyệt để người dùng tiếp theo trên cùng máy không nhận nhắc việc của tài khoản trước.

## 3. Quét và gửi nhắc việc

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    participant Timer as Scheduler 60 giây
    participant SQL as SQL Server
    participant Push as web-push
    participant Provider as Push provider
    participant SW as push-sw.js

    Timer->>SQL: claimDueReminders, limit 200
    SQL-->>Timer: Công việc đến hạn, đã claim chống trùng
    Timer->>Timer: Gom theo user
    alt User có hơn 3 việc
        Timer->>Push: Một thông báo tóm tắt
    else Tối đa 3 việc
        Timer->>Push: Một thông báo cho mỗi việc
    end
    Push->>Provider: Payload mã hóa + VAPID
    Provider->>SW: Push event
    SW->>SW: Định dạng giờ theo múi giờ thiết bị
    SW-->>SW: showNotification
```

## 4. Chống gửi trùng và phục hồi lỗi

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart TD
    Due[Việc tới ngưỡng nhắc] --> Claim{INSERT NoteReminders}
    Claim -->|Khóa mới| Send[Gửi tới mọi profile desktop]
    Claim -->|Đã tồn tại| Skip[Bỏ qua, đã nhắc]
    Send --> Result{Kết quả}
    Result -->|Có ít nhất một profile nhận| Done[Giữ dấu đã nhắc]
    Result -->|404 hoặc 410| Gone[Xóa subscription hết hiệu lực]
    Result -->|Mọi profile lỗi tạm thời| Release[Xóa claim để lượt sau thử lại]
```

- Khóa chính `(ServerId, DueAt)` đảm bảo cùng một hạn chỉ claim một lần.
- Đổi hạn tạo cặp khóa mới nên được nhắc lại.
- Hai scheduler chạy chồng nhau không gửi trùng nhờ khóa database.
- Endpoint 404/410 được dọn tự động.
- Nếu toàn bộ profile trình duyệt lỗi tạm thời, claim được trả lại để retry.

## 5. Bảo mật

- Backend chỉ chấp nhận endpoint HTTPS thuộc các push provider đã cho phép, hạn chế SSRF.
- Subscription luôn gắn với user lấy từ JWT.
- Route unsubscribe chỉ xóa endpoint thuộc chính người gọi.
- VAPID private key chỉ nằm ở backend; frontend chỉ nhận public key.
- Payload được Web Push mã hóa cho khóa của subscription.

## 6. Điều kiện triển khai

- URL HTTPS chính thức của server; localhost chỉ dùng khi kiểm thử trên máy kỹ thuật.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` hợp lệ.
- Trình duyệt hỗ trợ Service Worker, Push API và Notification API.
- Người dùng đã cấp quyền notification.
- Backend phải chạy liên tục để scheduler quét mỗi phút; nhận push khi tab đóng còn phụ thuộc trình duyệt desktop và hệ điều hành cho phép chạy nền.
