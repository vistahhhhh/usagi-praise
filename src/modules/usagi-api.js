/**
 * usagi-api.js — 调用 Coze 智能体(Bot)流式对话获取乌萨奇风格回复
 *
 * 使用 Coze v3/chat stream API（SSE 流式）
 * 人格/提示词已在 Coze 智能体内配置，前端无需传 system prompt
 *
 * 支持多轮对话记忆：自动提取并缓存 conversation_id，
 * 同一浏览器会话内乌萨奇能记住之前的对话内容
 *
 * 开发环境：走 Vite 代理 /api/coze → 避免 CORS
 * 生产环境：走 Vercel rewrites /api/coze → 同样避免 CORS
 */

const COZE_API_TOKEN = import.meta.env.VITE_COZE_API_TOKEN || '';
const COZE_BOT_ID = import.meta.env.VITE_COZE_BOT_ID || '7651237086146183209';

// 开发环境(Vite proxy)和生产环境(Vercel rewrites)都走 /api/coze 代理路径
const COZE_ENDPOINT = '/api/coze/v3/chat';

const FALLBACK_REPLY = '噗噜噜…乌萨奇吃掉了烦恼！呀哈！你超棒的，继续加油！';

// ===== 多轮对话记忆 =====
// localStorage 持久化 key
const CONVERSATION_ID_KEY = 'usagi_coze_conversation_id';

/**
 * 获取缓存的 conversation_id
 * @returns {string|null}
 */
function getConversationId() {
  try {
    return localStorage.getItem(CONVERSATION_ID_KEY) || null;
  } catch (e) {
    return null;
  }
}

/**
 * 保存 conversation_id
 * @param {string} id
 */
function saveConversationId(id) {
  try {
    if (id) {
      localStorage.setItem(CONVERSATION_ID_KEY, id);
    }
  } catch (e) {
    // localStorage 不可用，忽略
  }
}

/**
 * 清除对话记忆（重置 conversation_id）
 * 调用后乌萨奇会忘记之前的所有对话
 */
export function resetConversation() {
  try {
    localStorage.removeItem(CONVERSATION_ID_KEY);
  } catch (e) {
    // ignore
  }
  console.log('[UsagiAPI] 对话记忆已重置，下次将开始新对话');
}

/**
 * 调用 Coze Bot 流式对话 API，收集完整回复文本
 * @param {string} worryText — 用户倾诉的烦恼文本
 * @returns {Promise<string>} — 乌萨奇的回复文本
 */
export async function getUsagiReply(worryText) {
  if (!COZE_API_TOKEN) {
    console.warn('[UsagiAPI] Missing Coze API token, falling back');
    return FALLBACK_REPLY;
  }

  // 读取缓存的 conversation_id（有则续聊，无则新对话）
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

    // 如果有 conversation_id，带上以实现多轮记忆
    if (conversationId) {
      requestBody.conversation_id = conversationId;
      console.log('[UsagiAPI] 续聊 conversation:', conversationId);
    } else {
      console.log('[UsagiAPI] 新对话（无历史记忆）');
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
      console.error('[UsagiAPI] Coze Bot API error:', response.status, errText);
      throw new Error('API returned ' + response.status);
    }

    // 解析 SSE 流，收集完整回复 + 提取 conversation_id
    const result = await parseBotSSEStream(response);

    // 保存 conversation_id 供下次使用
    if (result.conversationId) {
      saveConversationId(result.conversationId);
      console.log('[UsagiAPI] 保存 conversation_id:', result.conversationId);
    }

    if (!result.text) {
      console.error('[UsagiAPI] Empty response from bot');
      throw new Error('Empty bot response');
    }

    console.log('[UsagiAPI] Reply received:', result.text.slice(0, 60) + '...');
    return result.text.trim();
  } catch (err) {
    console.error('[UsagiAPI] Request failed:', err);
    return FALLBACK_REPLY;
  }
}

/**
 * 解析 Coze Bot Chat SSE 流
 *
 * Coze v3/chat stream 返回的 SSE 事件格式：
 *   event: conversation.chat.created
 *   data: {"id":"...","bot_id":"...","status":"created"}
 *
 *   event: conversation.message.delta
 *   data: {"content":"增量文本","type":"answer",...}
 *
 *   event: conversation.message.completed
 *   data: {"content":"完整文本","type":"answer",...}
 *
 *   event: conversation.chat.completed
 *   data: {"status":"completed","usage":{...}}
 *
 * 只拼接 type="answer" 的 delta 内容
 * 提取 conversation.chat.created 中的 id 作为 conversation_id
 *
 * @param {Response} response
 * @returns {Promise<{text: string, conversationId: string|null}>}
 */
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

    // 按双换行分割 SSE 事件块
    var parts = buffer.split('\n\n');
    // 最后一段可能不完整，留在 buffer 里
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

            // 错误事件
            if (currentEvent === 'error' || (data.error_code)) {
              console.error('[UsagiAPI] Coze bot error:', data);
              throw new Error(data.error_message || data.msg || 'Bot chat error');
            }

            // 提取 conversation_id（对话创建时返回）
            if (currentEvent === 'conversation.chat.created' && data.id) {
              conversationId = data.id;
              console.log('[UsagiAPI] Got conversation_id:', conversationId);
            }

            // 增量文本（流式输出核心）
            if (currentEvent === 'conversation.message.delta') {
              if (data.type === 'answer' && data.content) {
                result += data.content;
              }
            }

            // 消息完成（兜底：如果没收集到 delta，用完整消息）
            if (currentEvent === 'conversation.message.completed') {
              if (data.type === 'answer' && data.content && !result) {
                result = data.content;
              }
            }

            // 对话完成 — 正常结束
            // conversation.chat.completed: 不需要额外处理

          } catch (e) {
            if (e.message && (e.message.indexOf('error') >= 0 || e.message.indexOf('Error') >= 0)) {
              throw e;
            }
            // JSON 解析失败，跳过
          }
        }
      }
    }
  }

  return { text: result, conversationId: conversationId };
}
