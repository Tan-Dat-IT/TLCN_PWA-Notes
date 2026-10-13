# Ghi chú tìm hiểu PWA Service Worker và IndexedDB

## Mục tiêu khảo sát

Tài liệu này tổng hợp các nền tảng được dùng trong PWA Notes: Web App Manifest, Service Worker, Cache Storage và IndexedDB qua Dexie. Trọng tâm là ứng dụng desktop chạy được khi mất mạng và đồng bộ khi kết nối trở lại.

## Các thành phần chính

| Thành phần | Vai trò trong project | Giới hạn |
| --- | --- | --- |
| Web App Manifest | Khai báo tên, biểu tượng, màu giao diện và chế độ hiển thị độc lập | Không tự tạo khả năng offline |
| Service Worker | Lưu app shell và phục vụ lại tài nguyên giao diện khi mất mạng | Không phải nơi lưu dữ liệu ghi chú chính |
| Cache Storage | Lưu HTML, JavaScript, CSS và icon đã build | Xóa cache không đồng nghĩa xóa IndexedDB |
| IndexedDB | Lưu ghi chú, hàng đợi đồng bộ, phiên bản và con trỏ delta | Dữ liệu gắn với origin và profile trình duyệt |
| Dexie | Cung cấp API và migration dễ kiểm soát hơn cho IndexedDB | Vẫn phải xử lý transaction và nâng schema cẩn thận |

## Chiến lược áp dụng

1. Mọi thao tác CRUD ghi vào IndexedDB trước để giao diện phản hồi ngay.
2. Bản ghi thay đổi được đánh dấu chờ đồng bộ.
3. Khi online, client đẩy thay đổi lên API và kéo delta mới từ SQL Server.
4. Service Worker chỉ cache app shell; các request `/api/` không dùng cache runtime.
5. Xung đột được phát hiện bằng phiên bản server, không dựa vào đồng hồ thiết bị.

## Điều kiện kiểm tra

- Lần đầu phải mở ứng dụng khi có mạng để Service Worker và app shell được cài.
- Kiểm tra offline trên bản build/preview hoặc production, không lấy Vite dev làm bằng chứng đầy đủ.
- `localhost`, `127.0.0.1` và các cổng khác nhau là các origin khác nhau; IndexedDB không dùng chung giữa chúng.
- Web Push cần HTTPS ở máy client; ngoại lệ secure context của `localhost` chỉ dùng trên chính máy chạy trình duyệt.

## Liên kết trong project

- Cấu hình PWA: `frontend/vite.config.ts`.
- Schema local: `frontend/src/db/database.ts`.
- Đồng bộ: `frontend/src/db/sync.ts` và `frontend/src/hooks/useSync.ts`.
- Kiến trúc chi tiết: `docs/architecture/02-KIEN-TRUC-FRONTEND-PWA.md`.
