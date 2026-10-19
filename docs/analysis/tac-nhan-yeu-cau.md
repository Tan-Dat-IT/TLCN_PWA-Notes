# Tác nhân và yêu cầu hệ thống

## Tác nhân

| Tác nhân | Quyền và mục tiêu |
| --- | --- |
| Khách | Đăng ký, đăng nhập, yêu cầu khôi phục mật khẩu |
| Người dùng | Quản lý dữ liệu của chính mình, đồng bộ, dùng AI, thống kê và nhắc việc |
| Admin | Quản lý các user được root gán; xem dữ liệu chỉ đọc và xử lý tài khoản |
| Root | Quản lý toàn bộ tài khoản, phân quyền, gán quản lý và xem nhật ký |
| Trình duyệt/PWA | Lưu offline, phát hiện kết nối, đồng bộ và nhận Web Push |
| Dịch vụ phụ trợ | SQL Server, Ollama, SMTP và dịch vụ push của trình duyệt |

## Yêu cầu chức năng

1. Đăng ký, đăng nhập, đổi và khôi phục mật khẩu.
2. CRUD ghi chú/công việc, tag, tìm kiếm, lọc và xóa mềm/khôi phục.
3. Công việc có lịch tùy chọn, trạng thái hoàn thành và nhận diện quá hạn.
4. Hoạt động offline sau lần tải thành công; dữ liệu ghi vào IndexedDB trước.
5. Tự đồng bộ hai chiều, đồng bộ delta và hiển thị trạng thái.
6. Phát hiện xung đột theo phiên bản và cho người dùng chọn cách giải quyết.
7. Cô lập ghi chú theo tài khoản; quản trị user/admin/root theo phạm vi.
8. Trợ lý AI local tạo bản nháp, hỏi kho tri thức và mô phỏng kế hoạch.
9. Thống kê tiến độ và nhắc việc bằng Web Push.

## Yêu cầu phi chức năng

- Chạy ổn định trên Chrome/Edge desktop.
- Không mất dữ liệu đã commit vào IndexedDB khi mất mạng đột ngột.
- API kiểm tra dữ liệu đầu vào và dùng truy vấn SQL có tham số.
- Mật khẩu băm bằng bcrypt; JWT có secret riêng; bí mật chỉ nằm trong `.env`.
- Production phục vụ frontend/API cùng origin và dùng HTTPS khi truy cập qua LAN.
- Migration chạy lại an toàn và không xóa dữ liệu người dùng.
- Có kiểm thử tự động và kịch bản kiểm thử thủ công cho các luồng chính.

## Bảy nhiệm vụ của đề cương

1. Khảo sát và xác định phạm vi.
2. Phân tích yêu cầu và tác nhân.
3. Thiết kế kiến trúc, dữ liệu và giao thức đồng bộ.
4. Xây dựng frontend PWA offline-first.
5. Xây dựng backend, SQL Server, xác thực và phân quyền.
6. Tích hợp AI, thống kê, nhắc việc và kiểm thử.
7. Triển khai, đánh giá, viết báo cáo và chuẩn bị bảo vệ.
