# Kiểm thử đồng bộ và cô lập tài khoản

## Tạo ghi chú offline rồi bật mạng

1. Đăng nhập tài khoản A và chờ trạng thái đã đồng bộ.
2. Chuyển trình duyệt offline, tạo `QA-SYNC-A` và tải lại trang.
3. Xác nhận ghi chú còn trong danh sách và ở mục chờ đồng bộ.
4. Bật mạng, không bấm nút thủ công.
5. Xác nhận trạng thái chuyển sang đã đồng bộ và SQL có bản ghi thuộc UserId của A.

## Hai tài khoản cùng một trình duyệt

1. Ở tài khoản A, tạo và đồng bộ `QA-ACCOUNT-A`.
2. Đăng xuất đúng bằng nút của ứng dụng.
3. Đăng nhập tài khoản B trong cùng profile.
4. Xác nhận không thấy dữ liệu của A; tạo `QA-ACCOUNT-B`.
5. Đăng nhập lại A và xác nhận không thấy dữ liệu của B.

## Tiêu chí đạt

- Token không được gửi sai tài khoản.
- Local database/meta được chuyển đúng phạm vi tài khoản.
- API lấy UserId từ JWT, không tin UserId do client gửi.
- Dữ liệu thử được xóa theo đúng tài khoản sau kiểm tra.
