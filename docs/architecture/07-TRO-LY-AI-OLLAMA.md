# Kiến trúc AI local với Ollama

[← Mục lục](00-MUC-LUC.md)

## 1. Ba chức năng AI

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    User[Người dùng] --> Draft[Trợ lý tạo bản nháp]
    User --> Knowledge[Trợ lý tri thức có nguồn]
    User --> Planner[Lập kế hoạch và mô phỏng]
    Draft --> Rules[viDate.js]
    Draft --> Chat[Model sinh văn bản]
    Rules --> Editable[Bản nháp sửa được]
    Chat --> Editable
    Knowledge --> Embed[Model embedding]
    Knowledge --> Chat
    Embed --> Sources[Nguồn liên quan]
    Sources --> Answer[Câu trả lời kèm dẫn nguồn]
    Planner --> Chat
    Planner --> Simulation[Thuật toán xếp lịch xác định]
```

- **Tạo bản nháp:** chuyển yêu cầu tiếng Việt thành dữ liệu ghi chú; người dùng sửa và xác nhận trước khi lưu.
- **Hỏi kho tri thức:** tìm theo ngữ nghĩa trong ghi chú đã đồng bộ của tài khoản, tổng hợp câu trả lời và trả nguồn để kiểm chứng.
- **Lập kế hoạch:** AI ước lượng khối lượng/ưu tiên; thuật toán mô phỏng lịch và rủi ro. Chi tiết tại [11-AI-LAP-KE-HOACH.md](11-AI-LAP-KE-HOACH.md).

## 2. Luồng tạo bản nháp

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    actor U as Người dùng
    participant UI as AIAssistant
    participant API as Express
    participant Parser as viDate.js
    participant LLM as Ollama
    U->>UI: Nhập yêu cầu
    UI->>API: POST /api/ai/draft
    API->>Parser: Tách ngày giờ bằng quy tắc
    API->>LLM: Prompt + JSON schema
    LLM-->>API: Dữ liệu có cấu trúc
    API-->>UI: Bản nháp đã validate
    UI-->>U: Form sửa được, chưa lưu
```

Nếu Ollama lỗi hoặc quá thời gian, backend trả bản nháp cơ bản kèm cảnh báo. Hủy từ giao diện sẽ hủy request tới Ollama.

## 3. Luồng Trợ lý tri thức có dẫn nguồn

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
sequenceDiagram
    actor U as Người dùng
    participant UI as KnowledgeAssistant
    participant API as /api/ai/knowledge/query
    participant SQL as SQL Server
    participant E as Ollama embedding
    participant LLM as Ollama sinh câu trả lời
    U->>UI: Đặt câu hỏi
    UI->>API: question + JWT
    API->>SQL: Lấy note theo UserId và đọc cache
    API->>E: Chỉ embed note mới hoặc đã đổi
    E-->>API: Vector ghi chú
    API->>SQL: Upsert NoteEmbeddings
    API->>E: Embed câu hỏi
    API->>API: Cosine similarity, chọn top-K
    API->>LLM: Câu hỏi + nguồn liên quan
    LLM-->>API: Câu trả lời có [1], [2]
    API-->>UI: Câu trả lời + thẻ nguồn
```

Cache hợp lệ khi `NoteVersion`, SHA-256 nội dung và model embedding đều khớp. Ghi chú bị xóa được dọn khỏi cache. Nếu không có nguồn đủ ngưỡng, backend báo không tìm thấy và không gọi model sinh câu trả lời.

## 4. Cô lập dữ liệu và kiểm soát nguồn

- `UserId` lấy từ JWT; client không được chọn ID tài khoản cần tra cứu.
- Mọi truy vấn note và embedding đều lọc theo `UserId`.
- Nội dung nguồn được đánh dấu là dữ liệu, không phải chỉ dẫn, để giảm prompt injection từ ghi chú.
- Model chỉ nhận tối đa các nguồn top-K, không nhận toàn bộ database.
- Dẫn nguồn ngoài phạm vi bị loại; nếu model bỏ quên dẫn nguồn, backend bổ sung danh sách nguồn thực tế đã dùng.
- Thẻ nguồn có tiêu đề, đoạn trích, tag và điểm liên quan; bấm thẻ sẽ tìm lại ghi chú trên giao diện.

## 5. Biên riêng tư

```mermaid
%%{init: {"theme":"base","themeVariables":{"darkMode":false,"background":"#ffffff","primaryColor":"#eaf2ff","primaryTextColor":"#172033","primaryBorderColor":"#5b6b88","secondaryColor":"#edf8f0","secondaryTextColor":"#172033","secondaryBorderColor":"#5b6b88","tertiaryColor":"#fff7e6","tertiaryTextColor":"#172033","tertiaryBorderColor":"#7c6a46","lineColor":"#475569","textColor":"#172033","mainBkg":"#eaf2ff","nodeBorder":"#5b6b88","clusterBkg":"#f8fafc","clusterBorder":"#94a3b8","edgeLabelBackground":"#ffffff","actorBkg":"#eaf2ff","actorBorder":"#5b6b88","actorTextColor":"#172033","signalColor":"#475569","signalTextColor":"#172033","labelBoxBkgColor":"#ffffff","labelTextColor":"#172033","fontFamily":"Arial, sans-serif"},"themeCSS":"svg { background-color: #ffffff !important; }"}}%%
flowchart LR
    Browser -->|JWT + yêu cầu| Backend
    Backend --> SQL[(SQL Server)]
    Backend -->|HTTP nội bộ| Ollama[Ollama local]
    Ollama -. không gọi .-> Cloud[API AI cloud]
```

Mặc định Ollama chạy tại `127.0.0.1:11434`, nên câu hỏi và nguồn không rời máy chủ. Đổi `OLLAMA_URL` sang máy khác sẽ làm thay đổi biên riêng tư.

## 6. Cấu hình

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Địa chỉ Ollama |
| `OLLAMA_MODEL` | `llama3.2` | Model tạo bản nháp và câu trả lời |
| `OLLAMA_EMBED_MODEL` | `embeddinggemma` | Model tạo vector ngữ nghĩa |
| `OLLAMA_TIMEOUT_MS` | `60000` | Timeout tạo bản nháp |
| `OLLAMA_KNOWLEDGE_TIMEOUT_MS` | `90000` | Timeout từng request trong luồng tri thức |
| `OLLAMA_PLANNER_TIMEOUT_MS` | `90000` | Timeout ước lượng cho luồng lập kế hoạch |
| `OLLAMA_KEEP_ALIVE` | `30m` | Thời gian giữ model trong RAM |
| `KNOWLEDGE_MIN_SIMILARITY` | `0.28` | Ngưỡng cosine để nhận note làm nguồn |

Dẫn nguồn giúp kiểm chứng nhưng không biến câu trả lời AI thành dữ liệu tuyệt đối chính xác.
