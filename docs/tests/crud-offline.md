# Kiểm thử thủ công CRUD khi bật tắt mạng

## Chuẩn bị

- Dùng bản production hoặc `npm run build` rồi `npm run preview`.
- Đăng nhập bằng tài khoản thử riêng và mở DevTools > Network.
- Ghi lại UUID/tiêu đề có tiền tố `QA-CRUD-` để dọn đúng dữ liệu sau kiểm tra.

## Các bước

| Bước | Thao tác | Kết quả mong đợi |
| ---: | --- | --- |
| 1 | Online, tạo ghi chú và công việc có tag/lịch | Hiện ngay; sau đồng bộ không còn trạng thái chờ |
| 2 | Chuyển Network sang Offline | Thanh trạng thái báo offline |
| 3 | Thêm ghi chú, sửa công việc, hoàn thành và xóa mềm | Mọi thao tác vẫn thành công trong UI |
| 4 | Tải lại trang khi offline | Dữ liệu vừa thao tác vẫn còn trong IndexedDB |
| 5 | Khôi phục mục đã xóa | Mục trở lại danh sách và chờ đồng bộ |
| 6 | Bật mạng, không bấm đồng bộ | Ứng dụng tự đồng bộ; SQL nhận trạng thái cuối |
| 7 | Tải lại và mở profile thứ hai | Dữ liệu server được kéo về đúng tài khoản |

## Dọn dữ liệu

Xóa các mục có tiền tố thử nghiệm bằng giao diện, đồng bộ xong rồi kiểm tra SQL. Không xóa toàn bộ IndexedDB hoặc bảng `Notes`.
