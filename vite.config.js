import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // 加载所有 .env 变量（不仅是 VITE_ 前缀的）
  // 这样本地开发中间件可以读取服务端密钥
  const env = loadEnv(mode, process.cwd(), '');

  return {
    root: '.',
    publicDir: 'public',
    server: {
      port: 3000,
      open: true,
    },
    plugins: [
      // 本地开发 API 代理中间件
      // 读取 .env 中的密钥，注入到请求头，转发到外部 API
      // 生产环境由 Vercel/Netlify Serverless Function 完成，不需要此中间件
      {
        name: 'dev-api-proxy',
        configureServer(server) {
          // ECNU 快速问答代理
          server.middlewares.use('/api/ecnu-chat', (req, res, next) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end('Method not allowed');
              return;
            }

            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              try {
                const apiKey = env.ECNU_API_KEY;
                if (!apiKey) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Missing ECNU_API_KEY in .env' }));
                  return;
                }

                const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey,
                  },
                  body: body,
                });

                const data = await response.json();
                res.statusCode = response.status;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
              } catch (err) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          });

          // Coze 智能体 SSE 流代理
          server.middlewares.use('/api/coze-chat', (req, res, next) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end('Method not allowed');
              return;
            }

            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              try {
                const apiToken = env.COZE_API_TOKEN;
                if (!apiToken) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Missing COZE_API_TOKEN in .env' }));
                  return;
                }

                const response = await fetch('https://api.coze.cn/v3/chat', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiToken,
                  },
                  body: body,
                });

                res.statusCode = response.status;
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                const pump = async () => {
                  try {
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      res.write(decoder.decode(value, { stream: true }));
                    }
                  } catch (e) {
                    console.error('[DevProxy/Coze] Stream error:', e.message);
                  } finally {
                    res.end();
                  }
                };

                await pump();
              } catch (err) {
                if (!res.headersSent) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err.message }));
                }
              }
            });
          });
        },
      },
    ],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
  };
});
