/**
 * usagi-api.js — 双模式 API 调用
 *
 * 模式 1：快速问答（默认）— ECNU OpenAI 兼容接口，无记忆，响应快
 * 模式 2：智能体模式 — Coze Bot v3/chat stream，有记忆，回答较慢
 *
 * 开发环境：走 Vite 代理 → 避免 CORS
 * 生产环境：走 Vercel rewrites → 同样避免 CORS
 */

import { USAGI_SYSTEM_PROMPT } from '../data/usagi-system-prompt.js';

// ===== 快速问答模式配置 (ECNU OpenAI) =====
const QUICK_API_KEY = import.meta.env.VITE_API_KEY || '';
const QUICK_API_MODEL = import.meta.env.VITE_API_MODEL || 'ecnu-max';
const QUICK_ENDPOINT = '/api/chat/chat/completions';

// ===== 智能体模式配置 (Coze Bot) =====
const COZE_API_TOKEN = import.meta.env.VITE_COZE_API_TOKEN || '';
const COZE_BOT_ID = import.meta.env.VITE_COZE_BOT_ID || '7651237086146183209';
const COZE_ENDPOINT = '/api/coze/v3/chat';

const FALLBACK_REPLY = '噗噜噜…乌萨奇吃掉了烦恼！呀哈！你超棒的，继续加油！';

// ===== 模式管理 =====
const MODE_KEY = 'usagi_api_mode';
const MODE_QUICK = 'quick';     // 快速问答（无记忆）
const MODE_BOT = 'bot';         // 智能体（有记忆）

/**
 * 获取当前模式
 * @returns {'quick'|'bot'} 默认 'quick'
 */
export function getMode() {
  try {
    var saved = localStorage.getItem(MODE_KEY);
    if (saved === MODE_BOT) return MODE_BOT;
  } catch (e) {}
  return MODE_QUICK;
}

/**
 * 设置模式
 * @param {'quick'|'bot'} mode
 */
export function setMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch (e) {}
  console.log('[UsagiAPI] 模式切换为:', mode === MODE_BOT ? '智能体（有记忆）' : '快速问答（无记忆）');
}

// ===== 智能体模式：多轮对话记忆 =====
const CONVERSATION_ID_KEY = 'usagi_coze_conversation_id';

function getConversationId() {
  try {
    return localStorage.getItem(CONVERSATION_ID_KEY) || null;
  } catch (e) {
    return null;
  }
}

function saveConversationId(id) {
  try {
    if (id) {
      localStorage.setItem(CONVERSATION_ID_KEY, id);
    }
  } catch (e) {}
}

/**
 * 清除智能体对话记忆（仅清除 conversation_id，不影响模式设置）
 */
export function resetConversation() {
  try {
    localStorage.removeItem(CONVERSATION_ID_KEY);
  } catch (e) {}
  console.log('[UsagiAPI] 智能体记忆已重置');
}

// ===== 统一入口 =====

/**
 * 根据当前模式调用对应 API 获取乌萨奇回复
 * @param {string} worryText — 用户倾诉的烦恼文本
 * @returns {Promise<string>} — 乌萨奇的回复文本
 */
export async function getUsagiReply(worryText) {
  var mode = getMode();
  if (mode === MODE_BOT) {
    return getUsagiReplyBot(worryText);
  } else {
    return getUsagiReplyQuick(worryText);
  }
}

// ===== 快速问答模式 (ECNU OpenAI) =====

async function getUsagiReplyQuick(worryText) {
  if (!QUICK_API_KEY) {
    console.warn('[UsagiAPI/Quick] Missing API key, falling back');
    return FALLBACK_REPLY;
  }

  try {
    const response = await fetch(QUICK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + QUICK_API_KEY,
      },
      body: JSON.stringify({
        model: QUICK_API_MODEL,
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
      console.error('[UsagiAPI/Quick] API error:', response.status, errText);
      throw new Error('API returned ' + response.status);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[UsagiAPI/Quick] Unexpected response format:', data);
      throw new Error('Empty response content');
    }

    console.log('[UsagiAPI/Quick] Reply:', content.slice(0, 60) + '...');
    return content.trim();
  } catch (err) {
    console.error('[UsagiAPI/Quick] Request failed:', err);
    return FALLBACK_REPLY;
  }
}

// ===== 智能体模式 (Coze Bot v3/chat stream) =====

async function getUsagiReplyBot(worryText) {
  if (!COZE_API_TOKEN) {
    console.warn('[UsagiAPI/Bot] Missing Coze API token, falling back');
    return FALLBACK_REPLY;
  }

  var conversationId = getConversationId();

  try {
    var requestBody = {
      bot_id: COZE_BOT_ID,
      user_id: 'usagi-praise-user',
      stream: true,
      auto_save_history: true,
      additional_messages: [
        {
          role: 'user',
          content: worryText,
          content_type: 'text',
        },
      ],
    };

    if (conversationId) {
      requestBody.conversation_id = conversationId;
      console.log('[UsagiAPI/Bot] 续聊 conversation:', conversationId);
    } else {
      console.log('[UsagiAPI/Bot] 新对话（无历史记忆）');
    }

    const response = await fetch(COZE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + COZE_API_TOKEN,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[UsagiAPI/Bot] API error:', response.status, errText);
      throw new Error('API returned ' + response.status);
    }

    const result = await parseBotSSEStream(response);

    if (result.conversationId) {
      saveConversationId(result.conversationId);
      console.log('[UsagiAPI/Bot] 保存 conversation_id:', result.conversationId);
    }

    if (!result.text) {
      console.error('[UsagiAPI/Bot] Empty response');
      throw new Error('Empty bot response');
    }

    console.log('[UsagiAPI/Bot] Reply:', result.text.slice(0, 60) + '...');
    return result.text.trim();
  } catch (err) {
    console.error('[UsagiAPI/Bot] Request failed:', err);
    return FALLBACK_REPLY;
  }
}

// ===== Coze Bot SSE 解析 =====

async function parseBotSSEStream(response) {
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  var result = '';
  var conversationId = null;
  var currentEvent = '';

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;

    buffer += decoder.decode(chunk.value, { stream: true });

    var parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (var i = 0; i < parts.length; i++) {
      var eventBlock = parts[i];
      var lines = eventBlock.split('\n');
      currentEvent = '';

      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];

        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          var jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            var data = JSON.parse(jsonStr);

            if (currentEvent === 'error' || (data.error_code)) {
              console.error('[UsagiAPI/Bot] SSE error:', data);
              throw new Error(data.error_message || data.msg || 'Bot chat error');
            }

            if (currentEvent === 'conversation.chat.created' && data.id) {
              conversationId = data.id;
            }

            if (currentEvent === 'conversation.message.delta') {
              if (data.type === 'answer' && data.content) {
                result += data.content;
              }
            }

            if (currentEvent === 'conversation.message.completed') {
              if (data.type === 'answer' && data.content && !result) {
                result = data.content;
              }
            }
          } catch (e) {
            if (e.message && (e.message.indexOf('error') >= 0 || e.message.indexOf('Error') >= 0)) {
              throw e;
            }
          }
        }
      }
    }
  }

  return { text: result, conversationId: conversationId };
}
