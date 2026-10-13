# PWA Notes — triển khai server và sử dụng trên desktop

Ứng dụng ghi chú và quản lý công việc offline-first, theo mô hình client-server nhiều người dùng: React/TypeScript + IndexedDB (Dexie) ở frontend, Express + SQL Server ở backend, có Trợ lý AI và Trợ lý tri thức chạy local qua Ollama. Mỗi tài khoản đăng nhập (JWT) chỉ thấy và thao tác trên ghi chú của chính mình - dữ liệu được cô lập theo `UserId` ở tầng database, một tài khoản không thể xem hay ghi đè ghi chú của tài khoản khác dù đoán trúng ID.

**Thời gian thực hiện tiểu luận:** 15 tuần, từ ngày **30/09/2026** đến ngày **11/01/2027**.

> **Phạm vi sử dụng chính thức:** người dùng mở ứng dụng bằng **Chrome hoặc Edge trên máy tính desktop/laptop**, thông qua **một URL do máy chủ cung cấp**. Project không triển khai, không kiểm thử và không cam kết trải nghiệm cài đặt ứng dụng trên điện thoại/mobile. Thuật ngữ PWA trong tài liệu chỉ mô tả nền tảng kỹ thuật Service Worker, cache và IndexedDB phục vụ offline trên trình duyệt desktop. Phạm vi là hệ thống nội bộ để demo/bảo vệ, không phải dịch vụ Internet công cộng hoặc multi-tenant nhiều tổ chức.

Trong các mô tả kỹ thuật bên dưới, “thiết bị” hoặc “client” được hiểu là một máy desktop/laptop hay một profile Chrome/Edge độc lập, không bao hàm điện thoại.

Tài liệu giải thích code: [GIAI_THICH_PROJECT.md](GIAI_THICH_PROJECT.md).

Bộ sơ đồ Mermaid theo từng góc nhìn: [docs/architecture/00-MUC-LUC.md](docs/architecture/00-MUC-LUC.md) — gồm kiến trúc tổng thể, frontend PWA, backend API, dữ liệu, đồng bộ offline, xác thực/phân quyền, AI Ollama, AI lập kế hoạch, Web Push, triển khai/kiểm thử và bản đồ tính năng.

## 1. Tính năng

- Đăng ký/đăng nhập bằng tài khoản nội bộ (JWT + bcrypt); toàn bộ API `/api/notes*` và `/api/ai*` yêu cầu đăng nhập. Đổi mật khẩu ngay trong app (mục tài khoản ở sidebar); đăng nhập sai thì báo số lượt còn lại (còn 4, 3, 2, 1 lượt); sai lần thứ 5 thì **tài khoản** bị tạm chặn đăng nhập 15 phút - admin quản lý tài khoản đó (hoặc root) mở chặn sớm được trong trang Quản trị. Quên mật khẩu: nếu tài khoản đã có email khôi phục (mục tài khoản ở sidebar) thì bấm "Quên mật khẩu?" ở màn hình đăng nhập để nhận link đặt lại qua email (cần cấu hình SMTP, xem mục 5); nếu không thì dùng script `npm run reset-password` (xem mục 3, Bước 8).
- **Quản trị 2 cấp (xem mục 3 Bước 9):** **root** - đúng 1 tài khoản gốc, tạo qua CLI, toàn quyền trên mọi user - và **admin thường** - do root phân quyền, chỉ quản lý những user root đã **gán riêng** cho họ. Cả 2 cấp đều có nút "Quản trị" trong mục tài khoản: xem danh sách (root thấy tất cả, admin thường chỉ thấy user được gán) kèm tiến độ (số việc chưa/đã xong, quá hạn), xem **chỉ đọc** ghi chú/công việc của từng người, sửa tên hiển thị/email, đặt lại mật khẩu (không cần biết mật khẩu cũ), khóa/mở khóa đăng nhập. Riêng root có thêm: thêm tài khoản mới, phân quyền admin cho user thường, hạ quyền admin về user, gán/bỏ gán user cho một admin quản lý, và xem **Nhật ký** ghi lại mọi hành động quản trị (ai làm gì với ai, lúc nào). Không ai sửa/xóa được từng ghi chú thay người dùng khác - giữ đúng ranh giới cô lập dữ liệu theo tài khoản.
- **Mỗi tài khoản có dữ liệu ghi chú riêng**, không dùng chung với tài khoản khác - cô lập bằng `UserId` ở tầng database, không chỉ ẩn ở giao diện. Người dùng desktop cùng truy cập URL chính thức của server (khuyến nghị HTTPS, frontend và API cùng origin) và mỗi người chỉ thấy dữ liệu của chính mình; cổng Vite `5173/4173` chỉ dành cho phát triển/kiểm thử tại máy kỹ thuật.
- Chọn **Ghi chú** hoặc **Công việc**. Ghi chú không có checkbox hoàn thành.
- Thêm, sửa, lọc tag, tìm kiếm, xóa mềm và khôi phục. Nội dung hỗ trợ định dạng nhẹ: `**đậm**`, `*nghiêng*`, `` `code` `` và danh sách gạch đầu dòng (`- việc`, `- [ ] việc`, `- [x] việc`).
- **Trợ lý AI chạy local** (xem mục 4): mô tả việc cần làm bằng lời tự nhiên, AI tạo bản nháp tiêu đề/tag/thời gian - bản nháp hiện ra dưới dạng **form sửa được đầy đủ** (tiêu đề, nội dung, loại, tag, thời gian), người dùng có thể chỉnh sửa trực tiếp trước khi bấm Áp dụng; không tự động lưu, không gọi bất kỳ API cloud nào.
- **Trợ lý tri thức AI cục bộ có dẫn nguồn** (xem mục 4): hỏi bằng ngôn ngữ tự nhiên trên các ghi chú đã đồng bộ của chính tài khoản; hệ thống tìm nguồn liên quan bằng embedding, dùng Ollama tổng hợp câu trả lời kèm ký hiệu `[1]`, `[2]` và thẻ nguồn có thể bấm để tìm lại ghi chú. Vector được cache trong SQL Server và chỉ tính lại khi nội dung, phiên bản hoặc model embedding thay đổi.
- **AI lập kế hoạch và mô phỏng tiến độ:** từ nút **Kế hoạch AI** ở sidebar, chọn năng lực 30–720 phút/ngày và kỳ 1–60 ngày. AI ước lượng thời lượng/độ ưu tiên cho tối đa 60 công việc đang mở đã đồng bộ; thuật toán xác định xếp lịch theo ngày bắt đầu, deadline và năng lực, cảnh báo quá hạn/nguy cơ trễ, đồng thời so sánh ba kịch bản năng lực −25%, cơ sở và +25%. Kế hoạch chỉ là mô phỏng, không tự sửa công việc.
- Danh sách ở trang chính có bộ lọc **Tất cả / Ghi chú / Công việc**, kết hợp được với tìm kiếm và lọc tag. Thanh tag chỉ hiển thị các tag thực sự tồn tại trong loại nội dung đang chọn; đổi loại sẽ bỏ lựa chọn tag cũ để không tạo bộ lọc rỗng ngoài ý muốn. Các mục tiến độ **Đang thực hiện / Đang quá hạn / Đã hoàn thành** là ba nhóm không chồng lặp. Khi chọn một mục trong sidebar, trang tự cuộn mượt tới danh sách kết quả tương ứng. Ba thẻ tiến độ chỉ đếm công việc; thẻ **Nội dung chờ đồng bộ** đếm cả ghi chú và công việc chưa đồng bộ.
- Trang **Thống kê** (biểu đồ Recharts) có bộ lọc phân loại **Tất cả / Ghi chú / Công việc**. Các thẻ tổng quan chỉ giữ tên và số; phần giải thích dài được thay bằng biểu đồ và chú giải màu. Chế độ Công việc chia dữ liệu vào bốn trạng thái loại trừ nhau: **Đang thực hiện**, **Đang quá hạn**, **Đã hoàn thành (không trễ)**, **Đã hoàn thành trễ**. Biểu đồ donut **Tỷ lệ hoàn thành công việc** đặt phần trăm và phân số đã hoàn thành/tổng công việc ở giữa; số đã hoàn thành gồm cả không trễ và trễ, tổng không gồm dữ liệu đã xóa. Bộ lọc thời gian **14 ngày** hoặc **6 tháng** áp dụng cho các biểu đồ tạo mới, hoàn thành và quá hạn. Biểu đồ tag tính toàn bộ dữ liệu thuộc phân loại đang chọn.
- Bắt đầu/hạn hoàn thành không bắt buộc; nếu có cả hai thì hạn không được trước bắt đầu.
- Công việc chưa hoàn thành đã qua hạn xuất hiện ở mục **Đang quá hạn**; trạng thái cập nhật khoảng 30 giây hoặc khi trở lại cửa sổ. Khi người dùng hoàn thành sau deadline, công việc rời nhóm đang quá hạn và chuyển sang nhãn màu vàng **Đã hoàn thành trễ** để giữ rõ lịch sử tiến độ.
- Tự lưu ngày tạo, lần cập nhật, thời điểm hoàn thành và thời điểm xóa. Bỏ tích hoàn thành/khôi phục xóa mốc tương ứng. Đây không phải lịch sử tất cả phiên bản.
- Ghi chú cũ được giữ là công việc để bảo toàn checkbox trước đây; các mốc lịch sử chưa từng được lưu để `null`, hiển thị "Chưa có thông tin".
- Lưu offline trước; tự đồng bộ hai chiều, có nút dự phòng. Giờ nhập theo múi giờ thiết bị, truyền và lưu dạng epoch milliseconds.
- **Phát hiện xung đột đồng bộ theo phiên bản (không phụ thuộc đồng hồ thiết bị):** mỗi ghi chú trên server có số phiên bản (`Version`) tự tăng mỗi lần ghi; thiết bị gửi kèm phiên bản nó đã dựa vào khi sửa. Nếu thiết bị khác đã sửa trước, server **không ghi đè** mà trả lại bản đang có - ghi chú hiện nhãn "Xung đột", xuất hiện ở mục **Xung đột đồng bộ** kèm bảng so sánh các trường khác nhau và 3 lựa chọn: **Giữ bản của tôi** / **Dùng bản trên server** / **Giữ cả hai** (bản của thiết bị được tách thành ghi chú mới). Gửi lại cùng một thay đổi (mất phản hồi mạng) hoặc hai thiết bị sửa giống hệt nhau không bị coi là xung đột.
- **Nhắc việc bằng thông báo (Web Push) trên desktop:** công việc có hạn hoàn thành được nhắc bằng thông báo của hệ điều hành trước hạn một khoảng tùy chọn (đúng hạn, 5/10/15/30 phút, 1/2 giờ, 1 ngày - mặc định 15 phút). Thông báo có thể đến khi tab web đã đóng nếu Chrome/Edge desktop và hệ điều hành vẫn cho phép xử lý push nền. Bật/tắt riêng cho từng profile trình duyệt trong mục **Nhắc việc**, có nút **Gửi thử**. Nhiều việc đến hạn cùng lúc được gộp thành một thông báo; đổi hạn thì được nhắc lại; đăng xuất tự gỡ đăng ký của profile đó. Cần cấu hình khóa VAPID (mục 3 Bước 6b).
- **Đồng bộ delta:** mỗi lần đồng bộ chỉ tải về các ghi chú đã thay đổi kể từ lần trước (con trỏ `rowversion` của SQL Server), chia trang 500 ghi chú/lần - không tải lại toàn bộ dữ liệu như trước.

## 2. Yêu cầu hệ thống

Trên **máy chủ triển khai**, chuẩn bị:

- **Node.js** 20 trở lên (đã kiểm tra với Node 24) kèm npm.
- **SQL Server** (bản Express là đủ) + **SQL Server Management Studio (SSMS)** để chạy script tạo database. Bật TCP/IP trong SQL Server Configuration Manager, tạo sẵn một tài khoản SQL Authentication có quyền tạo/đọc/ghi.
- **PowerShell** (có sẵn trên Windows).
- *(Tùy chọn)* **Ollama** nếu muốn dùng Trợ lý AI - xem mục 4. Không cài cũng không ảnh hưởng các chức năng còn lại.

Trên **máy người dùng**, chỉ cần Chrome hoặc Edge bản desktop và URL do server cung cấp; không cài Node.js, SQL Server hay mã nguồn. Điện thoại và trình duyệt mobile nằm ngoài phạm vi hỗ trợ.

## 3. Cài đặt trên máy chủ lần đầu (làm theo đúng thứ tự)

### Bước 1 — Lấy mã nguồn

Copy/giải nén toàn bộ thư mục dự án (gồm `backend/` và `frontend/`) lên máy chủ triển khai. Không copy source sang máy người dùng.

### Bước 2 — Tạo database SQL Server

1. Mở SSMS, kết nối tới SQL Server instance sẽ dùng.
2. Mở file `backend/schema.sql`, bấm **Execute** - script tự tạo database `PwaNotesDB` và toàn bộ bảng cần thiết (`Notes`, `Users`).
3. Chỉ chạy script này **một lần** cho database mới. Nếu máy đích đã có sẵn database cũ (nâng cấp, không tạo mới), bỏ qua bước này và làm theo Bước 4 - `npm run migrate` sẽ tự cập nhật schema mà không mất dữ liệu.

### Bước 3 — Cấu hình `backend/.env`

1. Copy `backend/.env.example` thành `backend/.env`.
2. Điền thông tin SQL Server thật: `DB_SERVER`, `DB_NAME` (mặc định `PwaNotesDB`), `DB_USER`, `DB_PASSWORD`.
   - Mật khẩu có ký tự `#` thì đặt trong dấu nháy đơn: `DB_PASSWORD='mat#khau'`.
   - `DB_PORT=1433` nếu SQL Server nghe cổng TCP cố định (khuyến nghị, không cần SQL Browser). Nếu không đặt `DB_PORT`, dùng `DB_INSTANCE` (mặc định `SQLEXPRESS`) và cần dịch vụ SQL Server Browser đang chạy.
3. Tạo `JWT_SECRET` ngẫu nhiên riêng cho máy này (bắt buộc - dùng để ký token đăng nhập):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Dán kết quả vào `JWT_SECRET=` trong `.env`.
4. Các biến còn lại (`PORT`, `HOST`, `ALLOWED_ORIGINS`, `DB_ENCRYPT`, `DB_TRUST_CERTIFICATE`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`) để mặc định là chạy được ngay trên localhost; xem giải thích từng biến ở mục 5 nếu cần đổi.

### Bước 4 — Cài dependency & chạy migration cho backend

```powershell
cd backend
npm ci
npm run migrate
```

`npm run migrate` áp dụng mọi cập nhật schema còn thiếu, an toàn chạy lại nhiều lần và không xóa dữ liệu - luôn chạy bước này, kể cả ngay sau khi vừa tạo database mới ở Bước 2, để chắc chắn schema đã đầy đủ.

### Bước 5 — Cài dependency & build frontend

```powershell
cd ../frontend
npm ci
npm run build
```

Cần `npm run build` nếu chạy theo Cách A (production một cổng, Bước 7) hoặc muốn kiểm tra PWA/offline qua `npm run preview`. Nếu chỉ cần chạy dev để sửa code, có thể bỏ qua lệnh build và dùng Cách B.

### Bước 6 — *(Tùy chọn)* Cài Ollama cho Trợ lý AI

Xem hướng dẫn chi tiết ở mục 4. Bỏ qua bước này nếu không cần dùng Trợ lý AI - các chức năng ghi chú/đồng bộ khác không bị ảnh hưởng.

### Bước 6b — *(Tùy chọn)* Bật nhắc việc bằng thông báo (Web Push)

```powershell
cd backend
npm run vapid-keys
```

Lệnh in ra 2 dòng `VAPID_PUBLIC_KEY=...` và `VAPID_PRIVATE_KEY=...` - dán vào `backend/.env` (có thể đặt thêm `VAPID_SUBJECT=mailto:<email liên hệ của người vận hành>`), rồi khởi động lại backend. Chỉ tạo **một lần** cho mỗi máy chủ; đổi khóa sẽ làm các profile trình duyệt desktop phải bật lại nhắc việc. Không đặt 2 biến này thì tính năng tự tắt, các chức năng khác không ảnh hưởng (backend in dòng "Nhắc việc (Web Push) đang tắt" khi khởi động).

Điều kiện để thông báo đến được máy desktop:

- Dùng **bản build** (Cách A hoặc `npm run preview`) - Service Worker không chạy ở `npm run dev`.
- Người dùng mở đúng **URL HTTPS của server**. `localhost` chỉ dành cho kiểm thử ngay trên máy chủ; URL dạng `http://<ip-LAN>` không đủ điều kiện Web Push - xem mục 6.
- Máy chủ backend và máy desktop đều cần **Internet**: thông báo đi qua dịch vụ push của trình duyệt (Google FCM với Chrome/Edge hoặc Microsoft). Nội dung được mã hóa đầu-cuối, dịch vụ trung gian không đọc được. Đây là dịch vụ hạ tầng bên ngoài cùng SMTP; Trợ lý AI vẫn chạy local.
- Chỉ nhắc công việc **đã đồng bộ lên server**, chưa hoàn thành, chưa xóa, thuộc tài khoản chưa bị khóa. Backend quét mỗi phút; nếu backend tắt rồi bật lại thì nhắc bù những việc quá hạn chưa quá 1 giờ.

### Bước 7 — Chạy ứng dụng

Chọn **một trong hai** cách.

**Cách A - Production, một cổng (khuyên dùng để demo/bảo vệ):**

```powershell
cd backend
$env:NODE_ENV = 'production'
# Hai dòng dưới CHỈ dành cho SQL local chưa có chứng chỉ, trên máy tin cậy:
$env:DB_ENCRYPT = 'false'
$env:DB_TRUST_CERTIFICATE = 'true'
npm start
```

Trên máy chủ, mở `http://localhost:4000` để kiểm tra. Express phục vụ frontend (`dist/`) và API trên cùng một origin. Người dùng desktop không dùng địa chỉ Vite; họ mở URL chính thức được cấu hình ở mục 6. Backend kiểm tra kết nối và schema trước khi mở HTTP; sai cấu hình/thiếu migration sẽ báo lỗi trước khi phục vụ trang.

**Cách B - Dev, có hot reload (chỉ dành cho lập trình viên):**

Terminal 1:

```powershell
cd backend
npm run dev
```

Terminal 2:

```powershell
cd frontend
npm run dev
```

Lập trình viên mở `http://localhost:5173`. Đây không phải URL bàn giao cho người dùng. Để kiểm tra Service Worker/offline của bản build, thay lệnh frontend bằng:

```powershell
npm run build
npm run preview
```

rồi mở `http://localhost:4173` ngay trên máy server. Vite được cấu hình bind `0.0.0.0`, nên máy desktop khác cùng mạng mở `http://<IP-LAN-của-server>:4173`, ví dụ `http://192.168.1.20:4173`. **Không nhập `http://0.0.0.0:4173` trên client**: `0.0.0.0` chỉ có nghĩa tiến trình lắng nghe trên mọi card mạng, không phải địa chỉ đích. Nếu server dùng Windows, cần cho phép inbound TCP 4173 trong Firewall. Đây vẫn là cổng preview/kiểm thử; HTTP qua IP LAN không cung cấp secure context cho đầy đủ Service Worker/Web Push, nên URL bàn giao chính thức vẫn phải là HTTPS theo mục 6.

### Bước 8 — Tạo tài khoản và bắt đầu dùng

Trên Chrome/Edge desktop, mở URL do server cung cấp; màn hình đầu tiên là đăng nhập. Bấm **"Chưa có tài khoản? Đăng ký"**, điền tên đăng nhập (3-50 ký tự chữ/số/`._-`), mật khẩu (từ 6 ký tự) và **email khôi phục (bắt buộc)** - dùng để tự khôi phục mật khẩu sau này nếu quên (mục 8 bên dưới), backend từ chối đăng ký nếu thiếu/sai định dạng hoặc email đã được tài khoản khác dùng. Đăng ký thành công sẽ vào thẳng giao diện, không cần xác minh email. Token được giữ trong profile trình duyệt desktop nên tải lại cùng URL không bị đăng xuất.

**Tài khoản tạo trước khi tính năng này ra đời** (email từng là tùy chọn) có thể chưa có email - vẫn đăng nhập/dùng app bình thường, chỉ cần bổ sung email qua mục tài khoản (xem bên dưới) nếu muốn dùng "Quên mật khẩu?" qua email; nếu không bổ sung thì vẫn khôi phục được bằng `npm run reset-password`.

**Đổi mật khẩu / quên mật khẩu:**

- Khi đã đăng nhập: bấm **"Đổi mật khẩu"** cạnh nút Đăng xuất ở sidebar, nhập mật khẩu hiện tại + mật khẩu mới.
- Đăng nhập sai: mỗi lần sai báo số lượt còn lại ("Bạn còn 4 lượt thử...", rồi 3, 2, 1). Sai lần thứ 5 (trong vòng 15 phút) thì **tài khoản bị tạm chặn đăng nhập 15 phút** - trong thời gian này nhập đúng mật khẩu cũng không vào được. Tự mở sau 15 phút, hoặc mở sớm bằng một trong các cách: admin quản lý tài khoản đó (hoặc root - toàn quyền, kể cả với tài khoản admin) bấm **"Mở chặn đăng nhập"** trong trang Quản trị; đặt lại mật khẩu (qua email "Quên mật khẩu?", admin "Đặt lại mật khẩu", hoặc `npm run reset-password`). Đăng nhập đúng thì bộ đếm về 0. Bộ đếm tính theo tài khoản và lưu trong SQL (không mất khi khởi động lại backend, đổi IP/thiết bị không né được).
- **Quên mật khẩu qua email (cần cấu hình SMTP trước, xem mục 5):**
  1. Tài khoản đăng ký mới bắt buộc nhập một **email khôi phục hợp lệ**. Tài khoản cũ chưa có email có thể bổ sung sau khi đăng nhập bằng nút **"Thêm email khôi phục"**/"Đổi email khôi phục" cạnh nút Đổi mật khẩu ở sidebar (sidebar cũng hiển thị email hiện tại hoặc "Chưa có email khôi phục").
  2. Lúc quên mật khẩu, ở màn hình đăng nhập bấm **"Quên mật khẩu?"**, nhập đúng email đã gắn, bấm gửi.
  3. Backend luôn trả cùng một thông báo dù email có tồn tại trong hệ thống hay không (tránh lộ danh sách tài khoản); nếu khớp, một email chứa link đặt lại mật khẩu sẽ được gửi tới hộp thư đó.
  4. Mở email, bấm link (dạng `<APP_BASE_URL>/?resetToken=...`), nhập mật khẩu mới. Link chỉ dùng được 1 lần và hết hạn sau `RESET_TOKEN_TTL_MIN` phút (mặc định 30 phút).
- **Quên mật khẩu khi chưa gắn email, hoặc SMTP lỗi/không nhận được mail:** người có quyền truy cập máy chủ chạy lệnh sau trong thư mục `backend` để đặt mật khẩu mới thay cho người dùng:

  ```powershell
  npm run reset-password -- <ten-dang-nhap> <mat-khau-moi>
  ```

  (mật khẩu mới tối thiểu 6 ký tự). Đây là công cụ vận hành dòng lệnh, không phải API công khai - luôn hoạt động kể cả khi không cấu hình SMTP, dùng làm phương án dự phòng.

**Ghi chú khi nâng cấp từ bản cũ hơn:** không cần chạy lại `schema.sql`, chỉ cần `npm run migrate` (Bước 4) rồi build lại frontend (Bước 5). Sau khi server được cập nhật, đóng và mở lại tab Chrome/Edge đang truy cập URL server để nhận JavaScript mới; Service Worker có thể còn phục vụ cache cũ nếu chỉ reload thông thường. IndexedDB tự nâng cấp khi mở lại, không mất dữ liệu chưa đồng bộ. API kiểm tra phiên bản giao thức (`X-Sync-Version`) và từ chối frontend cũ thay vì âm thầm mất dữ liệu.

**Thay đổi cơ chế đồng bộ (xung đột theo phiên bản + delta):** `npm run migrate` áp dụng `009_notes_version_rowver.sql` (thêm cột `Version`, `RowVer` và index - ghi chú đã có được gán phiên bản 1, không mất dữ liệu). Frontend dùng cơ chế cũ bị backend mới từ chối đồng bộ cho tới khi tải bản mới - thay đổi vẫn nằm an toàn trên thiết bị. Lần đồng bộ đầu tiên sau nâng cấp, mỗi thiết bị tải toàn bộ dữ liệu một lần để biết phiên bản hiện tại trên server; thay đổi offline còn chờ gửi từ bản cũ được giữ lại - nếu server có bản mới hơn với nội dung khác thì hiện thành xung đột để bạn chọn thay vì bị ghi đè mất như trước.

**Về trạng thái đồng bộ:** thanh trạng thái trong app chỉ cho biết thiết bị có mạng hay không, không đảm bảo API/SQL Server đang hoạt động; nó hiển thị riêng lỗi kết nối, lỗi SQL, sai phiên bản hoặc sai định dạng phản hồi. Lỗi kết nối tạm thời được tự thử lại; lỗi cấu hình/dữ liệu cần sửa nguyên nhân rồi bấm **Đồng bộ ngay**. Không xóa dữ liệu trình duyệt để xử lý lỗi vì có thể còn ghi chú chưa lên server.

### Bước 9 — *(Tùy chọn)* Tạo tài khoản quản trị gốc (root)

Chỉ có **một** tài khoản root, tạo qua dòng lệnh trên máy chủ - cố ý không có nút "đăng ký làm admin" hay endpoint API tương đương, tránh việc ai đó tự phong quyền cho mình. Trong thư mục `backend`:

```powershell
npm run make-admin -- <username> <mat-khau>
```

- Nếu `<username>` chưa tồn tại: tạo tài khoản root mới với mật khẩu đó.
- Nếu `<username>` đã là một tài khoản thường có sẵn: đặt lại mật khẩu theo giá trị vừa truyền **và** đặt quyền root cho tài khoản đó (thăng cấp).
- Nếu đã có một tài khoản root **khác** (username khác) rồi: script từ chối chạy - chỉ 1 root duy nhất trong hệ thống, tránh vô tình tạo ra 2 tài khoản toàn quyền.

Đăng nhập lại bằng tài khoản này sẽ thấy nút **"Quản trị"** cạnh nút Đổi mật khẩu ở sidebar, với đầy đủ quyền: xem/quản lý mọi tài khoản, thêm user mới, **phân quyền admin cho user khác và gán họ quản lý một nhóm thành viên cụ thể** (mục tài khoản → Quản trị → nút "Phân quyền admin" và "Gán quản lý" cạnh mỗi user). Tài khoản được phân quyền admin (không phải root) đăng nhập vào cũng thấy nút "Quản trị", nhưng danh sách chỉ hiện đúng những thành viên root đã gán cho họ - không thấy được toàn bộ hệ thống, không tạo được user mới, không phân/hạ quyền admin cho ai. Không ai (kể cả root) chỉnh sửa/xóa được từng ghi chú thay người dùng khác (chỉ xem) - xem chi tiết quyền hạn ở mục 1 và mục 10.

## 4. Trợ lý AI local (Ollama)

Tính năng AI Assistant gọi model chạy **hoàn toàn trên máy**, backend không gửi dữ liệu ra ngoài Internet.

**Cài đặt (chỉ làm 1 lần):**

1. Tải Ollama cho Windows tại <https://ollama.com/download>, chạy file `.exe` và cài đặt bình thường (next-next-finish).

2. Sau khi cài xong, Ollama **tự chạy nền** như một service (icon ở khay hệ thống, góc dưới màn hình) - không cần tự gõ lệnh khởi động. Nếu không thấy icon hoặc muốn chạy tay, mở PowerShell:

   ```powershell
   ollama serve
   ```

   (nếu đã có service chạy sẵn, lệnh này sẽ báo cổng 11434 đang được dùng - vậy là đã chạy rồi, bỏ qua bước này.)

3. Tải model sinh câu trả lời và model embedding (cần mạng lần đầu, sau đó chạy offline hoàn toàn):

   ```powershell
   ollama pull llama3.2
   ollama pull embeddinggemma
   ```

4. Kiểm tra đã sẵn sàng:

   ```powershell
   ollama list
   ```

   Thấy cả `llama3.2` và `embeddinggemma` trong danh sách là dùng được đầy đủ ba chức năng AI.

**Mỗi lần muốn dùng AI:** chỉ cần Ollama và backend đang chạy. "Tạo bằng AI" tạo bản nháp; "Hỏi kho tri thức" trả lời có nguồn; "Kế hoạch AI" ước lượng và mô phỏng lịch làm việc. Lần hỏi tri thức đầu tiên có thể chậm hơn vì phải tạo embedding.

**Đổi model** (máy yếu, muốn nhẹ hơn `llama3.2`): đặt `OLLAMA_MODEL` trong `backend/.env`, ví dụ:

```env
OLLAMA_MODEL=qwen2.5:1.5b
```

rồi `ollama pull qwen2.5:1.5b` và khởi động lại backend để đọc `.env` mới (`.env` chỉ được đọc lúc backend khởi động).

**Backend đọc:** `OLLAMA_URL` (mặc định `http://127.0.0.1:11434`), `OLLAMA_MODEL` (mặc định `llama3.2`), `OLLAMA_EMBED_MODEL` (mặc định `embeddinggemma`), `OLLAMA_TIMEOUT_MS` (bản nháp, mặc định 60 giây), `OLLAMA_KNOWLEDGE_TIMEOUT_MS` và `OLLAMA_PLANNER_TIMEOUT_MS` (mặc định 90 giây), `OLLAMA_KEEP_ALIVE` (mặc định `30m`) và `KNOWLEDGE_MIN_SIMILARITY` (mặc định `0.28`).

Trợ lý tri thức chỉ đọc tối đa 1.000 ghi chú đang hoạt động đã có trên server của tài khoản đăng nhập. `NoteEmbeddings` lưu vector theo cặp `UserId + ServerId`; `Version`, hash nội dung và tên model bảo đảm cache cũ được cập nhật. Nội dung nguồn được coi là dữ liệu, không phải chỉ dẫn cho model, nhằm giảm prompt injection từ chính nội dung ghi chú. Nếu không có nguồn đủ liên quan, hệ thống nói rõ không tìm thấy thay vì bịa câu trả lời.

**Cách mô phỏng tiến độ:** AI chỉ ước lượng thời lượng 15–480 phút và mức ưu tiên 1–5. Deadline luôn đặt mức ưu tiên tối thiểu bằng quy tắc, nên model không thể hạ thấp việc sắp đến hạn. Bộ mô phỏng sau đó tự phân bổ theo ngày và không cho vượt năng lực đã nhập. Nếu Ollama lỗi, hệ thống vẫn dùng ước lượng dự phòng theo độ dài nội dung/deadline và hiển thị cảnh báo. Mô phỏng tính theo ngày lịch, không tự loại cuối tuần, không ghi kết quả vào database và không thay thế cam kết tiến độ thực tế.

**Ví dụ kiểm thử Kế hoạch AI:** tạo thủ công bốn bản ghi loại **Công việc**, để trạng thái chưa hoàn thành rồi chờ đồng bộ:

| Công việc | Nội dung gợi ý | Thời gian |
| --- | --- | --- |
| Sửa lỗi demo đăng nhập | Kiểm tra đăng nhập sai, mở chặn và đổi tài khoản | Hạn là hôm qua để tạo trạng thái quá hạn |
| Hoàn thiện slide bảo vệ | Bổ sung kiến trúc, kết quả kiểm thử và giới hạn hệ thống | Hạn cuối ngày hôm nay |
| Luyện kịch bản trình bày | Chạy thử demo đăng nhập, đồng bộ, AI và Web Push hai lần | Hạn sau 2 ngày |
| Rà soát README | Kiểm tra hướng dẫn cài đặt và các lệnh demo | Không có hạn; bắt đầu từ ngày mai |

Mở **Kế hoạch AI**, đặt `120` phút/ngày, `5` ngày, mục tiêu `Ưu tiên phần bảo vệ và demo`, rồi bấm **Mô phỏng tiến độ**. Kết quả cần kiểm tra: việc quá hạn đứng trong nhóm cần chú ý; không ngày nào vượt 120 phút; việc có ngày bắt đầu ngày mai không được xếp vào hôm nay; có đủ ba kịch bản; kịch bản +25% không hoàn thành ít việc hơn cơ sở và kịch bản −25% không hoàn thành nhiều việc hơn cơ sở. Đổi thành `30` phút/ngày và `2` ngày để kiểm tra cảnh báo còn công việc ngoài kỳ. Bấm một công việc trong kết quả phải quay về danh sách và tìm đúng tiêu đề.

**Tốc độ và độ chính xác:** máy không có GPU phù hợp thì Ollama chạy model bằng **CPU** (kiểm tra: `ollama ps`, cột PROCESSOR ghi `100% CPU`) - một lượt có thể mất vài giây đến vài chục giây. App đã được tối ưu cho trường hợp này:

- **Ngày giờ do code phân tích, không nhờ AI** (`backend/src/viDate.js`): "5h chiều", "14h30", "8 giờ rưỡi tối", "17:45", "25/09/2026", "30/9", "ngày 30 tháng 9", "hôm nay/ngày mai/ngày mốt", "3 ngày nữa", "thứ 6 (tuần sau)", "chủ nhật", "cuối tuần/cuối tháng", "chiều nay 3h", "tối mai"... Kết quả luôn đúng và có ngay; model chỉ còn lo tiêu đề/tag/loại. Chỉ có ngày mà không có giờ thì hạn là 23:59 ngày đó; chỉ có buổi ("chiều nay") thì lấy giờ mặc định của buổi (sáng 9h, trưa 12h, chiều 17h, tối 20h, đêm 23h).
- **Prompt ngắn + JSON schema + giới hạn độ dài câu trả lời**, giữ model trong RAM 30 phút, **nạp sẵn model** khi backend khởi động và khi bấm vào ô nhập. Đo trên máy chạy CPU: trước 15-23 giây (hay quá 20 giây -> lỗi timeout), nay khoảng 3-10 giây.
- **Nội dung và tag:** cụm nói rõ nội dung ("... với nội dung là X", "nội dung: X", "chi tiết: X", "mô tả: X") được tách bằng quy tắc và điền nguyên văn vào ô Nội dung; model để trống tag thì app gợi ý theo từ khóa có dấu (báo cáo/đồ án/TLCN/thi -> học tập, họp/dự án -> công việc, học phí/hóa đơn -> tài chính, mua/đi chợ -> mua sắm, khám/thuốc -> sức khỏe, bố mẹ -> gia đình).
- **Không bao giờ trắng tay:** AI quá thời gian, Ollama chưa chạy hoặc trả sai định dạng -> vẫn hiện **bản nháp cơ bản** (tiêu đề rút từ câu nhập + ngày giờ đã phân tích) kèm cảnh báo lý do, sửa rồi lưu được ngay.
- Trong lúc chờ có đếm giây và nút **Hủy** (hủy thì backend dừng luôn yêu cầu tới Ollama, không để CPU chạy tiếp). `Ctrl+Enter` trong ô nhập = bấm "Tạo bằng AI".

Muốn nhanh hơn nữa trên máy yếu: dùng model nhỏ hơn (`qwen2.5:1.5b`, xem trên), hoặc chạy trên máy có GPU.

**Lỗi thường gặp:**

- `Không kết nối được tới Ollama tại http://127.0.0.1:11434...`: Ollama chưa cài hoặc chưa chạy nền; làm lại bước 1-2.
- `Model "llama3.2" chưa được tải trong Ollama`: chạy `ollama pull llama3.2`.
- `Model "embeddinggemma" chưa được tải trong Ollama`: chạy `ollama pull embeddinggemma`. Đây là model bắt buộc cho **Hỏi kho tri thức**; chỉ có `llama3.2` thì chức năng tạo bản nháp dùng được nhưng tìm kiếm ngữ nghĩa chưa dùng được.
- PowerShell báo không nhận lệnh `ollama`: đóng và mở lại PowerShell sau khi cài Ollama, rồi chạy `ollama list` để kiểm tra PATH.

Sau khi tải đúng model, không cần sửa database hay khởi động lại backend nếu tên model trong `.env` không đổi; tải lại trang và thử lại. Nếu Ollama chưa chạy hoặc trả lời quá chậm, `/api/ai/draft` vẫn trả bản nháp cơ bản; Trợ lý tri thức báo lỗi rõ ràng và các chức năng ghi chú/đồng bộ khác không bị ảnh hưởng.

## 5. Cấu hình biến môi trường (tham khảo đầy đủ)

**Backend (`backend/.env`):**

- `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: thông tin SQL. Đặt mật khẩu chứa `#` trong dấu nháy; không commit `.env`.
- `DB_PORT`: cổng TCP thật, ưu tiên hơn `DB_INSTANCE`; dùng cổng thì không cần SQL Browser dò instance.
- `DB_ENCRYPT`, `DB_TRUST_CERTIFICATE`: cấu hình TLS SQL. Khi `NODE_ENV=production` mà không khai báo, mặc định `encrypt=true` và `trust=false`.
- `HOST` mặc định `127.0.0.1`: backend chỉ lắng nghe loopback; `PORT` mặc định `4000`.
- `ALLOWED_ORIGINS`: danh sách origin frontend cách nhau bằng dấu phẩy nếu truy cập khác origin. CORS không thay thế xác thực.
- `JWT_SECRET`: **bắt buộc** đặt giá trị ngẫu nhiên riêng trước khi chạy thật (xem Bước 3 ở mục 3). Chạy dev mà không đặt sẽ dùng secret mặc định không an toàn; đặt `NODE_ENV=production` mà thiếu biến này backend sẽ từ chối khởi động. `JWT_EXPIRES_IN` mặc định `7d`.
  - `backend/src/env.js` nạp `.env` trước các module đọc cấu hình, bảo đảm JWT, SQL, SMTP và cả hai luồng Ollama dùng đúng giá trị khi backend khởi động.
- `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_TIMEOUT_MS`, `OLLAMA_KNOWLEDGE_TIMEOUT_MS`, `OLLAMA_PLANNER_TIMEOUT_MS`, `OLLAMA_KEEP_ALIVE`, `KNOWLEDGE_MIN_SIMILARITY`: cấu hình AI local, xem mục 4.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: cấu hình gửi email "quên mật khẩu" qua SMTP thật (không phải AI, không vi phạm nguyên tắc chạy local - đây là dịch vụ hạ tầng chuẩn giống Gmail/Outlook vẫn dùng). Để trống `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` thì tính năng này tự tắt, chỉ còn dùng được `npm run reset-password`. Ví dụ dùng Gmail/Google Workspace (kể cả email trường theo Google Workspace for Education):
  - `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<email gửi>`.
  - `SMTP_PASS` phải là **App Password 16 ký tự**, KHÔNG phải mật khẩu đăng nhập Google thường - tạo tại [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) sau khi bật xác minh 2 bước cho tài khoản đó. Không commit giá trị này lên Git.
  - `SMTP_FROM` không đặt thì mặc định dùng `SMTP_USER`.
- `APP_BASE_URL`: URL chính thức do server cung cấp cho người dùng desktop, đồng thời là địa chỉ gốc trong email đặt lại mật khẩu, ví dụ `https://notes.noibo.example/`. Chỉ khi kiểm thử ngay trên máy chủ mới dùng `http://localhost:4000`; không đặt URL Vite `5173/4173` trong cấu hình bàn giao.
- `RESET_TOKEN_TTL_MIN`: số phút link đặt lại mật khẩu còn hiệu lực, mặc định `30`.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: khóa ký thông báo nhắc việc (Web Push), tạo bằng `npm run vapid-keys` (mục 3 Bước 6b). Để trống thì nhắc việc tự tắt. Giữ bí mật `VAPID_PRIVATE_KEY` như `JWT_SECRET`. `VAPID_SUBJECT` (mailto: hoặc https:) là địa chỉ liên hệ được gửi kèm cho dịch vụ push, mặc định `mailto:admin@example.com`.
- `TRUST_PROXY`: mặc định không đặt (an toàn nhất). Chỉ đặt `TRUST_PROXY=true` khi backend **thật sự** chạy sau reverse proxy đã cấu hình (mục 6) - lúc đó giới hạn theo IP (đăng ký, quên mật khẩu) mới đọc đúng IP thật của từng người qua header `X-Forwarded-For` thay vì tính chung IP của proxy cho mọi người. Bật sai (không có proxy thật) làm giới hạn theo IP có thể bị giả mạo. Chặn đăng nhập sai mật khẩu tính theo tài khoản nên không phụ thuộc biến này.

**Ghi chú về `JWT_SECRET` và token đăng nhập (đọc kỹ trước khi triển khai nhiều máy):**

- **Hết hạn sau `JWT_EXPIRES_IN` (mặc định 7 ngày):** hết hạn thì request gọi API bị từ chối (401), app tự động quay về màn hình đăng nhập. Ghi chú trong IndexedDB trên thiết bị **không bị mất** - chỉ cần đăng nhập lại (cùng tài khoản) là đồng bộ tiếp bình thường.
- **Token không nằm trong thư mục dự án** - nó chỉ được lưu ở `localStorage` của từng trình duyệt sau khi đăng nhập. Copy thư mục `pwa-notes` sang máy khác **không** mang theo token nào cả; máy đích luôn phải đăng nhập lại từ đầu.
- **Nếu `JWT_SECRET` bị lộ:** ai có secret này có thể tự ký token giả mạo bất kỳ tài khoản nào (không cần mật khẩu), vì JWT không lưu trạng thái ở server để kiểm tra ngược. Cách xử lý duy nhất: đổi `JWT_SECRET` sang giá trị mới rồi khởi động lại backend - việc này khiến **toàn bộ token đang có hiệu lực (mọi tài khoản) bị vô hiệu ngay lập tức**, buộc đăng nhập lại; mật khẩu tài khoản (hash trong SQL) không bị ảnh hưởng.
- **Copy nguyên thư mục (gồm cả `backend/.env` đã điền) sang máy B để dựng một backend độc lập:** máy B sẽ dùng chung `JWT_SECRET` với máy gốc, nghĩa là về mặt kỹ thuật hai backend này "tin" token của nhau. Nếu máy B là một triển khai tách biệt (SQL Server, dữ liệu riêng - không phải chỉ là client mở trình duyệt trỏ vào backend máy A), hãy tạo `JWT_SECRET` **mới** cho máy B trước khi chạy lần đầu:

  ```powershell
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

  Nếu máy B chỉ là máy desktop người dùng mở URL chính thức của server thì không có gì phải đổi - chỉ có một backend, một secret duy nhất, mỗi profile trình duyệt tự đăng nhập và nhận token riêng.

**Frontend (`frontend/.env`, tùy chọn):**

- `VITE_API_URL`: chỉ cần đặt nếu muốn ghi đè địa chỉ API mặc định (đổi giá trị này cần `npm run build` lại). Mặc định: khi chạy dev/preview trên `localhost`/`127.0.0.1` ở cổng `5173`/`4173` qua HTTP, frontend tự gọi thẳng `http://<host>:4000/api/notes` để PWA đã cache vẫn đồng bộ được kể cả khi Vite dừng nhưng backend còn chạy; các trường hợp khác mặc định gọi `/api/notes` cùng origin (đúng cho Cách A ở mục 3). Nếu đổi cổng backend, đặt `VITE_API_URL` tương ứng và cấu hình `ALLOWED_ORIGINS` ở backend khi khác origin.

## 6. Cung cấp một URL server cho người dùng desktop

Phương thức sử dụng được bàn giao là: người dùng mở **một URL HTTPS duy nhất của server** bằng Chrome/Edge desktop; frontend và `/api` được phục vụ cùng origin. Reverse proxy chuyển tiếp cả `/` và `/api` vào Express, dùng chứng chỉ được các máy desktop tin cậy. Không hướng dẫn người dùng mở cổng Vite, không yêu cầu cài ứng dụng và không hỗ trợ mobile. `http://localhost:4000` chỉ dùng để kiểm tra ngay trên máy chủ; `http://IP-LAN` không phải URL bàn giao vì không đủ secure context cho Service Worker/Web Push/Web Locks.

Nếu server cần nhận kết nối từ mạng nội bộ, cấu hình reverse proxy/firewall và `HOST` rõ ràng; nếu proxy cùng máy thì giữ `HOST=127.0.0.1`. Hệ thống vẫn chưa có HTTPS/WAF/chống DDoS tích hợp và chưa qua kiểm thử bảo mật độc lập, vì vậy URL phải giới hạn trong môi trường nội bộ, không công khai trực tiếp ra Internet.

SW/HTML được phục vụ no-cache để nhận bản mới; bundle trong `assets/` có tên hash được cache dài hạn; API trả `no-store`. SW không fallback `/api/` sang HTML. Không sửa trực tiếp `dist/` vì build sẽ tạo lại.

## 7. Kiểm thử tự động

Backend (Node test runner có sẵn trong Node, không cần DB thật - `store`/`ai` được inject giả lập vào `createApp` trong test):

```powershell
cd backend
npm test
```

Frontend (Vitest + Testing Library + fake-indexeddb, không cần backend hay trình duyệt thật):

```powershell
cd frontend
npm test
```

Phạm vi test hiện có: validation, auth, các route API, ba module AI (`ai.js`, `knowledge.js`, `planner.js`) và client/component tương ứng, Markdown-lite, `useNotes`, đồng bộ và Web Push. Test planner bao phủ fallback, giới hạn năng lực ngày, ngày bắt đầu/deadline, phần việc ngoài kỳ, ba kịch bản, cô lập `UserId`, validation và hủy request.

Kết quả kiểm thử: **394 test đều pass (225 backend + 169 frontend)** và `npm run build` frontend thành công. AI lập kế hoạch đã chạy thử structured output với `llama3.2` thật. Bộ test không thay thế kiểm tra SMTP, Trợ lý tri thức với `embeddinggemma` và Web Push thật. Migration `013_note_embeddings.sql` đã áp dụng trên SQL Server cấu hình cho project.

## 8. Kịch bản kiểm tra thủ công (E2E)

1. Trên Chrome/Edge desktop, mở URL chính thức của server: chưa đăng nhập phải thấy màn hình đăng nhập, không thấy danh sách ghi chú. Đăng ký tài khoản mới, xác nhận vào được giao diện; tải lại cùng URL vẫn giữ đăng nhập (token lưu trong profile trình duyệt).
2. Tải lại sau khi SW active, vẫn ở trạng thái đã đăng nhập và online.
3. Tạo ghi chú không có ngày: phải lưu được và không xuất hiện trong Đang thực hiện/Đang quá hạn/Đã hoàn thành.
4. Tạo công việc có bắt đầu và hạn; hạn trước bắt đầu phải bị từ chối.
5. Tạo công việc có hạn trong quá khứ: xuất hiện ở **Đang quá hạn**. Tích hoàn thành: rời nhóm công việc đang quá hạn, có thời điểm hoàn thành và chuyển sang nhãn **Đã hoàn thành trễ**; công việc hoàn thành đúng hoặc trước hạn hiển thị **Đã hoàn thành (không trễ)**.
6. F12 → Network → Offline, thêm/sửa lịch, hoàn thành, xóa/khôi phục rồi tải lại sau khi UI đã cập nhật: dữ liệu phải còn.
7. Chuyển No throttling và không bấm sync: các mốc thời gian phải tự lên SQL.
8. Mở browser/profile thứ hai, đăng nhập cùng tài khoản: dữ liệu và lịch được pull về. Các giờ có thể hiển thị khác nhau nếu khác múi giờ, nhưng epoch phải giống nhau.
9. Đăng xuất: quay lại màn hình đăng nhập, gọi lại API notes phải bị từ chối (401) cho tới khi đăng nhập lại.
10. Bật Ollama (`ollama serve` + đã `ollama pull` model cấu hình), gõ yêu cầu tự nhiên vào Trợ lý AI, bấm "Tạo bằng AI": phải hiện bản nháp trước dưới dạng form sửa được, chỉ lưu khi bấm Áp dụng. Sửa trực tiếp tiêu đề/nội dung/tag/thời gian trong bản nháp trước khi Áp dụng - ghi chú lưu xuống phải đúng theo giá trị **đã sửa**, không phải giá trị AI đề xuất ban đầu. Tắt Ollama rồi thử lại: phải hiện thông báo lỗi rõ ràng, không crash app.

- **Trợ lý tri thức:** đồng bộ một nhóm ghi chú có nội dung liên quan nhưng không lặp đúng từ khóa câu hỏi. Đặt câu hỏi bằng ngôn ngữ tự nhiên: câu trả lời phải có `[1]`, `[2]` tương ứng các thẻ nguồn; bấm nguồn phải đưa về danh sách và tìm đúng tiêu đề. Sửa rồi đồng bộ một nguồn, hỏi lại để xác nhận nội dung mới được dùng. Đăng nhập tài khoản khác để xác nhận không thấy nguồn của tài khoản trước. Tắt Ollama hoặc thiếu `embeddinggemma`: giao diện phải báo lỗi rõ ràng và các chức năng ghi chú vẫn hoạt động.
   - **Kế hoạch AI:** tạo ít nhất ba công việc chưa hoàn thành có deadline khác nhau và đồng bộ. Mở **Kế hoạch AI**, nhập 120 phút/ngày trong 7 ngày và mô phỏng. Kiểm tra tổng phút mỗi ngày không vượt 120, việc quá hạn/hạn gần đứng trước, có ba kịch bản −25%/cơ sở/+25%, và bấm công việc đưa về danh sách. Giảm năng lực xuống 30 phút/ngày để tạo cảnh báo ngoài kỳ. Tắt Ollama và thử lại: vẫn có kế hoạch dự phòng kèm cảnh báo, dữ liệu gốc không đổi.
11. **Lọc danh sách và đối chiếu thống kê:** tạo một ghi chú và bốn công việc: một việc chưa có deadline, một việc đang quá hạn, một việc hoàn thành trước hạn và một việc hoàn thành sau hạn. Ở trang chính, lần lượt chọn **Tất cả / Ghi chú / Công việc**; số kết quả và danh sách phải đổi đúng, đồng thời vẫn kết hợp được với tìm kiếm và tag. Mở Thống kê, chọn **Công việc**: phải thấy `Đang thực hiện = 1`, `Đang quá hạn = 1`, `Đã hoàn thành (không trễ) = 1`, `Đã hoàn thành trễ = 1`; dòng đối chiếu phải ghi tổng `4 công việc` và cộng đủ bốn trạng thái. Chọn **Ghi chú**: các biểu đồ hoàn thành/quá hạn phải ẩn và tag chỉ đếm ghi chú. Ở **14 ngày**, trục dùng từng ngày; chuyển sang **6 tháng**, trục đổi sang từng tháng. Xóa mềm một bản ghi rồi mở lại: tổng và biểu đồ của phân loại đó phải giảm `1`.
12. **Cô lập dữ liệu theo tài khoản:** đăng ký 2 tài khoản khác nhau (A và B). Đăng nhập A, tạo một ghi chú, đồng bộ xong. Đăng xuất (nếu có ghi chú chưa đồng bộ sẽ được hỏi xác nhận trước). Đăng nhập B trên cùng trình duyệt: không được thấy ghi chú của A, danh sách bắt đầu trống. Tạo ghi chú riêng cho B, đồng bộ. Đăng xuất, đăng nhập lại A: chỉ thấy ghi chú của A, không thấy ghi chú của B.
13. **Đổi mật khẩu:** đăng nhập, bấm "Đổi mật khẩu" ở sidebar, đổi thành công với đúng mật khẩu hiện tại. Đăng xuất, thử đăng nhập lại bằng mật khẩu **cũ** phải bị từ chối; đăng nhập bằng mật khẩu **mới** phải thành công.
14. **Chặn đăng nhập sau nhiều lần sai + mở chặn:** nhập sai mật khẩu cho một tài khoản thường (A): lần 1-4 phải báo lần lượt "Bạn còn 4/3/2/1 lượt thử", lần 5 báo "Tài khoản tạm bị chặn đăng nhập... Thử lại sau 15 phút, hoặc liên hệ quản trị viên". Nhập **đúng** mật khẩu ngay sau đó: vẫn bị chặn. Thử một tên đăng nhập **không tồn tại**: thông báo phải giống hệt (không lộ tên nào có thật). Tài khoản **khác** vẫn đăng nhập bình thường. Đăng nhập admin đang quản lý A (hoặc root) -> Quản trị: dòng A hiện nhãn "Tạm chặn đăng nhập (sai mật khẩu 5 lần) - còn N phút" và nút **"Mở chặn đăng nhập"**; bấm -> nhãn biến mất, A đăng nhập đúng mật khẩu được ngay, Nhật ký có dòng "Mở chặn đăng nhập (sai mật khẩu)". Admin thường thử mở chặn tài khoản không do mình quản lý (gọi thẳng API) -> 403. Không ai mở chặn thì sau 15 phút A tự đăng nhập lại được.
15. **Quên mật khẩu qua email** (cần cấu hình SMTP thật, mục 5): đăng nhập, bấm "Thêm email khôi phục", lưu một email thật bạn đọc được - sidebar phải hiển thị ngay email vừa lưu (không cần tải lại trang), và vẫn hiển thị đúng sau khi đăng xuất/đăng nhập lại (không bị mất). Đăng xuất, bấm "Quên mật khẩu?", nhập đúng email đó - phải thấy thông báo thành công và email thật sự đến hộp thư (kiểm tra cả mục spam) trong vài giây. Bấm link trong email: phải ra màn hình đặt mật khẩu mới ngay cả khi trình duyệt đã đăng xuất. Đặt mật khẩu mới, đăng nhập bằng mật khẩu mới thành công. Bấm lại link cũ lần 2: phải báo lỗi hết hạn/không hợp lệ (token dùng 1 lần). Thử nhập một email **không tồn tại** trong hệ thống: vẫn thấy đúng thông báo thành công y hệt (không được lộ email nào có tài khoản, không có mail nào được gửi thật).
16. **Đăng ký kèm email khôi phục (bắt buộc):** ở màn hình đăng ký, thử bấm Đăng ký khi để trống trường "Email khôi phục" - trình duyệt phải chặn ngay (thuộc tính `required`); nếu cố tình gửi thẳng API mà thiếu email, backend cũng phải từ chối (400). Điền đủ tên đăng nhập/mật khẩu/email hợp lệ rồi bấm Đăng ký - vào app ngay, sidebar phải hiển thị đúng email vừa điền mà không cần vào lại mục "Thêm email khôi phục". Thử đăng ký một tài khoản khác dùng lại đúng email đó: phải bị từ chối (409, báo email đã được dùng cho tài khoản khác).
17. **Quản trị - root (cần đã tạo root ở mục 3 Bước 9):** đăng nhập bằng tài khoản thường - không được thấy nút "Quản trị". Đăng nhập bằng tài khoản root - phải thấy nút "Quản trị", bấm vào phải thấy danh sách đầy đủ **mọi** tài khoản kèm số liệu (chưa xong/hoàn thành/quá hạn) và cột "Quản lý bởi" khớp với dữ liệu thật. Bấm "Xem" một tài khoản khác: phải thấy đúng ghi chú/công việc của tài khoản đó, không sửa/xóa được gì (chỉ có nút Quay lại). Bấm "+ Thêm người dùng" tạo một tài khoản mới, thử để trống email - phải bị chặn (bắt buộc). Bấm "Sửa" một tài khoản, đổi tên hiển thị/email, lưu lại - danh sách phải cập nhật ngay. Bấm "Đặt lại mật khẩu" cho một tài khoản khác (không cần biết mật khẩu cũ), đăng nhập thử bằng tài khoản đó với mật khẩu mới - phải thành công. Bấm "Khóa" một tài khoản khác: trạng thái chuyển "Đã khóa", đăng nhập thử bằng tài khoản đó - phải bị từ chối (401, báo vô hiệu hóa). Bấm "Mở khóa" lại - đăng nhập lại phải thành công. Thử bấm khóa chính tài khoản root đang dùng: phải bị chặn (không có nút Khóa cạnh dòng root).
18. **Khóa tài khoản có hiệu lực ngay với phiên đang mở (không chỉ chặn đăng nhập mới):** mở 2 trình duyệt/profile - một đăng nhập tài khoản thường (A), một đăng nhập root. Ở trình duyệt A, thêm một ghi chú để chắc chắn API đang hoạt động bình thường. Bên root, bấm "Khóa" tài khoản A. Quay lại trình duyệt A **không tải lại trang, không đăng xuất** - thử thêm/sửa ghi chú hoặc bấm "Đồng bộ ngay": phải thấy lỗi ngay lập tức (API trả 401, báo tài khoản đã bị vô hiệu hóa), không phải chờ đến khi đóng mở lại hay hết hạn phiên.
19. **Phân quyền admin + gán phạm vi quản lý (root gán, admin thường bị giới hạn):** đăng nhập root, chọn 1 user thường (B), bấm "Phân quyền admin" - xác nhận, B trở thành admin. Chọn 1 user thường khác (C), bấm "Gán quản lý", chọn admin B trong danh sách, xác nhận. Đăng xuất, đăng nhập bằng B: phải thấy nút "Quản trị" (không phải root); mở ra, danh sách **chỉ** có đúng C, không thấy bất kỳ tài khoản nào khác kể cả tài khoản của chính B; không có nút "+ Thêm người dùng", "Nhật ký", "Phân quyền admin"/"Hạ quyền". Bấm "Xem" C: xem được ghi chú của C bình thường. Thử sửa URL/gọi API để xem một tài khoản khác không phải C: phải bị từ chối (403). Đăng xuất, đăng nhập lại root, bấm "Hạ quyền" cho B - xác nhận B trở lại user thường; kiểm tra C hiện "Chưa gán" (không còn ai quản lý); đăng nhập thử bằng B lần nữa: không còn thấy nút "Quản trị".
20. **Nhật ký hành động quản trị (chỉ root xem được):** vẫn đang đăng nhập root từ kịch bản trên, bấm nút "Nhật ký" - phải thấy đầy đủ các hành động vừa làm ở kịch bản 19 theo đúng thứ tự mới nhất trước (phân quyền B, gán C cho B, hạ quyền B), mỗi dòng có đúng người thực hiện (root), hành động, đối tượng (B hoặc C) và thời gian hợp lý. Đăng nhập bằng một tài khoản user thường bất kỳ, thử gọi thẳng API `/api/admin/audit-log`: phải bị từ chối (403) dù có gõ đúng đường dẫn.

21. **Xung đột đồng bộ:** mở 2 trình duyệt/profile (X, Y) cùng đăng nhập một tài khoản, cả hai đã đồng bộ cùng một ghi chú. Ở Y bật Offline (F12 → Network), sửa tiêu đề ghi chú thành "Bản Y". Ở X (online) sửa cùng ghi chú thành "Bản X", chờ đồng bộ xong. Tắt Offline ở Y: ghi chú ở Y phải hiện nhãn "Xung đột", sidebar xuất hiện mục "Xung đột đồng bộ" (1), bảng so sánh hiển thị "Bản Y" / "Bản X"; SQL vẫn là "Bản X" (không bị ghi đè). Lặp lại 3 lần để thử cả 3 nút: "Giữ bản của tôi" → SQL thành "Bản Y" và X nhận "Bản Y" ở lần đồng bộ sau; "Dùng bản trên server" → Y trở về "Bản X", không gửi gì lên; "Giữ cả hai" → Y có 2 ghi chú ("Bản X" và "Bản Y (bản sao xung đột)"), cả hai lên SQL. Thử chỉnh đồng hồ máy Y nhanh hơn vài giờ trước khi sửa: kết quả vẫn phải là xung đột (không thắng nhờ đồng hồ).
22. **Đồng bộ delta:** F12 → Network, lọc `notes?since`. Lần đồng bộ đầu sau đăng nhập gọi `since=0` và nhận đủ dữ liệu; các lần sau gọi `since=<số>`, mảng `notes` rỗng nếu không có gì thay đổi, hoặc chỉ chứa đúng ghi chú vừa sửa ở thiết bị khác.
23. **Nhắc việc (Web Push trên desktop)** (cần đã làm mục 3 Bước 6b và mở bản production bằng URL HTTPS của server): bấm **Nhắc việc** → bật cho profile Chrome/Edge hiện tại → cho phép thông báo. Bấm "Gửi thử" và xác nhận thông báo hệ điều hành xuất hiện. Chọn "Trước 5 phút", tạo công việc có hạn sau khoảng 6 phút, chờ đồng bộ rồi đóng tab: thông báo chỉ được kỳ vọng khi trình duyệt desktop/hệ điều hành vẫn cho phép xử lý push nền. Bấm thông báo phải mở lại URL server. Đăng xuất phải gỡ đăng ký của tài khoản cũ. Thử URL HTTP không an toàn phải nhận hướng dẫn dùng HTTPS/localhost.

```sql
-- Đăng ký thiết bị và các lần đã nhắc
SELECT s.Id, u.Username, LEFT(s.Endpoint, 60) AS Endpoint, s.CreatedAt FROM dbo.PushSubscriptions s JOIN dbo.Users u ON u.Id = s.UserId;
SELECT r.ServerId, n.Title, r.DueAt, r.SentAt FROM dbo.NoteReminders r JOIN dbo.Notes n ON n.ServerId = r.ServerId ORDER BY r.SentAt DESC;
```

```sql
USE PwaNotesDB;
SELECT n.ServerId, u.Username AS ChuSoHuu, n.Title, n.Kind, n.Done, n.Deleted,
       n.CreatedAt, n.StartAt, n.DueAt, n.CompletedAt, n.DeletedAt, n.UpdatedAt, n.Version
FROM dbo.Notes n
JOIN dbo.Users u ON u.Id = n.UserId
ORDER BY n.UpdatedAt DESC;
```

Không kiểm tra hoặc trình bày thao tác cài PWA/mobile vì nằm ngoài phạm vi. Chỉ kiểm tra bản web production trên Chrome/Edge desktop qua URL server; bài test offline cần bản build và Service Worker đã điều khiển trang.

## 9. Ghi nhận kiểm thử và giới hạn bằng chứng

Các mục sau là ghi nhận từ những lượt kiểm tra trước trong phiên làm việc, cho bản có lịch sau migration `002`. Chúng không phải báo cáo có thể tái lập độc lập: chưa lưu bộ log, ảnh/video, phiên bản browser và mã định danh bản build tương ứng trong project.

- Build TypeScript strict, bật kiểm tra biến/tham số không dùng; kiểm tra cú pháp các module backend.
- Migration SQL chạy lại không làm mất bản ghi; IndexedDB nâng từ v2 giữ pending cũ.
- API chặn ngày sai/kiểu sai/client cũ; retry đồng thời không tạo bản trùng; bản cũ không ghi đè lịch mới hơn.
- Edge và Chrome: offline thêm/sửa/hoàn thành/xóa/khôi phục/reload; tự sync lịch vào SQL thật; client độc lập nhận dữ liệu và đổi múi giờ chính xác.
- Không ghi nhận lỗi JavaScript chưa xử lý hoặc tràn ngang ở các kích thước desktop đã kiểm tra 1440px và 1024px; 390px không còn là tiêu chí nghiệm thu vì mobile ngoài phạm vi.
- `npm audit` tại thời điểm rà soát: 0 cảnh báo ở hai package. Đây không phải chứng nhận bảo mật toàn hệ thống.

Các ghi chú thử có ID riêng đã được xóa khỏi SQL. Script tạm, cache và file build được dọn sau kiểm tra. Repo giữ **394 test (225 backend + 169 frontend)** trong source. T-SQL và migration 013 đã kiểm tra trên SQL Server; planner đã gọi `llama3.2` thật. **Chưa** kiểm tra nhận FCM thật và Trợ lý tri thức với `embeddinggemma`; thực hiện các kịch bản tay ở mục 8.

Lượt kiểm tra bổ sung dùng Edge headless, profile riêng và SQL thật ghi nhận ba kết quả PASS trong đầu ra công cụ:

| Kịch bản | Kết quả quan sát |
| --- | --- |
| Tạo note offline, reload, dừng server frontend 4173, bật online trong khi API 4000 còn chạy | Note còn trong PWA và tự xuất hiện trong SQL |
| Chặn request protocol trong khi `navigator.onLine=true`, sau đó bỏ chặn | Hiển thị lỗi kết nối API cụ thể, tự đồng bộ lại |
| Giả lập protocol trả HTML, sau đó sửa và bấm đồng bộ | Phân biệt lỗi sai phản hồi, đồng bộ thủ công thành công |

Lượt đó không ghi nhận `pageerror`; đã xóa một note thử theo UUID riêng và script tạm. Build TypeScript/Vite thành công. Bảng này là bản tóm tắt kết quả đã quan sát, không thay thế log gốc hoặc bộ test đi kèm source; không chứng minh mọi tình huống đều ổn định.

Để có bằng chứng nộp/bảo vệ, chạy lại §8 trên bản bàn giao và lưu báo cáo gồm: ngày chạy, phiên bản Chrome/Edge/Node, SHA-256 file JS trong `frontend/dist/assets`, từng bước thao tác, kết quả mong đợi/thực tế, ảnh Network/UI và truy vấn SQL theo đúng UUID thử. Bổ sung ba kịch bản ở bảng trên; ghi rõ PASS/FAIL và dọn dữ liệu thử sau khi thu bằng chứng. Không đưa `.env`, mật khẩu hoặc nội dung cá nhân vào báo cáo. Tài liệu kiểm thử có thể giữ lại dù script và dữ liệu thử được dọn.

## 10. Giới hạn cần trình bày đúng

- Mỗi tài khoản có dữ liệu ghi chú riêng (cô lập theo `UserId` ở database, kiểm tra quyền sở hữu khi đồng bộ). Có 3 cấp: **user** (tài khoản thường), **admin** (được root phân quyền, chỉ xem/sửa/khóa được user root đã **gán riêng** cho họ quản lý - không tự thêm user mới, không phân quyền cho ai khác), **root** (đúng 1 tài khoản, tạo qua `npm run make-admin`, không có endpoint tự phong qua HTTP - mục 3 Bước 9, toàn quyền trên mọi tài khoản). Mỗi user chỉ do **1** admin quản lý (không gán được cho nhiều admin cùng lúc). Cả admin lẫn root đều chỉ **xem** được ghi chú của user trong phạm vi mình (**chỉ đọc**, không sửa/xóa từng ghi chú thay người dùng). Mọi hành động quản trị (tạo/sửa/khóa/mở khóa/đặt lại mật khẩu/phân quyền/gán) được ghi vào nhật ký, chỉ **root** xem được (mục 23.7) - admin thường không xem được nhật ký kể cả hành động của chính họ. Đăng ký hiện đang mở tự do cho bất kỳ ai truy cập được vào địa chỉ backend, phù hợp phạm vi demo nội bộ đã thống nhất; muốn giới hạn ai được tạo tài khoản cần tự thêm kiểm soát (mã mời, danh sách cho phép...).
- **Khóa tài khoản (admin) có hiệu lực ngay, kể cả với token đã cấp từ trước:** mọi route cần đăng nhập (`requireAuth`, dùng cho `/api/notes*`/`/api/ai*`/`/api/auth/me`...) tra bảng `Users` theo `Id` mỗi request, không chỉ xác minh chữ ký JWT - nên chữ ký token vẫn hợp lệ nhưng tài khoản vừa bị khóa sẽ bị từ chối (401) ngay từ request tiếp theo, không cần đợi token tự hết hạn (`JWT_EXPIRES_IN`, mặc định 7 ngày) hay đăng xuất/đăng nhập lại. `requireAdmin` tái sử dụng dòng user mà `requireAuth` vừa đọc nên route quản trị không query trùng lần thứ hai. Đánh đổi: hệ thống xác thực không còn hoàn toàn stateless (mỗi request cần 1 truy vấn theo khóa chính `Users.Id`) - chấp nhận được ở quy mô demo hiện tại, cần cân nhắc lại (cache, hoặc chỉ kiểm tra định kỳ thay vì mỗi request) nếu lưu lượng tăng cao.
- Chặn đăng nhập sai mật khẩu tính theo tài khoản và lưu trong SQL (bền qua restart, không né được bằng đổi IP). Đánh đổi có chủ đích: ai biết tên đăng nhập của bạn cũng có thể cố ý nhập sai 5 lần để chặn bạn 15 phút - vì vậy chặn **tự hết hạn** thay vì chặn vĩnh viễn, và admin mở sớm được. Chưa có giới hạn tổng theo IP cho việc dò mật khẩu nhiều tài khoản khác nhau, chưa có thông báo (email/app) cho chủ tài khoản khi bị chặn. Tên đăng nhập không tồn tại được đếm trong RAM (mất khi restart - không ảnh hưởng tài khoản thật nào). Giới hạn đăng ký/quên mật khẩu theo IP vẫn lưu trong bộ nhớ tiến trình (mất khi restart, không phù hợp nhiều instance đứng sau load balancer).
- "Quên mật khẩu" có 2 đường: (1) tự phục vụ qua email nếu tài khoản đã gắn email và backend đã cấu hình SMTP thật (mục 3 Bước 8, mục 5) - đây là **dịch vụ hạ tầng bên ngoài duy nhất** trong app cần mạng Internet, ngoại lệ có chủ đích với nguyên tắc "Trợ lý AI chạy local" (AI vẫn 100% local qua Ollama, chỉ việc gửi email là dùng SMTP thật); (2) script `npm run reset-password` chạy trực tiếp trên máy chủ, luôn hoạt động kể cả không có mạng/SMTP, dùng khi chưa gắn email hoặc gửi mail thất bại - **luôn cần người có quyền truy cập máy chủ** hỗ trợ trong trường hợp này. Token đặt lại mật khẩu chỉ lưu bản băm SHA-256, dùng 1 lần, tự hết hạn sau `RESET_TOKEN_TTL_MIN` phút; endpoint yêu cầu gửi email bị giới hạn 5 lần/giờ theo IP và luôn trả cùng thông báo dù email có tồn tại hay không.
- Trên thiết bị/trình duyệt dùng chung bởi nhiều tài khoản: hệ thống tự dọn cache ghi chú local khi phát hiện tài khoản đăng nhập khác với lần trước, và cảnh báo trước khi đăng xuất nếu còn ghi chú chưa đồng bộ. Vẫn nên ưu tiên mỗi người dùng thiết bị/trình duyệt riêng để tránh rủi ro thao tác nhầm.
- Ba chức năng AI dùng Ollama local. Tạo bản nháp và lập kế hoạch có fallback bằng quy tắc; Trợ lý tri thức cần cả model sinh câu trả lời và model embedding. Truy vấn tri thức và lập kế hoạch chỉ gửi dữ liệu liên quan đã đồng bộ của đúng tài khoản tới Ollama cục bộ, không gửi API AI cloud. Ước lượng tiến độ không có dữ liệu lịch sử thời gian làm thực tế nên chỉ mang tính tham khảo.
- Xung đột được phát hiện theo phiên bản trên server, không theo đồng hồ client. Chưa có **hợp nhất tự động từng trường** (vd. máy A đổi tiêu đề, máy B tích hoàn thành cùng lúc vẫn là 1 xung đột người dùng phải chọn) vì không lưu bản gốc chung của 2 phía. Trường hợp hiếm: ghi chú **mới** đã lên server nhưng mất phản hồi, đồng thời thiết bị khác đã kịp tải về và sửa nó trước khi thiết bị gốc gửi lại - sẽ hiện thành xung đột (đúng về dữ liệu, không mất bên nào).
- Nhắc việc chỉ dựa trên dữ liệu **đã đồng bộ lên server**: công việc tạo/sửa/hoàn thành khi offline chưa kịp đồng bộ sẽ không được nhắc hoặc vẫn bị nhắc theo trạng thái cũ trên server. Cần Internet (dịch vụ push của trình duyệt) và HTTPS/localhost; không có thông báo khi chạy dev. Thiết bị hết hạn phiên đăng nhập (không bấm Đăng xuất) vẫn nhận nhắc việc của tài khoản đó cho tới khi đăng nhập tài khoản khác hoặc tắt trong mục Nhắc việc. Chưa có nhắc việc riêng cho từng công việc (thời điểm nhắc áp dụng cho cả tài khoản) và chưa có nhắc lặp lại.
- Chưa đồng bộ nền (Background Sync) sau khi đóng app.
- Thời gian tạo/hoàn thành/xóa của dữ liệu cũ không thể suy ra chính xác, nên không tự điền giả.
- Xóa mềm giữ bản hiện tại, không phải audit log mọi lần thay đổi.
- Bản nháp chưa bấm lưu không được autosave; xóa site data có thể mất pending.
- Đồng bộ delta phát hiện thay đổi qua cột `rowversion`; ghi chú bị xóa là xóa mềm nên vẫn được truyền như một thay đổi. Nếu database server bị khôi phục từ bản sao lưu, server phát hiện con trỏ không hợp lệ, client tải lại toàn bộ và gửi lại những ghi chú local không còn trên server; thay đổi server đã mất mà thiết bị cũng không còn giữ thì không khôi phục được. Trang quản trị (xem ghi chú của user khác) vẫn tải toàn bộ một lần.
- Markdown-lite chỉ hỗ trợ **đậm**/*nghiêng*/`code`/danh sách một cấp, chưa có heading, bảng, ảnh hay block lồng nhau kiểu Notion.
- Chưa có tệp đính kèm và đồng bộ realtime qua WebSocket giữa nhiều thiết bị (vẫn dùng polling định kỳ như trước).
- Chưa có đo tải lần đầu dưới 3 giây theo quy trình thí nghiệm; không khẳng định không bao giờ có lỗi.
- Service Worker có thể phục vụ bản JS cũ từ cache nếu chỉ reload thông thường sau khi build lại - đóng hẳn và mở lại tab, hoặc xóa Service Worker cũ trong DevTools (Application → Service Workers → Unregister, hoặc Clear site data) để chắc chắn nhận bản mới.
