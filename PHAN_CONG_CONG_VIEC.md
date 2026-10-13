# Bảng phân công công việc - Tiểu luận chuyên ngành

**Đề tài:** Xây dựng ứng dụng web offline-first cho ghi chú và công việc trên nền tảng Progressive Web App (PWA), sử dụng trên trình duyệt desktop qua URL của server

> **Phạm vi thống nhất:** sản phẩm được triển khai cho Chrome/Edge trên desktop hoặc laptop, người dùng truy cập bằng một URL chính thức do server cung cấp. Nhóm không triển khai hoặc kiểm thử việc cài ứng dụng trên điện thoại/mobile. Phần PWA phụ trách Service Worker, cache và offline trong tab trình duyệt desktop.

**Giảng viên hướng dẫn:** Trần Quang Khải (MGV: 6452)

**Nhóm thực hiện:** 03 thành viên

**Thời gian thực hiện:** 15 tuần, từ ngày **30/09/2026** đến ngày **11/01/2027**.

| STT | Họ và tên | MSSV | Vai trò chính |
| --- | --- | --- | --- |
| 1 | Đặng Tấn Đạt | 24TX610008 | Trưởng nhóm - Kiến trúc hệ thống, Backend, Xác thực & Phân quyền, Trợ lý AI |
| 2 | Nguyễn Quốc Bảo | 24TX810057 | Frontend - Giao diện, Offline-first & PWA |
| 3 | Phạm Duy Phước | 24TX610011 | Thống kê, Markdown, Kiểm thử & Tài liệu |

---

## 1. Tỷ trọng đóng góp

| Thành viên | Tỷ trọng | Ghi chú |
| --- | --- | --- |
| **Đặng Tấn Đạt** | **40%** | Phụ trách phần lõi kỹ thuật khó nhất: thiết kế database/migration, toàn bộ API backend, cơ chế đồng bộ, xác thực, phân quyền nhiều cấp, tích hợp AI local, và điều phối chung của nhóm |
| Nguyễn Quốc Bảo | 30% | Phụ trách giao diện người dùng và toàn bộ cơ chế offline-first phía trình duyệt |
| Phạm Duy Phước | 30% | Phụ trách các tính năng phụ trợ, kiểm thử thủ công và tài liệu hướng dẫn |

---

## 2. Chi tiết công việc từng thành viên

### 2.1. Đặng Tấn Đạt (40%) - Trưởng nhóm

#### Kiến trúc & Database

- Thiết kế mô hình dữ liệu (bảng `Users`, `Notes`, `AdminAuditLog`) và toàn bộ 11 migration nâng cấp schema không mất dữ liệu.
- Thiết kế kiến trúc client-server: React/TypeScript + IndexedDB (Dexie) ở frontend, Express + SQL Server ở backend.

#### Backend & API

- Xây dựng toàn bộ REST API: ghi chú/công việc, đồng bộ hai chiều, xác thực, quản trị.
- Cơ chế đồng bộ phát hiện xung đột theo phiên bản (`Version`, khóa lạc quan trong giao dịch SQL) kèm giao diện chọn bản muốn giữ, đồng bộ delta theo `rowversion`; chống ghi trùng bằng UUID ổn định.
- Validate dữ liệu đầu vào ở cả hai lớp (client và server).
- Nhắc việc bằng Web Push: khóa VAPID, bộ lập lịch quét việc sắp đến hạn, chống gửi trùng và chống SSRF.

#### Xác thực & Phân quyền

- Đăng ký/đăng nhập bằng JWT + bcrypt; đổi mật khẩu, quên mật khẩu qua email (SMTP) kèm token dùng một lần.
- Cô lập dữ liệu tuyệt đối theo tài khoản (mỗi user chỉ thấy/thao tác được ghi chú của chính mình).
- Giới hạn tần suất đăng nhập/đăng ký chống dò mật khẩu.
- Hệ thống phân quyền 3 cấp (user - admin - root): admin gốc quản lý toàn bộ tài khoản, admin thường chỉ quản lý thành viên được gán riêng; khóa/mở khóa tài khoản có hiệu lực ngay lập tức.
- Nhật ký (audit log) ghi lại mọi hành động quản trị.

#### Trợ lý AI

- Tích hợp mô hình AI chạy local qua Ollama (không dùng dịch vụ cloud).
- Thiết kế prompt và xử lý hậu kỳ để trích xuất tiêu đề, tag, thời gian từ mô tả tự nhiên; bản nháp AI cho phép chỉnh sửa trước khi lưu.
- Xây dựng Trợ lý tri thức RAG cục bộ: tạo/cache embedding theo tài khoản, tìm kiếm ngữ nghĩa bằng cosine similarity, tổng hợp câu trả lời có dẫn nguồn và xử lý lỗi/hủy request.
- Xây dựng AI lập kế hoạch: ước lượng khối lượng/ưu tiên, thuật toán phân bổ theo năng lực và deadline, mô phỏng ba kịch bản tiến độ có fallback khi Ollama lỗi.

#### Kiểm thử & Vận hành

- Viết bộ kiểm thử tự động phía backend.
- Viết script vận hành (migration, đặt lại mật khẩu, tạo tài khoản quản trị).
- Tổng hợp và điều phối tiến độ chung của nhóm, review code trước khi hoàn thiện.

### 2.2. Nguyễn Quốc Bảo (30%)

#### Giao diện người dùng

- Xây dựng các thành phần giao diện chính: form thêm/sửa ghi chú, danh sách ghi chú, bộ lọc theo trạng thái và tag, tìm kiếm.
- Thiết kế giao diện cho các kích thước màn hình desktop/laptop phổ biến; mobile nằm ngoài phạm vi nghiệm thu.

#### Offline-first & PWA

- Triển khai lưu trữ cục bộ bằng IndexedDB (Dexie): ghi thao tác trước, đồng bộ sau.
- Cấu hình Service Worker, cache và Web App Manifest để bản web desktop mở từ URL server có thể tiếp tục hoạt động với dữ liệu đã có khi mất mạng; không bao gồm cài đặt mobile.
- Xây dựng cơ chế đồng bộ tự động phía client (theo sự kiện online/offline, chu kỳ định thời, thử lại khi lỗi) và thanh trạng thái đồng bộ hiển thị cho người dùng.

#### Kiểm thử

- Viết bộ kiểm thử tự động phía frontend cho các hook và luồng dữ liệu local.
- Kiểm tra thủ công kịch bản offline/online trên Chrome và Edge desktop, cùng truy cập URL server.

### 2.3. Phạm Duy Phước (30%)

#### Tính năng phụ trợ

- Xây dựng trang Thống kê trực quan: tách Tất cả/Ghi chú/Công việc; hoạt động tạo mới, tag, tiến độ hoàn thành, hai trạng thái quá hạn và bộ lọc 14 ngày/6 tháng.
- Xây dựng bộ định dạng văn bản nhẹ (markdown-lite) cho nội dung ghi chú.

#### Kiểm thử & Tài liệu

- Thiết kế và thực hiện các kịch bản kiểm thử thủ công đầu-cuối (E2E) cho toàn bộ luồng nghiệp vụ.
- Biên soạn tài liệu hướng dẫn cài đặt trên server, cấu hình URL truy cập desktop và vận hành hệ thống.
- Biên soạn tài liệu giải thích mã nguồn và chuẩn bị nội dung trả lời phản biện.
- Hỗ trợ kiểm tra giao diện, phát hiện lỗi hiển thị và đề xuất cải thiện trải nghiệm người dùng.

---

## 3. Kế hoạch thực hiện 15 tuần

Kế hoạch thực hiện chính thức kéo dài **15 tuần**, từ **30/09/2026** đến **11/01/2027**. Bảng dưới đây giữ nguyên thứ tự, thời gian và ngày nộp trong bảng tổng hợp tiến độ 15 tuần; phần phân công chi tiết theo thành viên được trình bày tại mục 2.

| Tuần | Thời gian | Ngày nộp | Nội dung chính |
| ---: | --- | --- | --- |
| 01 | 30/09–04/10/2026 | 04/10/2026 | Thống nhất phạm vi đề tài, khảo sát các sản phẩm liên quan và tìm hiểu nền tảng Progressive Web App. |
| 02 | 05/10–11/10/2026 | 11/10/2026 | Hoàn thành phân tích yêu cầu hệ thống và đề cương tiểu luận. |
| 03 | 12/10–18/10/2026 | 18/10/2026 | Hoàn thành thiết kế UML, cơ sở dữ liệu SQL Server/IndexedDB và giao thức đồng bộ. |
| 04 | 19/10–25/10/2026 | 25/10/2026 | Dựng khung dự án Frontend/Backend và chức năng CRUD ghi chú chạy offline. |
| 05 | 26/10–01/11/2026 | 01/11/2026 | Hoàn thiện PWA cài đặt được, mở được khi offline; bổ sung lọc, tìm kiếm và định dạng nội dung. |
| 06 | 02/11–08/11/2026 | 08/11/2026 | Đồng bộ dữ liệu giữa IndexedDB và SQL Server; xác thực và cô lập dữ liệu theo tài khoản. |
| 07 | 09/11–15/11/2026 | 15/11/2026 | Phát hiện và giải quyết xung đột theo phiên bản, đồng bộ delta và tăng cường bảo mật đăng nhập. |
| 08 | 16/11–22/11/2026 | 22/11/2026 | Khôi phục mật khẩu qua email; Trợ lý AI tạo bản nháp ghi chú/công việc chạy cục bộ. |
| 09 | 23/11–29/11/2026 | 29/11/2026 | Trợ lý tri thức hỏi đáp trên kho ghi chú cá nhân, có dẫn nguồn, chạy cục bộ. |
| 10 | 30/11–06/12/2026 | 06/12/2026 | Nâng độ chính xác của Trợ lý AI; AI lập kế hoạch và mô phỏng tiến độ; hoàn thành trang Thống kê. |
| 11 | 07/12–13/12/2026 | 13/12/2026 | Phân quyền quản trị user–admin–root, gán quản lý và nhật ký quản trị. |
| 12 | 14/12–20/12/2026 | 20/12/2026 | Nhắc việc bằng thông báo đẩy (Web Push, VAPID), nhận được cả khi đã đóng ứng dụng. |
| 13 | 21/12–27/12/2026 | 27/12/2026 | Hoàn thiện giao diện, bổ sung làm mới hồ sơ/vai trò và ràng buộc toàn vẹn phân quyền, xây dựng bộ kiểm thử tự động. |
| 14 | 28/12/2026–03/01/2027 | 03/01/2027 | Đóng gói, triển khai bản production và kiểm thử toàn hệ thống. |
| 15 | 04/01–11/01/2027 | 11/01/2027 | Hoàn thiện báo cáo tiểu luận, tài liệu và chuẩn bị bảo vệ. |

### 3.1. Nguyên tắc ghi nhận công việc trên GitHub

- Mỗi thành viên làm việc trên nhánh riêng (`feature/<ten>`) và tạo Pull Request để merge vào `main`.
- Commit message dùng dạng `<loại>(<phạm vi>): <mô tả ngắn>`, ví dụ `feat(auth): thêm đăng nhập JWT`.
- Mỗi thành viên tự commit bằng tài khoản của mình theo đúng phần việc thực tế; không chỉnh ngày máy hoặc sửa lịch sử để tạo tiến độ giả.
- Trước khi merge, chạy bộ kiểm thử liên quan và review chéo các thay đổi có ảnh hưởng đến luồng dữ liệu, phân quyền hoặc đồng bộ.

## 4. Ghi chú

- Bảng phân công phản ánh vai trò chính của từng thành viên; trong quá trình thực hiện có sự trao đổi, hỗ trợ lẫn nhau giữa các phần việc.
- Tỷ trọng đóng góp được thống nhất trong nhóm, có xem xét đến độ phức tạp kỹ thuật và khối lượng công việc thực tế của từng phần.

## 5. Xác nhận của các thành viên

| Họ và tên | Chữ ký |
| --- | --- |
| Đặng Tấn Đạt | |
| Nguyễn Quốc Bảo | |
| Phạm Duy Phước | |
