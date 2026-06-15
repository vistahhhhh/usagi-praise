/**
 * Netlify Function — ECNU 快速问答代理
 *
 * 前端 → /api/ecnu-chat → redirect → 本函数（注入 API Key）→ ECNU API
 * Key 从服务端环境变量读取，不暴露给前端
 */

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.ECNU_API_KEY;
  if (!apiKey) {
    console.error('[ECNU] Missing ECNU_API_KEY env var');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const requestBody = await req.json();

    const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[ECNU] Proxy error:', err.message);
    return new Response(JSON.stringify({ error: 'Upstream request failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
