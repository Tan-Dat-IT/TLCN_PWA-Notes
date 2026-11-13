# Kiểm thử xung đột đồng bộ

## Hai trình duyệt sửa cùng bản

1. Mở cùng tài khoản trên hai profile A/B và đồng bộ cùng một ghi chú.
2. Ngắt mạng ở B.
3. A sửa nội dung và đồng bộ thành công.
4. B sửa cùng ghi chú rồi bật mạng.
5. Xác nhận B nhận trạng thái xung đột, không ghi đè bản A.
6. Lần lượt kiểm tra ba lựa chọn: giữ bản của tôi, dùng bản server, giữ cả hai.

## Lệch đồng hồ thiết bị

Thay đổi đồng hồ hoặc giả lập timestamp client lệch nhưng giữ `baseVersion` cũ. Kết quả vẫn phải dựa trên `Version` server; timestamp không được làm bản cũ thắng âm thầm.

## Mất phản hồi mạng

Ngắt phản hồi sau khi server đã xử lý push rồi gửi lại cùng UUID/version. Server phải trả kết quả idempotent hoặc trạng thái hiện tại, không tạo dòng trùng.

## Bằng chứng cần lưu

- Ảnh bảng so sánh xung đột.
- Request/response của `/api/notes/sync` đã loại token.
- Truy vấn SQL cho ServerId thử trước và sau khi giải quyết.
