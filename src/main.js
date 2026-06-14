/**
 * 夸夸乌萨奇 — 主入口 v5
 * 接入真实 LLM API，乌萨奇根据用户烦恼实时生成回复
 */

import { ParticleBackground } from './modules/particle-bg.js';
import { UsagiCharacter } from './modules/usagi-character.js';
import { Shredder } from './modules/shredder.js';
import { PraiseBubble } from './modules/praise-bubble.js';
import { EnergyWave } from './modules/energy-wave.js';
import { getUsagiReply } from './modules/usagi-api.js';

// ===== 初始化顺序 =====

// 1. 粒子背景（最底层）
const particleBg = new ParticleBackground('particle-canvas');

// 2. 乌萨奇角色（v4 行为引擎）
const usagi = new UsagiCharacter();

// 3. 能量波特效
const energyWave = new EnergyWave('energy-wave-container');

// 4. 夸夸气泡（显示时触发能量波）
const praiseBubble = new PraiseBubble('praise-container', (praiseType) => {
  energyWave.emitAtUsagi(usagi, praiseType);
});

// 4.5 让夸夸容器跟随乌萨奇位置
var praiseContainer = document.getElementById('praise-container');
function syncPraiseContainer() {
  var pos = usagi.getPosition();
  if (praiseContainer && pos) {
    // 用 bottom 定位：底边固定在乌萨奇耳朵上方，文字多时向上扩展
    var usagiTop = pos.y - pos.height / 2;
    var gap = 50; // 气泡底边距离乌萨奇头顶的间距
    praiseContainer.style.position = 'absolute';
    praiseContainer.style.left = (pos.x - 150) + 'px';
    praiseContainer.style.top = '';
    praiseContainer.style.bottom = (window.innerHeight - usagiTop + gap) + 'px';
  }
}

// 5. 烦恼粉碎机（粉碎完成回调 → 触发乌萨奇吃烦恼 + 调用API获取回复）
const shredder = new Shredder({
  usagi: usagi,
  onShredded: function(originalText) {
    // 注意: playEat() 由 Shredder 内部在 Step 5 调用
    // 这里在吃烦恼动画完成后：显示气泡 + 异步获取API回复
    setTimeout(function() {
      syncPraiseContainer();

      // ★ 调用真实 API 获取乌萨奇回复
      var replyPromise = getUsagiReply(originalText);

      // 气泡先显示"噗噜噜…"思考中，API返回后自动替换为真实文本
      praiseBubble.showAsync(replyPromise);

      // ★ API 返回后保存到历史记录
      replyPromise.then(function(replyText) {
        addHistory(originalText, replyText);
      });
    }, 2200); // 等待吃烦恼动画完成(约2.2s)
  },
});

// ===== v4 偷看系统（已禁用）=====

// ===== v4 新增：吃完成自定义事件 → 夸夸气泡 =====

document.addEventListener('usagiEatComplete', function(e) {
  console.log('[Main] Received usagiEatComplete event, showing praise bubble');
  syncPraiseContainer();

  var worryText = (e.detail && e.detail.worry) ? e.detail.worry : '';
  if (worryText) {
    var replyPromise = getUsagiReply(worryText);
    praiseBubble.showAsync(replyPromise);
    replyPromise.then(function(replyText) {
      addHistory(worryText, replyText);
    });
  }
});

// 6. 窗口缩放时让乌萨奇保持在屏幕内
window.addEventListener('resize', function() {
  if (usagi.handleResize) {
    usagi.handleResize();
  }
});

// ===== 输入框折叠/展开 =====

var shredderDock = document.getElementById('shredder-dock');
var shredderTrigger = document.getElementById('shredder-trigger');

if (shredderTrigger && shredderDock) {
  shredderTrigger.addEventListener('click', function() {
    shredderDock.classList.toggle('open');
    // 展开后自动聚焦输入框
    if (shredderDock.classList.contains('open')) {
      setTimeout(function() {
        var input = document.getElementById('worry-input');
        if (input) input.focus();
      }, 350); // 等展开动画完成
    }
  });
}

// 点击页面其他地方收起（可选）
document.addEventListener('click', function(e) {
  if (shredderDock && shredderDock.classList.contains('open')) {
    // 如果点击不在 dock 内，收起
    if (!shredderDock.contains(e.target)) {
      shredderDock.classList.remove('open');
    }
  }
});

// ===== 控制台欢迎信息 =====
console.log(
  '%c🐰 乌萨奇赛博狡兔窟 %cv5 真实对话引擎已启动！',
  'color: #FF9F43; font-size: 18px; font-weight: bold;',
  'color: #6DD5FA; font-size: 14px;'
);
console.log('接入 LLM API | 乌萨奇会根据你的烦恼实时回复');

// ===== 侧边栏：历史记录 =====

var HISTORY_KEY = 'usagi_praise_history';
var sidebarEl = document.getElementById('history-sidebar');
var sidebarToggle = document.getElementById('sidebar-toggle');
var sidebarClose = document.getElementById('sidebar-close');
var historyList = document.getElementById('history-list');
var clearHistoryBtn = document.getElementById('clear-history');

// 读取 localStorage
function getHistory() {
  try {
    var data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

// 保存 localStorage
function saveHistory(items) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch (e) {
    // storage full, trim oldest
    items = items.slice(-50);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch(e2) {}
  }
}

// 添加一条记录
function addHistory(worry, praiseText) {
  if (!worry || !praiseText) return;
  var items = getHistory();
  items.push({
    worry: worry,
    praise: praiseText,
    time: new Date().toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  });
  // 最多保留 100 条
  if (items.length > 100) items = items.slice(-100);
  saveHistory(items);
  renderHistory();
}

// 渲染列表
function renderHistory() {
  var items = getHistory();
  if (items.length === 0) {
    historyList.innerHTML = '<div class="history-empty">还没有记录哦～<br>写下烦恼让乌萨奇吃掉吧！🐰</div>';
    return;
  }
  var html = '';
  // 最新的在最上面
  for (var i = items.length - 1; i >= 0; i--) {
    var item = items[i];
    html += '<div class="history-item">' +
      '<div class="history-item-time">' + escapeHtml(item.time) + '</div>' +
      '<div class="history-item-worry">💭 ' + escapeHtml(item.worry) + '</div>' +
      '<div class="history-item-praise">🐰 ' + escapeHtml(item.praise) + '</div>' +
    '</div>';
  }
  historyList.innerHTML = html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 侧边栏开关
if (sidebarToggle && sidebarEl) {
  sidebarToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    sidebarEl.classList.add('open');
    renderHistory();
  });
}

if (sidebarClose && sidebarEl) {
  sidebarClose.addEventListener('click', function(e) {
    e.stopPropagation();
    sidebarEl.classList.remove('open');
  });
}

// 清空记录
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', function() {
    if (confirm('确定清空所有历史记录吗？')) {
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
    }
  });
}

// 点击侧边栏外部关闭
document.addEventListener('click', function(e) {
  if (sidebarEl && sidebarEl.classList.contains('open')) {
    if (!sidebarEl.contains(e.target) && e.target !== sidebarToggle) {
      sidebarEl.classList.remove('open');
    }
  }
});

// 初始加载历史
renderHistory();
