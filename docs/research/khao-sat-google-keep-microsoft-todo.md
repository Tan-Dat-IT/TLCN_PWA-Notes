# Khảo sát Google Keep Microsoft To Do và định hướng PWA Notes

## Mục tiêu

Khảo sát hai sản phẩm phổ biến để xác định các hành vi người dùng quen thuộc và giới hạn phạm vi phù hợp với tiểu luận.

| Tiêu chí | Google Keep | Microsoft To Do | PWA Notes |
| --- | --- | --- | --- |
| Nội dung chính | Ghi chú ngắn, danh sách, nhãn | Công việc, hạn, trạng thái | Ghi chú và công việc trong cùng hệ thống |
| Phân loại | Nhãn và tìm kiếm | Danh sách, trạng thái | Tag, loại nội dung, tìm kiếm và bộ lọc |
| Offline | Có hỗ trợ tùy nền tảng | Có hỗ trợ tùy nền tảng | IndexedDB là nguồn thao tác đầu tiên trên desktop |
| Đồng bộ | Dịch vụ đám mây của Google | Dịch vụ đám mây của Microsoft | Express REST API và SQL Server nội bộ |
| Xung đột | Người dùng không kiểm soát trực tiếp | Người dùng không kiểm soát trực tiếp | Hiện bảng so sánh và ba cách giải quyết |
| Nhắc việc | Tùy hệ sinh thái Google | Nhắc việc tích hợp | Web Push với VAPID trên Chrome/Edge desktop |
| AI | Dịch vụ của nhà cung cấp | Dịch vụ của nhà cung cấp | Ollama chạy cục bộ, không gọi AI cloud |

## Kết luận định hướng

PWA Notes không sao chép toàn bộ hai sản phẩm. Project chọn các chức năng phục vụ mục tiêu nghiên cứu offline-first: CRUD cục bộ, phân loại, lịch công việc, đồng bộ hai chiều, giải quyết xung đột, tài khoản và hiển thị trạng thái đồng bộ. Các phần AI, thống kê, quản trị và Web Push là mở rộng để chứng minh khả năng tích hợp của kiến trúc.

Phạm vi nghiệm thu là Chrome/Edge trên desktop hoặc laptop qua URL do server cung cấp. Mobile và dịch vụ Internet công cộng nằm ngoài phạm vi.
