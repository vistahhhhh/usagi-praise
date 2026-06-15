/**
 * Netlify Edge Function — Coze 智能体 SSE 流代理
 *
 * 前端 → /api/coze-chat → 本函数（注入 API Token）→ Coze v3/chat SSE 流
 * Edge Function 原生支持流式转发，Token 从 Netlify 环境变量读取
 */

export default async function handler(request, context) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiToken = Netlify.env.get('COZE_API_TOKEN');
  if (!apiToken) {
    console.error('[Coze] Missing COZE_API_TOKEN env var');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();

    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiToken,
      },
      body: JSON.stringify(body),
    });

    // 直接转发 SSE 流
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[Coze] Proxy error:', err.message);
    return new Response(JSON.stringify({ error: 'Upstream request failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
