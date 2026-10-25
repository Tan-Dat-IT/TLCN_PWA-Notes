import dotenv from 'dotenv'

// Nạp backend/.env MỘT lần, trước mọi module đọc process.env lúc import.
// Với ES module, các import được thực thi theo thứ tự khai báo: nếu chỉ gọi
// dotenv trong store.js thì auth.js/ai.js/app.js (được server.js import trước)
// đã đọc JWT_SECRET, OLLAMA_URL... khi .env CHƯA được nạp - production thì báo
// thiếu JWT_SECRET, dev thì âm thầm dùng secret mặc định. Mọi module đọc
// process.env ở cấp module phải `import './env.js'` đầu tiên.
// Biến môi trường đặt sẵn (vd $env:NODE_ENV) được ưu tiên hơn giá trị trong .env.
dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true })
