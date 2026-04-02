import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const configDir = path.dirname(fileURLToPath(import.meta.url))
const repoPackage = JSON.parse(
  fs.readFileSync(path.resolve(configDir, '../package.json'), 'utf8')
) as {
  displayName?: string
  version?: string
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appDisplayName = repoPackage.displayName ?? '发货管家'
  const appVersion = repoPackage.version ?? '0.0.0'

  return {
    define: {
      __APP_DISPLAY_NAME__: JSON.stringify(appDisplayName),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_DEV_PROXY_TARGET || 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
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
          name: appDisplayName,
          short_name: appDisplayName,
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
  }
})
