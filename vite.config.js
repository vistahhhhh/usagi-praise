import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: true,
    proxy: {
      // 将 /api/chat 代理到 ECNU API，解决浏览器 CORS 限制
      '/api/chat': {
        target: 'https://chat.ecnu.edu.cn/open/api/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/chat/, ''),
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
