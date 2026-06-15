/**
 * Vercel API Route — ECNU 快速问答代理
 *
 * 前端 → /api/ecnu-chat → 本函数（注入 API Key）→ ECNU API
 * Key 从服务端环境变量读取，不暴露给前端
 */

export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ECNU_API_KEY;
  if (!apiKey) {
    console.error('[ECNU] Missing ECNU_API_KEY env var');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[ECNU] Upstream error:', response.status, JSON.stringify(data));
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[ECNU] Proxy error:', err.message);
    return res.status(500).json({ error: 'Upstream request failed' });
  }
}
