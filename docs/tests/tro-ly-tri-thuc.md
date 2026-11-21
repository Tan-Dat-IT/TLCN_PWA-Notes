# Kiểm thử Trợ lý tri thức và nguồn dẫn

## Chuẩn bị dữ liệu

Tạo ba ghi chú có nội dung phân biệt rõ, đồng bộ lên server và chờ embedding được tạo bằng model cấu hình.

## Kịch bản

1. Hỏi câu có đáp án trực tiếp trong một ghi chú.
2. Xác nhận câu trả lời có ký hiệu nguồn và thẻ nguồn tương ứng.
3. Bấm nguồn và kiểm tra ứng dụng mở/tìm đúng ghi chú.
4. Hỏi câu cần tổng hợp từ hai ghi chú; nguồn không được trỏ sang tài khoản khác.
5. Sửa một ghi chú, đồng bộ và hỏi lại; embedding phải được tính lại khi nội dung/version đổi.
6. Dừng Ollama; UI phải báo lỗi có thể hiểu được, không mất dữ liệu.
7. Hỏi nội dung không có trong kho; hệ thống không được bịa nguồn.

Ghi lại model embedding, thời gian phản hồi và nguồn thực tế. Xóa ba ghi chú thử sau khi hoàn tất.
