import webpush from 'web-push'

// Sinh cặp khóa VAPID cho nhắc việc (Web Push). Chạy 1 lần cho mỗi máy chủ,
// dán 2 dòng in ra vào backend/.env rồi khởi động lại backend. Giữ bí mật
// VAPID_PRIVATE_KEY; đổi khóa sẽ làm mọi thiết bị phải bật lại nhắc việc.
const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
