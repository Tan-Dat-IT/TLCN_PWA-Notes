import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Cấu hình chính của PWA: manifest + chiến lược cache của Service Worker.
// SW tự kích hoạt bản mới; src/lib/pwaUpdates.ts kiểm tra và tải lại giao diện
// khi không còn form/panel đang mở. Không đăng ký SW lần thứ hai bằng script sinh sẵn.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Notes – Ghi chú & Công việc',
        short_name: 'Notes',
        lang: 'vi',
        description: 'Ghi chú và quản lý công việc, dùng được cả khi offline, tự đồng bộ khi có mạng',
        start_url: '.',
        display: 'standalone',
        background_color: '#f5f7fa',
        theme_color: '#246e62',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // Android tự cắt icon theo hình dạng của máy (tròn/bo góc) - bản maskable
          // có nền tràn viền và hình nằm trong vùng an toàn nên không bị cắt mất.
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Đăng ký native không dùng script inject của plugin: khai báo rõ
        // để SW mới kích hoạt và phát controllerchange cho trang đang mở.
        skipWaiting: true,
        clientsClaim: true,
        // Cache toàn bộ "app shell" (JS/CSS/HTML) theo chiến lược Cache-First
        // để app mở được ngay cả khi mất mạng hoàn toàn.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallbackDenylist: [/^\/api\//],
        // Bộ xử lý Web Push (nhắc việc) nằm ở public/push-sw.js, nạp thêm vào
        // Service Worker do Workbox sinh ra.
        importScripts: ['push-sw.js']
      }
    })
  ],
  server: {
    // 0.0.0.0 là địa chỉ BIND: Vite lắng nghe trên mọi card mạng. Máy
    // client phải mở IP/hostname thật của server, không mở http://0.0.0.0.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4000' }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4000' }
  },
  test: {
    // Chỉ chạy test của ứng dụng; thư mục cache có thể chứa bản thử tuần cũ.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    css: false
  }
})
