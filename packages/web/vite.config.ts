import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发模式：监听 0.0.0.0 供局域网设备访问，/api 代理到本机后端 8080
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
