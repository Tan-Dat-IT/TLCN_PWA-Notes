import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Cấu hình chính của PWA: manifest + chiến lược cache của Service Worker.
// registerType: 'autoUpdate' -> tự động cập nhật Service Worker khi có bản mới,
// tránh lỗi "sửa code mà không thấy hiệu lực" đã nói ở phần rủi ro.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    css: false
  }
})
