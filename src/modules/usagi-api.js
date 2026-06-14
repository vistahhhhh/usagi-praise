/**
 * usagi-api.js — 调用真实 LLM 获取乌萨奇风格回复
 * 使用 OpenAI 兼容接口（ECNU）
 *
 * 开发环境：走 Vite 代理 /api/chat → 避免 CORS
 * 生产环境：走 Vercel rewrites /api/chat → 同样避免 CORS
 */

import { USAGI_SYSTEM_PROMPT } from '../data/usagi-system-prompt.js';

const API_KEY = import.meta.env.VITE_API_KEY || '';
const API_MODEL = import.meta.env.VITE_API_MODEL || 'ecnu-max';

// 开发环境(Vite proxy)和生产环境(Vercel rewrites)都走 /api/chat 代理路径
const API_ENDPOINT = '/api/chat/chat/completions';

/**
 * 调用 LLM 获取乌萨奇风格回复
 * @param {string} worryText — 用户倾诉的烦恼文本
 * @returns {Promise<string>} — 乌萨奇的回复文本
 */
export async function getUsagiReply(worryText) {
  if (!API_KEY) {
    console.warn('[UsagiAPI] Missing API key, falling back to default reply');
    return '噗噜噜…（乌萨奇吃掉了你的烦恼！）呀哈！你很棒的！';
  }

  if (!API_ENDPOINT) {
    console.warn('[UsagiAPI] Missing API endpoint, falling back to default reply');
    return '噗噜噜…乌萨奇吃掉了烦恼！呀哈！你超棒的！';
  }

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY,
      },
      body: JSON.stringify({
        model: API_MODEL,
        messages: [
          { role: 'system', content: USAGI_SYSTEM_PROMPT },
          { role: 'user', content: worryText },
        ],
        temperature: 0.85,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[UsagiAPI] API error:', response.status, errText);
      throw new Error('API returned ' + response.status);
    }

    const data = await response.json();

    // 兼容 OpenAI 格式
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[UsagiAPI] Unexpected response format:', data);
      throw new Error('Empty response content');
    }

    console.log('[UsagiAPI] Reply received:', content.slice(0, 60) + '...');
    return content.trim();
  } catch (err) {
    console.error('[UsagiAPI] Request failed:', err);
    // 降级：返回一条兜底回复
    return '噗噜噜…乌萨奇吃掉了烦恼！呀哈！你超棒的，继续加油！';
  }
}
