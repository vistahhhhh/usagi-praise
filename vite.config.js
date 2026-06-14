import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: true,
    proxy: {
      // 快速问答模式：ECNU OpenAI 兼容接口
      '/api/chat': {
        target: 'https://chat.ecnu.edu.cn/open/api/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/chat/, ''),
        secure: true,
      },
      // 智能体模式：Coze Bot API
      '/api/coze': {
        target: 'https://api.coze.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/coze/, ''),
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
