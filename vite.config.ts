import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    proxy: {
      // 开发模式下把 socket.io 的请求代理到 Node 服务端（3001）
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
})
