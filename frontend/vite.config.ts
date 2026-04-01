import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA：离线缓存/安装到桌面，后续用于 Web Push。
    VitePWA({
      registerType: 'autoUpdate',
      // dev 下也开启，方便本地验证 SW/manifest。
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: '发货管家',
        short_name: '发货管家',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#aa3bff',
      },
      workbox: {
        // 简化配置：优先保证基础页面可离线访问。
        runtimeCaching: [
          {
            urlPattern: ({ request }) =>
              request.destination === 'script' ||
              request.destination === 'style' ||
              request.destination === 'document',
            handler: 'StaleWhileRevalidate',
          },
        ],
      },
    }),
  ],
})
