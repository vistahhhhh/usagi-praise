/**
 * 乌萨奇角色引擎 — v5 完全重写版
 *
 * v5 核心改进（相对于 v4）：
 * 1. GSAP ONLY — 所有动画由 GSAP 驱动，不存在 rAF 泄漏问题
 * 2. 单一定位 — 只用 left + top 绝对定位，不用 bottom 锚点
 * 3. 有限状态机 — IDLE/WALKING/SITTING/CLIMBING/FALLING/INTERACTING/DRAGGED
 * 4. 正确朝向 — 原始精灵图[1]脸朝左，facingRight→scaleX(-1)翻转朝右
 *
 * 基于 Shimeji 原始动作编排（Actions.xml + Behaviors.xml）改编
 */

import gsap from 'gsap';

// ============================================================
//  SECTION 0: 配置常量（从 v4 搬运，数据不变）
// ============================================================

/** 帧分组配置 */
var SPRITE_GROUPS = {
  stand:       [1],
  sit:         [11],
  sprawl:      [21],
  walk:        [1, 2, 1, 3],
  haPrepare:   [26],
  haBurst:     [27],
  haEnd:       [28],
  haExtra:     [29],
  eatAlert:    [5],
  eatCharge:   [26],
  eatBite:     [27],
  eatChew:     [15, 16, 17],
  eatSatisfy:  [28],
  eatSavor:    [5],
  sitLegsUp:   [30],
  dangleLegs:  [31, 32, 31, 33],
  lookUp:      [26],
  creepReady:  [20],
  creepMove:   [21],
  grabWall:    [13],
  climb1:      [14],
  climb2:      [12],
  climb3:      [13],
  grabCeiling: [23],
  ceilingPrep: [25],
  ceilingMove: [24],
  ceilingAlt:  [23],
  falling:     [4],
  bounceA:     [18],
  bounceB:     [19],
  tripping:    [22],
  dragLeftHard:  [9],
  dragLeftSoft:  [5],
  dragRightSoft: [6],
  dragRightHard: [10],
  dragFloatL:    [7],
  dragFloatR:    [8],
  wiggle:        [15, 16, 17]
};

/** 五条 Rail 的 Y 轴划分（纯数据，不含 CSS 锚点）
 * ★ v5 fix: Rail 0（天花板）已禁用，乌萨奇不会爬到天花板或倒挂
 * 实际活动范围：Rail 1~4（高空/中层/低空/地板） */
var RAILS = [
  { id: 0, name: 'ceiling', yMinPct: 0,    yMaxPct: 0.12 }, // ★ 已禁用
  { id: 1, name: 'high',    yMinPct: 0.12, yMaxPct: 0.35 },
  { id: 2, name: 'mid',     yMinPct: 0.35, yMaxPct: 0.55 },
  { id: 3, name: 'low',     yMinPct: 0.55, yMaxPct: 0.80 },
  { id: 4, name: 'floor',   yMinPct: 0.80, yMaxPct: 1.0  }
];

/** ★ 活动范围的 Rail 下限（禁用天花板 = Rail 0）*/
var MIN_ACTIVE_RAIL = 1;

/** ★ 底部输入框保留区域（像素）— 乌萨奇不会进入这个区域 */
var DOCK_RESERVE_PX = 110;

/** 移动速度 (px/s) */
var SPEED = {
  walk: 80,
  run:  160,
  dash: 300
};

/** 帧切换间隔 (ms) */
var FRAME_DURATION = {
  walk: 140,
  run:  90,
  dash: 60,
  climb: 350,
  wiggle: 200
};

/** 音效映射 */
var SOUND_MAP = {
  start:  { file: '/assets/sounds/start.wav',  volume: 0.5 },
  ha:     { file: '/assets/sounds/5.wav',     volume: 1.0 },
  double: { file: '/assets/sounds/double.wav', volume: 0.8 },
  sit:    { file: '/assets/sounds/sit.wav',    volume: 0.7 }
};

/** 行为池定义（名称 → 权重值）*/
var BEHAVIOR_POOLS = {
  idle:    { StandUp: 30, SitDown: 15, LieDown: 3 },
  walk:    { WalkAndSit: 40, WalkAndGrab: 20, Creep: 10, StartleJump: 5 },
  wall:    { GrabWall: 20, ClimbUp: 15, ClimbDown: 10, FallOff: 8 }
};


// ============================================================
//  SECTION 1: 工具函数（纯函数，无副作用）
// ============================================================

/** 获取 Rail 中心 Y 坐标（像素）— 扣除底部 DOCK 保留区域 */
function getRailCenterY(railId) {
  var rail = RAILS[railId];
  if (!rail) return window.innerHeight - DOCK_RESERVE_PX - 64;
  var effectiveH = window.innerHeight - DOCK_RESERVE_PX;
  return effectiveH * (rail.yMinPct + rail.yMaxPct) / 2;
}

/** 根据 Y 像素判断属于哪条 Rail — 扣除底部 DOCK 保留区域 */
function getRailFromY(yPx) {
  var effectiveH = window.innerHeight - DOCK_RESERVE_PX;
  var pct = yPx / effectiveH;
  for (var i = 0; i < RAILS.length; i++) {
    if (pct >= RAILS[i].yMinPct && pct < RAILS[i].yMaxPct) return i;
  }
  return 4; // 默认地板
}

/** 加权随机选择 */
function selectBehavior(poolObj) {
  var entries = [];
  var totalWeight = 0;
  for (var key in poolObj) {
    if (poolObj.hasOwnProperty(key)) {
      entries.push({ name: key, weight: poolObj[key] });
      totalWeight += poolObj[key];
    }
  }
  var r = Math.random() * totalWeight;
  var cumulative = 0;
  for (var j = 0; j < entries.length; j++) {
    cumulative += entries[j].weight;
    if (r <= cumulative) return entries[j].name;
  }
  return entries[entries.length - 1].name;
}

/** 钳位坐标到屏幕内 — allowDock=true 时允许进入底部 dock 区域（拖拽用） */
function clampToScreen(x, y, spriteW, spriteH, allowDock) {
  var sw = spriteW || 128;
  var sh = spriteH || 128;
  var maxY = allowDock ? window.innerHeight - sh : window.innerHeight - sh - DOCK_RESERVE_PX;
  return {
    x: Math.max(0, Math.min(window.innerWidth - sw, x)),
    y: Math.max(0, Math.min(maxY, y))
  };
}


// ============================================================
//  SECTION 2: UsagiCharacter 类 — v5 引擎
// ============================================================

/** 状态枚举 */
var ST = {
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  SITTING: 'SITTING',
  CLIMBING: 'CLIMBING',
  FALLING: 'FALLING',
  INTERACTING: 'INTERACTING',
  DRAGGED: 'DRAGGED'
};

export function UsagiCharacter() {

  // ---- DOM 引用 ----
  this.spriteEl = document.getElementById('usagi-character');
  this.imgEl = document.getElementById('usagi-sprite');
  if (!this.spriteEl || !this.imgEl) {
    console.error('[Usagi-v5] 找不到 #usagi-character 或 #usagi-sprite');
    return;
  }

  // ---- 内部状态 ----
  this.x = 0;
  this.y = 0;
  this.currentRail = 4;         // 当前所在 Rail
  this.facingRight = false;     // false=脸朝左(原始方向), true=脸朝右(翻转)
  this.state = ST.IDLE;         // 状态机当前状态

  // 行为引擎状态
  this.behaviorTimer = null;    // setTimeout ID（用于 _scheduleBehavior）
  this.lastBehaviorType = null; // 上一个行为类型
  this.tickCount = 0;           // 行为引擎 tick 计数

  // ---- 动画追踪（全部是 GSAP tween / timer，可干净取消）----
  this.tweens = [];             // 所有活动中的 GSAP tween
  this._pendingTimers = [];     // 所有通过 _delay 创建的 setTimeout ID

  // ---- 拖拽状态 ----
  this.isDragging = false;
  this.dragStartX = 0;
  this.dragStartY = 0;
  this.dragOffsetX = 0;         // 鼠标点击点到元素左上角的偏移
  this.dragOffsetY = 0;
  this.dragUsagiStartX = 0;
  this.dragUsagiStartY = 0;
  this.lastDragX = 0;
  this.lastDragY = 0;
  this.lastDragTime = 0;
  this.dragVelocityX = 0;
  this.dragVelocityY = 0;

  // ---- 音效缓存 ----
  this.audioCache = {};
  this.audioUnlocked = false;  // ★ 是否已解锁浏览器音频策略

  // ---- 交互锁 ----
  this.isInteracting = false;

  // ---- 双击检测 ----
  this._lastClickTime = 0;
  this._DOUBLE_CLICK_GAP = 450; // ms 内两次点击算双击

  // ---- 拖拽延迟启动（★ 修复: 不在 mousedown 立即拖拽）----
  this._dragPending = false;
  this._dragStartX = 0;
  this._dragStartY = 0;

  // ---- 偷看输入框相关 ----
  this.peekInputEl = null;
  this.peekState = null;        // null | 'approaching' | 'watching' | 'bored'

  // ===== 初始化 =====
  this._preloadSounds();
  this._setInitialPosition();
  this._bindEvents();
  this.setFrame(1);
  this._applyFacing();
  this._syncDOM();

  // 启动行为引擎
  var self = this;
  this._delay(1000, function() {
    self._executeBehavior();
  });
}

// ============================================================
//  SECTION 3: 核心方法 — DOM 同步、状态管理、动画控制
// ============================================================

/**
 * ★ 唯一的 DOM 位置写入方法
 * 始终使用 left + top 绝对定位，永不使用 bottom/right 锚点
 */
UsagiCharacter.prototype._syncDOM = function() {
  this.spriteEl.style.left = this.x + 'px';
  this.spriteEl.style.top = this.y + 'px';
};

/** 设置初始位置（屏幕中下方，Rail 4 地板区域）*/
UsagiCharacter.prototype._setInitialPosition = function() {
  var sw = this.imgEl.width || 128;
  var sh = this.imgEl.height || 128;
  // 页面正中间
  this.x = (window.innerWidth - sw) / 2;
  this.y = (window.innerHeight - sh) / 2;
  this.currentRail = getRailFromY(this.y);
};

/** 应用朝向到 imgEl
 * ★ v5 修正：原始精灵图[1]脸朝左
 *   facingRight=false(要朝左) → scaleX(1) 不翻转 ✅
 *   facingRight=true(要朝右) → scaleX(-1) 翻转 ✅
 * ★ v5 fix: 移除天花板倒挂（Rail 0 已禁用）
 */
UsagiCharacter.prototype._applyFacing = function() {
  this.imgEl.style.transform = this.facingRight ? 'scaleX(-1)' : 'scaleX(1)';
};

// ---- 状态管理 ----

/** ★ v5 fix: 确保行为切换时帧状态干净 — 每个行为入口调用 */
UsagiCharacter.prototype._ensureCleanState = function() {
  // ★★★ 关键修复：必须杀掉所有 GSAP tween（不仅是帧循环！）
  // 否则旧行为的位移 tween 还在跑，和新行为打架 → 左右滑动+闪烁
  for (var i = this.tweens.length - 1; i >= 0; i--) {
    if (this.tweens[i]) this.tweens[i].kill();
  }
  this.tweens = [];

  // 清除所有 _delay 创建的定时器
  for (var j = this._pendingTimers.length - 1; j >= 0; j--) {
    clearTimeout(this._pendingTimers[j]);
  }
  this._pendingTimers = [];

  // 停止帧循环指针
  this._frameTl = null;
  // 停止任何残留的独立帧循环（wiggle / chew）
  if (this._extraFrameLoop) {
    clearTimeout(this._extraFrameLoop);
    this._extraFrameLoop = null;
  }
};

/** 设置新状态（自动取消旧动画 + 清理帧状态）*/
UsagiCharacter.prototype._setState = function(newState) {
  console.log('[Usagi-v5] State:', this.state, '→', newState);
  this.state = newState;
};

/** 取消所有进行中的动画和定时器 */
UsagiCharacter.prototype._cancelAll = function() {
  // 1. 清除所有 GSAP tweens
  for (var i = this.tweens.length - 1; i >= 0; i--) {
    if (this.tweens[i]) this.tweens[i].kill();
  }
  this.tweens = [];

  // 2. 清除行为定时器
  if (this.behaviorTimer) {
    clearTimeout(this.behaviorTimer);
    this.behaviorTimer = null;
  }

  // 3. 清除所有 _delay 创建的定时器
  for (var j = this._pendingTimers.length - 1; j >= 0; j--) {
    clearTimeout(this._pendingTimers[j]);
  }
  this._pendingTimers = [];
};

/** 追踪 GSAP tween（以便统一取消）*/
UsagiCharacter.prototype._addTween = function(tween) {
  if (tween) this.tweens.push(tween);
};

/**
 * 可取消的延迟执行（用 setTimeout）
 * @returns {number} timer ID（可被 clearTimeout 取消）
 */
UsagiCharacter.prototype._delay = function(ms, callback) {
  var self = this;
  var id = setTimeout(function() {
    // 执行后从列表移除
    var idx = self._pendingTimers.indexOf(id);
    if (idx >= 0) self._pendingTimers.splice(idx, 1);
    callback.call(self);
  }, ms);
  this._pendingTimers.push(id);
  return id;
};

// ---- 交互锁管理 ----

UsagiCharacter.prototype._startInteraction = function(type) {
  this.isInteracting = true;
  this._ensureCleanState();  // ★ 交互开始时也清理残留帧
  this._setState(ST.INTERACTING);
  this._cancelAll(); // 取消当前行为/移动
  // ★ 重置 imgEl 的残留变换（scale/rotation），防止 HA! 等动画的残留影响新动画
  gsap.set(this.imgEl, { scaleX: 1, scaleY: 1, rotation: 0 });
  console.log('[Usagi-v5] Interaction START:', type);
};

UsagiCharacter.prototype._endInteraction = function(type) {
  this.isInteracting = false;
  this._setState(ST.IDLE);
  console.log('[Usagi-v5] Interaction END:', type);

  // 恢复行为引擎（给喘息时间）
  var self = this;
  var pauseMs = type === 'drag' ? 200 + Math.random() * 300 :   // 拖拽后：0.2~0.5s
                type === 'eat'  ? 500 + Math.random() * 500 :
                type === 'squish' ? 300 + Math.random() * 300 :
                                   400 + Math.random() * 500;
  this._scheduleBehavior(pauseMs);
};

/** 安排下一个行为（带延迟）*/
UsagiCharacter.prototype._scheduleBehavior = function(delayMs) {
  var self = this;
  delayMs = delayMs || 1000;

  this.behaviorTimer = this._delay(delayMs, function() {
    // 如果正在交互中，延后重试
    if (self.isInteracting) {
      self._scheduleBehavior(500);
      return;
    }
    self._executeBehavior();
  });
};

// ============================================================
//  SECTION 4: 公开 API（保持 v4 兼容）
// ============================================================

/** 获取当前位置（被 main.js / shredder.js / energy-wave.js 使用）*/
UsagiCharacter.prototype.getPosition = function() {
  var rect = this.spriteEl.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height
  };
};

/** 切换精灵图帧 */
UsagiCharacter.prototype.setFrame = function(n) {
  if (n < 1 || n > 46) return;
  this.imgEl.src = '/assets/usagi/shime' + n + '.png';
};

/** 播放音效（★ v5 fix: 增强鲁棒性 + AudioContext 解锁）*/
UsagiCharacter.prototype.playSound = function(name, opts) {
  opts = opts || {};
  var cfg = SOUND_MAP[name];
  if (!cfg) {
    console.warn('[Usagi-v5] Unknown sound:', name);
    return;
  }

  var audio = this.audioCache[name];
  if (!audio) {
    console.warn('[Usagi-v5] Sound not loaded:', name);
    return;
  }

  // ★ 首次播放时尝试解锁浏览器音频策略
  if (!this.audioUnlocked) {
    this._unlockAudio();
    this.audioUnlocked = true;
  }

  audio.volume = (opts.volume != null) ? opts.volume : cfg.volume;
  audio.currentTime = 0;

  if (!opts.override && !audio.ended && audio.currentTime > 0) {
    return; // 已在播放且不强制覆盖
  }

  // ★ 使用 play() 并处理 Promise rejection（浏览器可能阻止）
  var playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.catch(function(err) {
      console.warn('[Usagi-v5] Audio play blocked:', err.name, '-', err.message);
      // 尝试重新创建 Audio 元素
      try {
        var freshAudio = new Audio(cfg.file);
        freshAudio.volume = audio.volume;
        freshAudio.play().catch(function() {});
      } catch(e) { /* ignore */ }
    });
  }
};

/** 窗口缩放处理 */
UsagiCharacter.prototype.handleResize = function() {
  var sw = this.imgEl.width || 128;
  var sh = this.imgEl.height || 128;
  var clamped = clampToScreen(this.x, this.y, sw, sh);
  this.x = clamped.x;
  this.y = clamped.y;
  this._syncDOM();
  // 更新 Rail
  this.currentRail = getRailFromY(this.y + sh / 2);
};

/** 播放连续帧序列（公开 API）*/
UsagiCharacter.prototype.playFrameSequence = function(frames, durationPerFrame, onComplete) {
  var self = this;
  var idx = 0;
  function next() {
    if (idx >= frames.length) {
      if (onComplete) onComplete();
      return;
    }
    self.setFrame(frames[idx]);
    idx++;
    var timerId = self._delay(durationPerFrame, next);
    self._addTween({ kill: function() { clearTimeout(timerId); } }); // 包装成可 kill 对象
  }
  next();
  return true;
};


// ============================================================
//  SECTION 5: 行为引擎核心（状态机驱动）
// ============================================================

/**
 * 执行一个行为 — 加权随机选择 + 上下文感知
 */
UsagiCharacter.prototype._executeBehavior = function() {
  this.tickCount++;

  var lastType = this.lastBehaviorType;
  var forceActive = this.tickCount <= 3; // 前3次强制走动

  var behaviorName;

  // ---- 上下文感知选择 ----
  if (!forceActive) {
    if (lastType === 'climb' || lastType === 'fall' || lastType === 'wall') {
      // 攀爬/掉落后：优先恢复站立，不会突然撅屁股
      var r = Math.random();
      if (r < 0.6)      behaviorName = 'StandUp';
      else if (r < 0.85) behaviorName = this._selectWalkBehavior();
      else               behaviorName = 'SitDown';
    } else if (lastType === 'sit') {
      // 坐下后：大概率走动或继续待机
      var rs = Math.random();
      if (rs < 0.5)     behaviorName = this._selectWalkBehavior();
      else if (rs < 0.8) behaviorName = 'StandUp';
      else              behaviorName = 'LieDown'; // 偶尔躺平
    } else {
      // 默认：从完整池中选择
      behaviorName = this._pickRandomBehavior();
    }
  } else {
    // 强制活跃期：只选走动类
    behaviorName = this._selectWalkBehavior();
  }

  console.log('[Usagi-v5] Behavior #' + this.tickCount + ':', behaviorName,
    '(last:', lastType, ', force:', forceActive, ')');

  this.currentBehavior = behaviorName;
  this._dispatchBehavior(behaviorName);
};

/** 从走动池中选择一个行为 */
UsagiCharacter.prototype._selectWalkBehavior = function() {
  var pool = BEHAVIOR_POOLS.walk;
  var choices = [];
  var total = 0;
  for (var k in pool) {
    if (pool.hasOwnProperty(k)) {
      choices.push(k);
      total += pool[k];
    }
  }
  var rv = Math.random() * total;
  var cum = 0;
  for (var j = 0; j < choices.length; j++) {
    cum += pool[choices[j]];
    if (rv <= cum) return choices[j];
  }
  return choices[0];
};

/** 完全随机选择（综合池）*/
UsagiCharacter.prototype._pickRandomBehavior = function() {
  // 合并所有池
  var combined = {};
  for (var poolName in BEHAVIOR_POOLS) {
    if (BEHAVIOR_POOLS.hasOwnProperty(poolName)) {
      var p = BEHAVIOR_POOLS[poolName];
      for (var key in p) {
        if (p.hasOwnProperty(key)) {
          combined[key] = (combined[key] || 0) + p[key];
        }
      }
    }
  }
  return selectBehavior(combined);
};

/** 分发行为到具体实现方法 */
UsagiCharacter.prototype._dispatchBehavior = function(name) {
  switch (name) {
    case 'StandUp':      this._doStandIdle(); break;
    case 'SitDown':      this._doSitDown(); break;
    case 'LieDown':      this._doLieDown(); break;
    case 'WalkAndSit':   this._doWalkAndSit(); break;
    case 'WalkAndGrab':  this._doWalkAndGrab(); break;
    case 'Creep':        this._doCreep(); break;
    case 'StartleJump':  this._doStartleJump(); break;
    case 'GrabWall':     this._doGrabWall(); break;
    case 'ClimbUp':      this._doClimbUp(); break;
    case 'ClimbDown':    this._doClimbDown(); break;
    case 'FallOff':      this._doFallOff(); break;
    default:             this._doStandIdle(); break;
  }
};

/** 行为完成回调 — 记录类型 + 安排下一个行为 */
UsagiCharacter.prototype._onBehaviorComplete = function(behType) {
  if (behType) {
    this.lastBehaviorType = behType;
  }
  this._setState(ST.IDLE);

  // 根据上一个行为类型决定喘息时长
  var pauseMs = this._getContextPause(behType);
  this._scheduleBehavior(pauseMs);
};

/** 根据行为类型返回合理的喘息时间 */
UsagiCharacter.prototype._getContextPause = function(lastType) {
  switch (lastType) {
    case 'climb': return 800  + Math.random() * 1000;  // 0.8~1.8s
    case 'fall':  return 600  + Math.random() * 800;   // 0.6~1.4s
    case 'wall':  return 500  + Math.random() * 600;   // 0.5~1.1s
    case 'walk':  return 400  + Math.random() * 500;   // 0.4~0.9s
    case 'sit':   return 400  + Math.random() * 600;   // 0.4~1.0s
    case 'idle':  return 400  + Math.random() * 500;   // 0.4~0.9s
    default:      return 500  + Math.random() * 800;   // 0.5~1.3s
  }
};


// ============================================================
//  SECTION 6: 基础行为（Rail 内）
// ============================================================

/** 站立发呆 */
UsagiCharacter.prototype._doStandIdle = function() {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this._setState(ST.IDLE);
  this.setFrame(1);
  this._applyFacing();

  var duration = 1500 + Math.random() * 2500; // 1.5~4秒

  // 轻微呼吸感：微小的 Y 轴浮动
  var baseY = this.y;
  var breatheTween = gsap.to(this, {
    y: baseY - 3,
    duration: 1.2,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: Math.floor(duration / 2400),
    onUpdate: function() { self._syncDOM(); }
  });
  this._addTween(breatheTween);

  // 定时结束
  var endTimer = this._delay(duration, function() {
    self.y = baseY; // 回到原位
    self._syncDOM();
    self._onBehaviorComplete('idle');
  });
  // 包装成可 kill 的对象
  this._addTween({ kill: function() { clearTimeout(endTimer); } });
};

/** 坐下 */
UsagiCharacter.prototype._doSitDown = function() {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this._setState(ST.SITTING);

  // 先坐下 [11]
  this.setFrame(11);

  var sitDuration = 1500 + Math.random() * 2500; // 1.5~4秒

  // 坐下后 50% 概率晃腿
  var endTimer = this._delay(sitDuration, function() {
    if (Math.random() > 0.5) {
      self._doDangleLegs();
    } else {
      self._onBehaviorComplete('sit');
    }
  });
  this._addTween({ kill: function() { clearTimeout(endTimer); } });
};

/** 坐着晃腿 */
UsagiCharacter.prototype._doDangleLegs = function() {
  var self = this;
  var frames = SPRITE_GROUPS.dangleLegs; // [31,32,31,33]
  var idx = 0;
  var cycles = 2 + Math.floor(Math.random() * 3); // 2~4轮
  var totalFrames = cycles * frames.length;

  function nextFrame() {
    if (idx >= totalFrames) {
      self.setFrame(1); // 站起来
      self._applyFacing();
      self._onBehaviorComplete('sit');
      return;
    }
    self.setFrame(frames[idx % frames.length]);
    idx++;
    var tId = self._delay(FRAME_DURATION.wiggle, nextFrame);
    self._addTween({ kill: function() { clearTimeout(tId); } });
  }
  nextFrame();
};

/** 躺平 */
UsagiCharacter.prototype._doLieDown = function() {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this.setFrame(SPRITE_GROUPS.sprawl[0]); // [21]

  var duration = 3000 + Math.random() * 3000; // 3~6秒

  var endTimer = this._delay(duration, function() {
    self.setFrame(1);
    self._onBehaviorComplete('idle');
  });
  this._addTween({ kill: function() { clearTimeout(endTimer); } });
};


// ============================================================
//  SECTION 7: 移动系统（★ 核心：GSAP 驱动，无 rAF）
// ============================================================

/**
 * ★★★ 核心移动原语 — 水平行走
 * 使用 GSAP 驱动位移，GSAP timeline 驱动帧切换
 * 两套动画独立运行、统一取消
 *
 * @param {'left'|'right'} direction 方向
 * @param {number} distancePx 移动距离（像素）。负数=自动计算到边缘
 * @param {'walk'|'run'|'dash'} speedType 速度档
 * @param {function} onComplete 完成回调
 */
UsagiCharacter.prototype._walk = function(direction, distancePx, speedType, onComplete) {
  var self = this;
  this._ensureCleanState();  // ★ 清理残留帧循环，重置到站立帧
  this._setState(ST.WALKING);

  var speed = SPEED[speedType];           // px/s
  var frames = SPRITE_GROUPS.walk;        // [1,2,1,3]
  var frameDur = FRAME_DURATION[speedType]; // ms per frame
  var sw = this.imgEl.width || 128;

  // 计算目标 X（钳位到屏幕内）
  var actualDist = distancePx;
  if (distancePx < 0) {
    // 自动走到边缘
    if (direction === 'right') {
      actualDist = (window.innerWidth - sw) - this.x - 10;
    } else {
      actualDist = this.x - 10;
    }
  }
  actualDist = Math.max(20, Math.abs(actualDist)); // 至少走20px
  var targetX = direction === 'right' ? this.x + actualDist : this.x - actualDist;
  targetX = Math.max(5, Math.min(window.innerWidth - sw - 5, targetX));

  var durationSec = actualDist / speed; // 秒

  // ★ 设置朝向
  this.facingRight = (direction === 'right');
  this._applyFacing();

  // ★ 立即设走路的第一个帧（避免 _ensureCleanState 清帧后到新 timeline 开始间的空档）
  this.setFrame(frames[0]); // [1]

  console.log('[Usagi-v5] WALK', direction, speedType,
    'dist=' + Math.round(actualDist) + 'px dur=' + durationSec.toFixed(1) + 's');

  // ---- 1. 位移 Tween (GSAP) ----
  var moveTween = gsap.to(this, {
    x: targetX,
    duration: durationSec,
    ease: 'none', // 匀速运动
    onUpdate: function() {
      self._syncDOM();
    },
    onComplete: function() {
      // 停止帧切换
      if (self._frameTl) { self._frameTl.kill(); self._frameTl = null; }
      self.setFrame(1); // 回到站立帧
      // 检查是否到达边缘
      self._checkEdgeArrival(direction);
      if (onComplete) onComplete();
    }
  });
  this._addTween(moveTween);

  // ---- 2. 帧切换 Timeline (GSAP，独立于位移!) ----
  this._frameTl = gsap.timeline({ repeat: -1 });
  for (var fi = 0; fi < frames.length; fi++) {
    (function(f) {
      self._frameTl.to(self.imgEl, {
        duration: frameDur / 1000,
        onStart: function() { self.setFrame(f); }
      });
    })(frames[fi]);
  }
  this._addTween(this._frameTl);
};

/** 检查到达边缘后的行为 */
UsagiCharacter.prototype._checkEdgeArrival = function(direction) {
  var sw = this.imgEl.width || 128;
  var margin = 25;
  var atEdge = (direction === 'right' && this.x >= window.innerWidth - sw - margin)
            || (direction === 'left' && this.x <= margin);

  if (atEdge) {
    // 到达边缘 → 触发撞墙或准备攀爬
    var side = direction === 'right' ? 'right' : 'left';
    this._onReachWall(side);
  } else {
    this._onBehaviorComplete('walk');
  }
};

/** 到达墙边 */
UsagiCharacter.prototype._onReachWall = function(side) {
  var r = Math.random();

  // 停止帧切换
  if (this._frameTl) { this._frameTl.kill(); this._frameTl = null; }

  if (r < 0.35) {
    this._doWallBump(side);      // A轨：撞墙弹回
  } else if (r < 0.7) {
    this._doClimbFromWall(side); // B轨：攀爬墙壁
  } else {
    this._turnAround();          // 掉头往反方向走
  }
};


// ---- 复合行为：走+停 ----

/** 走一段然后停下 */
UsagiCharacter.prototype._doWalkAndSit = function() {
  var self = this;
  var dist = 80 + Math.random() * 200; // 80~280px
  var dir = Math.random() > 0.5 ? 'right' : 'left';
  var spd = Math.random() > 0.7 ? 'run' : 'walk';

  this._walk(dir, dist, spd, function() {
    // 走完后停下 → 可能坐下或站立
    if (Math.random() > 0.4) {
      self._doSitDown();
    } else {
      self._doStandIdle();
    }
  });
};

/** 走到墙边抓一下 */
UsagiCharacter.prototype._doWalkAndGrab = function() {
  var self = this;
  var dir = Math.random() > 0.5 ? 'right' : 'left';

  // 走到边缘（distance=-1 表示自动走到边墙）
  this._walk(dir, -1, 'walk', function() {
    // 到达后自动触发 _checkEdgeArrival → _onReachWall
  });
};

/** 匍匐爬行（★ fix: 加入撅屁股交替动画）*/
UsagiCharacter.prototype._doCreep = function() {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this._setState(ST.WALKING);

  var dir = Math.random() > 0.5 ? 'right' : 'left';
  this.facingRight = (dir === 'right');
  this._applyFacing();

  // ★ 立即设爬行首帧，避免帧空档
  this.setFrame(20); // 拱起帧

  var dist = 60 + Math.random() * 120;
  var sw = this.imgEl.width || 128;
  var targetX = dir === 'right'
    ? Math.min(this.x + dist, window.innerWidth - sw)
    : Math.max(this.x - dist, 0);

  // 爬行序列：拱起[20] → 趴下[21]滑行 → 拱起[20] → 趴下[21]滑行 → ... → 减速停
  var creepData = [
    { frame: 20, relX: 0,    dur: 0.2 },    // 准备：拱起
    { frame: 21, relX: 0.15, dur: 0.3 },    // 趴下，滑行
    { frame: 20, relX: 0.30, dur: 0.15 },   // 再拱起
    { frame: 21, relX: 0.50, dur: 0.3 },    // 再趴下滑行
    { frame: 20, relX: 0.65, dur: 0.15 },   // 再拱起
    { frame: 21, relX: 0.85, dur: 0.3 },    // 最后滑行
    { frame: 20, relX: 1.0,  dur: 0.15 }    // 减速停，拱起
  ];

  var startX = this.x;
  var totalDist = targetX - startX;

  // 用 GSAP timeline 控制 Creep 序列
  var tl = gsap.timeline({
    onComplete: function() {
      self._onBehaviorComplete('walk');
    }
  });

  creepData.forEach(function(step, i) {
    tl.to(self, {
      x: startX + totalDist * step.relX,
      duration: step.dur,
      ease: i === 0 ? 'power1.in' : (i === creepData.length - 1 ? 'power1.out' : 'none'),
      onStart: function() { self.setFrame(step.frame); },
      onUpdate: function() { self._syncDOM(); }
    });
  });

  this._addTween(tl);
};

/** 受惊跳轨（向下掉一层）*/
UsagiCharacter.prototype._doStartleJump = function() {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this._setState(ST.FALLING);

  this.setFrame(SPRITE_GROUPS.falling[0]); // [4] 翻白眼
  this.playSound('start', { volume: 0.3 });

  var currentY = this.y;
  var sh = this.imgEl.height || 128;
  var targetY = Math.min(currentY + 100 + Math.random() * 150, window.innerHeight - sh - DOCK_RESERVE_PX);
  var targetRail = getRailFromY(targetY);

  // 受惊跳：先微微上跳再落下
  var tl = gsap.timeline({
    onComplete: function() { self._bounceThenStand(targetRail); }
  });

  // 小跳
  tl.to(self, {
    y: currentY - 20,
    duration: 0.15,
    ease: 'power1.out',
    onStart: function() { self.setFrame(4); },
    onUpdate: function() { self._syncDOM(); }
  })
  // 落下
  .to(self, {
    y: targetY,
    duration: 0.35,
    ease: 'power2.in',
    onUpdate: function() { self._syncDOM(); }
  });

  this._addTween(tl);
};


// ============================================================
//  SECTION 8: 边缘/墙壁行为
// ============================================================

/** A轨：撞墙弹回（★ fix: 正确的朝向和帧选择）*/
UsagiCharacter.prototype._doWallBump = function(side) {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this._setState(ST.IDLE);

  var isHard = Math.random() > 0.5;

  if (isHard) {
    // 硬撞：根据撞墙方向选帧
    if (side === 'right') {
      this.setFrame(SPRITE_GROUPS.dragRightHard[0]); // [10] 右撞
    } else {
      this.setFrame(SPRITE_GROUPS.dragLeftHard[0]); // [9] 左撞
    }
    this.playSound('sit', { volume: 0.4 });
  } else {
    // 软碰
    this.setFrame(SPRITE_GROUPS.tripping[0]); // [22]
    this.playSound('start', { volume: 0.25 });
  }

  // 弹回动画
  var bounceDist = isHard ? 60 + Math.random() * 80 : 30 + Math.random() * 40;
  var bounceDir = side === 'right' ? 'left' : 'right';
  var targetX = bounceDir === 'right' ? this.x + bounceDist : this.x - bounceDist;
  var sw = this.imgEl.width || 128;
  targetX = Math.max(5, Math.min(window.innerWidth - sw - 5, targetX));

  // 反向翻转
  this.facingRight = (bounceDir === 'right');
  this._applyFacing();

  var bumpTween = gsap.to(this, {
    x: targetX,
    duration: 0.4,
    ease: 'power2.out',
    onUpdate: function() { self._syncDOM(); },
    onComplete: function() {
      self.setFrame(1);
      self._onBehaviorComplete('wall');
    }
  });
  this._addTween(bumpTween);
};

/** 掉头走 */
UsagiCharacter.prototype._turnAround = function() {
  var self = this;
  this.facingRight = !this.facingRight;
  this._applyFacing();
  this.setFrame(1);

  // 稍微停顿再走
  this._delay(300, function() {
    var dir = self.facingRight ? 'right' : 'left';
    self._walk(dir, 100 + Math.random() * 200, 'walk', function() {
      self._onBehaviorComplete('walk');
    });
  });
};

/** B轨：从墙边开始攀爬（★ 禁止到 Rail 0 天花板）*/
UsagiCharacter.prototype._doClimbFromWall = function(side) {
  // ★ fix: 把墙壁方向 side 传递给 _doClimbWall
  // side: 'left' = 在屏幕左墙, 'right' = 在屏幕右墙
  var canGoUp = this.currentRail > MIN_ACTIVE_RAIL;
  var goUp = canGoUp && Math.random() > 0.3;
  if (goUp) {
    var targetRail = Math.max(MIN_ACTIVE_RAIL, this.currentRail - 1 - Math.floor(Math.random() * 2));
    // ★ fix: 确保目标 rail 不同于当前 rail
    if (targetRail >= this.currentRail) {
      targetRail = this.currentRail - 1;
    }
    if (targetRail < MIN_ACTIVE_RAIL) {
      // 已经在最顶部，无法再上，掉头或抓墙
      if (Math.random() > 0.5) this._turnAround();
      else this._doGrabWall();
    } else {
      this._doClimbWall(this.currentRail, targetRail, side);
    }
  } else {
    this._doFallOffWall();
  }
};

/**
 * ★★★ 攀爬墙壁 — 按 Shimeji 原始 Actions.xml 多阶段序列重写
 *
 * 原始 XML 结构：
 *   向上爬：准备[14]停顿 → 慢爬[14→12→13]向上 → 休息[13]停顿 → 快爬[13→12→14]向上
 *   向下爬：准备[14]停顿 → 快下[14→12→13]向下 → 休息[13]停顿 → 慢下[13→12→14]向下
 *
 * 用 GSAP timeline 驱动，帧和位移严格同步
 * ★ fix: 预先计算绝对 Y 目标值，避免 GSAP timeline 创建时固化 self.y 的 bug
 */
UsagiCharacter.prototype._doClimbWall = function(fromRail, toRail, wallSide) {
  var self = this;

  // ★ fix: 如果 fromRail === toRail，没有攀爬距离，改做其他行为
  if (fromRail === toRail) {
    console.log('[Usagi-v5] CLIMB skipped: same rail', fromRail, '→ do something else');
    // 已在墙边，选择：掉头走 / 抓墙 / 掉落
    var r = Math.random();
    if (r < 0.5) {
      this._turnAround();
    } else if (r < 0.8) {
      this._doGrabWall();
    } else {
      this._doFallOffWall();
    }
    return;
  }

  this._ensureCleanState();  // ★ 清理残留帧
  this._setState(ST.CLIMBING);

  var fromY = getRailCenterY(fromRail);
  var toY = getRailCenterY(toRail);
  var sh = this.imgEl.height || 128;
  var sw = this.imgEl.width || 128;
  var goingUp = toRail < fromRail; // 向上爬 = Rail 编号减小

  // ★ fix: 根据墙壁方向决定朝向和X位置
  // 攀爬帧[12/13/14]原始方向=脸朝右、身体在左（侧面姿态）
  // wallSide: 'left' = 在左墙贴墙, 'right' = 在右墙贴墙
  if (wallSide === 'left') {
    this.facingRight = false; // 左墙：不翻转，身体在左靠墙，脸朝右面向中心
    this.x = 2;               // 贴紧左墙
  } else if (wallSide === 'right') {
    this.facingRight = true;  // 右墙：翻转，身体在右靠墙，脸朝左面向中心
    this.x = window.innerWidth - sw - 2; // 贴紧右墙
  } else {
    // 兜底：根据当前位置判断
    var onRightSide = this.x > window.innerWidth / 2;
    if (onRightSide) {
      this.facingRight = true;
      this.x = window.innerWidth - sw - 2;
      wallSide = 'right';
    } else {
      this.facingRight = false;
      this.x = 2;
      wallSide = 'left';
    }
  }
  this._applyFacing();
  this._syncDOM();

  // ★ 立即设攀爬准备帧，避免帧空档
  this.setFrame(SPRITE_GROUPS.climb1[0]); // [14] 抬头

  // ★ fix: 预先计算绝对 Y 坐标目标值
  var startY = this.y;
  var endY = toY - sh / 2;
  var totalDistY = endY - startY; // 向上为负，向下为正

  // 攀爬帧序列（对照原始 XML）
  // 向上：慢速段(40%) + 快速段(60%)  |  向下：快速段(60%) + 慢速段(40%)
  var seg1Ratio = goingUp ? 0.4 : 0.6;
  // ★ 预计算每段的绝对Y坐标
  var seg1EndY = startY + totalDistY * seg1Ratio;
  // 第一段内部3帧的Y坐标
  var seg1_f1_Y = startY + (seg1EndY - startY) * 0.33;
  var seg1_f2_Y = startY + (seg1EndY - startY) * 0.66;
  var seg1_f3_Y = seg1EndY;
  // 第二段内部3帧的Y坐标
  var seg2_f1_Y = seg1EndY + (endY - seg1EndY) * 0.33;
  var seg2_f2_Y = seg1EndY + (endY - seg1EndY) * 0.66;
  var seg2_f3_Y = endY;

  console.log('[Usagi-v5] CLIMB', wallSide, goingUp ? 'UP' : 'DOWN',
    'from Y=' + Math.round(startY) + ' to Y=' + Math.round(endY));

  // ★ 完整攀爬时间线 — 5 个阶段
  var tl = gsap.timeline({
    onComplete: function() {
      self.currentRail = toRail;
      self.setFrame(1);
      self._applyFacing(); // 恢复正常朝向
      self._onBehaviorComplete('climb');
    }
  });

  // ====== 阶段 1：准备抓墙 ======
  // 帧 [14] 抬头看上方，停顿约 500ms
  tl.call(function() {
    self.setFrame(SPRITE_GROUPS.climb1[0]); // [14]
    self.playSound('start', { volume: 0.15 });
  })
  .to(self, { y: startY, duration: 0.5, ease: 'none', onUpdate: function() { self._syncDOM(); } }) // 纯停顿：Y不变但让GSAP正常计时
  // ====== 阶段 2：第一段攀爬 ======
  // 向上：慢爬 [14] → [12] → [13]，每帧约 300ms
  // 向下：快下 [14] → [12] → [13]，每帧约 220ms
  .to(self, {
    y: seg1_f1_Y,  // ★ 用预计算的绝对值
    duration: goingUp ? 0.3 : 0.22,
    ease: 'power1.inOut',
    onStart: function() { self.setFrame(SPRITE_GROUPS.climb1[0]); }, // [14]
    onUpdate: function() { self._syncDOM(); }
  })
  .to(self, {
    y: seg1_f2_Y,  // ★ 用预计算的绝对值
    duration: goingUp ? 0.3 : 0.22,
    ease: 'power1.inOut',
    onStart: function() { self.setFrame(SPRITE_GROUPS.climb2[0]); }, // [12]
    onUpdate: function() { self._syncDOM(); }
  })
  .to(self, {
    y: seg1_f3_Y,  // ★ 用预计算的绝对值
    duration: goingUp ? 0.3 : 0.22,
    ease: 'power1.inOut',
    onStart: function() { self.setFrame(SPRITE_GROUPS.climb3[0]); }, // [13] 抓住休息
    onUpdate: function() { self._syncDOM(); }
  })
  // ====== 阶段 3：中途休息 ======
  // 帧 [13] 抓住墙面喘口气，停顿约 450ms
  .to(self, { y: seg1_f3_Y, duration: 0.45, ease: 'none', onUpdate: function() { self._syncDOM(); } }) // 纯停顿：Y不变
  // ====== 阶段 4：第二段攀爬（加速！）=====
  // 向上：快爬 [13] → [12] → [14]，每帧约 200ms（比第一段快！）
  // 向下：慢下 [13] → [12] → [14]，每帧约 300ms
  .to(self, {
    y: seg2_f1_Y,  // ★ 用预计算的绝对值
    duration: goingUp ? 0.2 : 0.3,
    ease: goingUp ? 'power1.in' : 'power1.out',
    onStart: function() { self.setFrame(SPRITE_GROUPS.climb3[0]); }, // [13]
    onUpdate: function() { self._syncDOM(); }
  })
  .to(self, {
    y: seg2_f2_Y,  // ★ 用预计算的绝对值
    duration: goingUp ? 0.2 : 0.3,
    ease: goingUp ? 'power1.in' : 'power1.out',
    onStart: function() { self.setFrame(SPRITE_GROUPS.climb2[0]); }, // [12]
    onUpdate: function() { self._syncDOM(); }
  })
  .to(self, {
    y: seg2_f3_Y,  // ★ 精确到达目标 Rail 中心
    duration: goingUp ? 0.2 : 0.3,
    ease: goingUp ? 'power1.in' : 'power1.out',
    onStart: function() { self.setFrame(SPRITE_GROUPS.climb1[0]); }, // [14] 到达
    onUpdate: function() { self._syncDOM(); }
  });

  this._addTween(tl);
};

/** 主动攀爬向上（★ 禁止爬到天花板 Rail 0）*/
UsagiCharacter.prototype._doClimbUp = function() {
  var wallSide = this.x > window.innerWidth / 2 ? 'right' : 'left';
  var targetRail = Math.max(MIN_ACTIVE_RAIL, this.currentRail - 1 - Math.floor(Math.random() * 2));
  // ★ fix: 确保目标不同于当前
  if (targetRail >= this.currentRail) {
    targetRail = this.currentRail - 1;
  }
  if (targetRail < MIN_ACTIVE_RAIL) {
    // 已在顶部，无法上爬
    this._doGrabWall();
    return;
  }
  this._doClimbWall(this.currentRail, targetRail, wallSide);
};

/** 向下攀爬/松手掉落 */
UsagiCharacter.prototype._doClimbDown = function() {
  var wallSide = this.x > window.innerWidth / 2 ? 'right' : 'left';
  if (Math.random() > 0.5) {
    this._doClimbWall(this.currentRail, Math.min(4, this.currentRail + 1), wallSide);
  } else {
    this._doFallOffWall();
  }
};

/** 从墙上松手掉落 */
UsagiCharacter.prototype._doFallOffWall = function() {
  this._setState(ST.FALLING);
  this._doFallTo(Math.min(4, Math.max(MIN_ACTIVE_RAIL, this.currentRail + 1 + Math.floor(Math.random() * 2))));
};

/** 受惊掉落（★ 目标不低于 Rail 1）*/
UsagiCharacter.prototype._doFallOff = function() {
  this._setState(ST.FALLING);
  this.setFrame(4); // 翻滚
  this._doFallTo(Math.min(4, Math.max(MIN_ACTIVE_RAIL, this.currentRail + 1)));
};

/**
 * 掉落到目标 Rail（★ 自动钳位到 1~4 范围）
 */
UsagiCharacter.prototype._doFallTo = function(targetRail) {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  // ★ 钳位：禁止掉到天花板（Rail 0）
  targetRail = Math.max(MIN_ACTIVE_RAIL, Math.min(4, targetRail));

  var toY = getRailCenterY(targetRail);
  var sh = this.imgEl.height || 128;
  var fallTargetY = toY - sh / 2;

  this.setFrame(SPRITE_GROUPS.falling[0]); // [4]
  this.playSound('start', { volume: 0.3 });

  var fallTween = gsap.to(this, {
    y: fallTargetY,
    duration: 0.6 + Math.random() * 0.4,
    ease: 'power2.in',
    onUpdate: function() { self._syncDOM(); },
    onComplete: function() {
      self.currentRail = targetRail;
      self._bounceThenStand(targetRail);
    }
  });
  this._addTween(fallTween);
};

/** 落地弹跳然后站起 */
UsagiCharacter.prototype._bounceThenStand = function(railId) {
  var self = this;
  var bounces = 1 + Math.floor(Math.random() * 2); // 1~2次
  var bi = 0;

  function doBounce() {
    self.setFrame(bi % 2 === 0 ? SPRITE_GROUPS.bounceA[0] : SPRITE_GROUPS.bounceB[0]);
    bi++;
    if (bi < bounces) {
      self._delay(120, doBounce);
    } else {
      // 弹完站稳
      self.setFrame(railId === 4 ? 11 : 1); // 地板坐着，其他站着
      self.playSound('sit', { volume: 0.35 });
      self._delay(400 + Math.random() * 800, function() {
        if (railId === 4) self.setFrame(1); // 地板上站起来
        self._onBehaviorComplete('fall');
      });
    }
  }

  this.playSound('start', { volume: 0.25 });
  this._delay(50, doBounce);
};

// 抓墙待着（★ fix: 感知墙壁方向，贴紧对应墙边）
UsagiCharacter.prototype._doGrabWall = function() {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this._setState(ST.IDLE);

  // ★ fix: 根据当前位置判断在哪面墙，贴紧墙边
  var sw = this.imgEl.width || 128;
  var wallSide = this.x > window.innerWidth / 2 ? 'right' : 'left';
  if (wallSide === 'left') {
    this.facingRight = false; // 左墙：不翻转（身体在左靠墙）
    this.x = 2;
  } else {
    this.facingRight = true;  // 右墙：翻转后身体在右靠墙
    this.x = window.innerWidth - sw - 2;
  }
  this._applyFacing();
  this._syncDOM();

  this.setFrame(SPRITE_GROUPS.grabWall[0]); // [13] 抓墙
  var holdDuration = 1500 + Math.random() * 2000; // 1.5~3.5秒

  // 微微颤动 — 用 CSS transform 而非 this.x，避免和后续攀爬位移冲突
  var wobbleDir = wallSide === 'left' ? 1 : -1;
  var wobble = gsap.to(this.spriteEl, {
    x: wobbleDir * 2,
    duration: 0.08,
    yoyo: true,
    repeat: Math.floor(holdDuration / 160),
  });
  this._addTween(wobble);

  var endTimer = this._delay(holdDuration, function() {
    // 抓墙结束后：掉落 or 爬
    if (Math.random() > 0.5) {
      self._doFallOffWall();
    } else {
      self.setFrame(1);
      self._applyFacing();
      // 掉头离开墙
      self._turnAround();
    }
  });
  this._addTween({ kill: function() { clearTimeout(endTimer); } });
};


// ============================================================
//  SECTION 9: HA! 点击交互
// ============================================================

UsagiCharacter.prototype._bindEvents = function() {
  var self = this;

  // 点击事件（★ 首次点击解锁音频）
  this.spriteEl.addEventListener('mousedown', function(e) {
    // ★ 首次交互：解锁浏览器音频策略
    if (!self.audioUnlocked) { self._unlockAudio(); self.audioUnlocked = true; }
    // 区分点击 vs 拖拽（拖拽由 move 判断）
    self._clickStartX = e.clientX;
    self._clickStartY = e.clientY;
    self._clickIsDrag = false;
  });

  this.spriteEl.addEventListener('mouseup', function(e) {
    self._dragPending = false; // ★ 重置拖拽待定状态
    if (!self._clickIsDrag) {
      // ★ 双击检测
      var now = Date.now();
      if (now - self._lastClickTime < self._DOUBLE_CLICK_GAP) {
        // 双击！触发"倒地"
        self._onActionSquish();
        self._lastClickTime = 0; // 重置防止三击误判
      } else {
        // 单击 → HA!
        self._onActionHa();
        self._lastClickTime = now;
      }
    }
    self._clickIsDrag = false;
  });

  // 触摸支持（★ 首次触摸解锁音频）
  this.spriteEl.addEventListener('touchstart', function(e) {
    if (!self.audioUnlocked) { self._unlockAudio(); self.audioUnlocked = true; }
    var t = e.touches[0];
    self._clickStartX = t.clientX;
    self._clickStartY = t.clientY;
    self._clickIsDrag = false;
  }, { passive: true });

  this.spriteEl.addEventListener('touchend', function(e) {
    self._dragPending = false;
    if (!self._clickIsDrag) {
      // ★ 触摸双击检测
      var now = Date.now();
      if (now - self._lastClickTime < self._DOUBLE_CLICK_GAP) {
        self._onActionSquish();
        self._lastClickTime = 0;
      } else {
        self._onActionHa();
        self._lastClickTime = now;
      }
    }
    self._clickIsDrag = false;
  });

  // 拖拽事件（绑定在 document 上防止丢失）
  // ★ 修复: mousemove 先检测是否需要启动拖拽
  document.addEventListener('mousemove', function(e) {
    if (!self.isDragging && self._dragPending) {
      // 还没启动拖拽，检测移动距离
      var dx = e.clientX - self._dragStartX;
      var dy = e.clientY - self._dragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        // 超过阈值 → 正式启动拖拽
        self._onDragStart(self._dragStartX, self._dragStartY);
        self._clickIsDrag = true;
      }
    }
    if (self.isDragging) {
      self._onDragMove(e.clientX, e.clientY);
    }
  });

  document.addEventListener('touchmove', function(e) {
    if (!self.isDragging && self._dragPending && e.touches[0]) {
      var dx = e.touches[0].clientX - self._dragStartX;
      var dy = e.touches[0].clientY - self._dragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        self._onDragStart(self._dragStartX, self._dragStartY);
        self._clickIsDrag = true;
      }
    }
    if (self.isDragging && e.touches[0]) {
      self._onDragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  document.addEventListener('mouseup', function(e) {
    self._dragPending = false; // ★ 清理待定状态
    if (self.isDragging) {
      self._onDragEnd();
    }
  });

  document.addEventListener('touchend', function(e) {
    self._dragPending = false;
    if (self.isDragging) {
      self._onDragEnd();
    }
  });

  // ★ 拖拽开始（★ 修复: 不在 mousedown 立即启动拖拽，
  //   而是等 mousemove 检测到实际移动后才启动，否则单击/双击无法触发）
  this.spriteEl.addEventListener('mousedown', function(e) {
    self._dragPending = true; // 标记"可能要拖拽"
    self._dragStartX = e.clientX;
    self._dragStartY = e.clientY;
  });

  this.spriteEl.addEventListener('touchstart', function(e) {
    if (e.touches[0]) {
      self._dragPending = true;
      self._dragStartX = e.touches[0].clientX;
      self._dragStartY = e.touches[0].clientY;
    }
  }, { passive: true });
};

/** HA! 点击反应 */
UsagiCharacter.prototype._onActionHa = function() {
  var self = this;
  this._startInteraction('ha');

  // 连击检测（简化版：随机选择连击等级）
  var comboLevel = Math.random();
  if (comboLevel < 0.5) {
    this._doHaStandard();
  } else if (comboLevel < 0.85) {
    this._doHaCombo2();
  } else {
    this._doHaAngry();
  }
};

/** 标准 HA! */
UsagiCharacter.prototype._doHaStandard = function() {
  var self = this;

  // 三段式：预备 [26] → 爆发 [27](+音效) → 收尾 [28]
  var tl = gsap.timeline({
    onComplete: function() { self._endInteraction('ha'); }
  });

  tl.call(function() { self.setFrame(SPRITE_GROUPS.haPrepare[0]); }) // [26]
    .to(self, { duration: 0.25 })
    .call(function() {
      self.setFrame(SPRITE_GROUPS.haBurst[0]); // [27]
      self.playSound('ha', { override: true });
      // 弹性膨胀效果
      gsap.fromTo(self.imgEl,
        { scale: 1.15 },
        { scale: 1, duration: 0.3, ease: 'elastic.out(1, 0.4)' }
      );
    })
    .to(self, { duration: 0.2 })
    .call(function() {
      self.setFrame(SPRITE_GROUPS.haEnd[0]); // [28]
    })
    .to(self, { duration: 0.25 });

  this._addTween(tl);
};

/** HA! 二连击 */
UsagiCharacter.prototype._doHaCombo2 = function() {
  var self = this;
  var tl = gsap.timeline({
    onComplete: function() { self._endInteraction('ha'); }
  });

  // 第一次 HA!
  tl.call(function() { self.setFrame(26); }).to({}, { duration: 0.15 })
    .call(function() {
      self.setFrame(27);
      self.playSound('ha', { override: true });
    }).to({}, { duration: 0.18 })
    .call(function() { self.setFrame(28); }).to({}, { duration: 0.12 })

    // 第二次更大!
    .call(function() { self.setFrame(26); }).to({}, { duration: 0.1 })
    .call(function() {
      self.setFrame(27);
      self.playSound('ha', { override: true });
      // 更大膨胀
      gsap.fromTo(self.imgEl,
        { scale: 1.25 },
        { scale: 1, duration: 0.35, ease: 'elastic.out(1, 0.35)' }
      );
    }).to({}, { duration: 0.2 })
    .call(function() { self.setFrame(28); }).to({}, { duration: 0.2 });

  this._addTween(tl);
};

/** HA! 愤怒版（扭屁股）*/
UsagiCharacter.prototype._doHaAngry = function() {
  var self = this;

  // 先 HA! 再扭屁股
  this._doHaStandard();

  // 延迟追加扭屁股（★ 循环可被 _ensureCleanState 取消）
  setTimeout(function() {
    if (self.state !== ST.INTERACTING) return;

    var wiggleFrames = SPRITE_GROUPS.wiggle; // [15,16,17]
    var wi = 0;
    var wCycles = 3;

    function nextWiggle() {
      if (wi >= wCycles * wiggleFrames.length) {
        self.setFrame(1);
        self._extraFrameLoop = null;
        return;
      }
      self.setFrame(wiggleFrames[wi % wiggleFrames.length]);
      if (wi === 0) self.playSound('double'); // "嘟嘟嘟"
      wi++;
      self._extraFrameLoop = setTimeout(nextWiggle, FRAME_DURATION.wiggle);
    }
    nextWiggle();
  }, 600);
};

/** ★ 双击：倒地躺平[18]→过一会儿爬起来 */
UsagiCharacter.prototype._onActionSquish = function() {
  var self = this;
  this._startInteraction('squish');

  var tl = gsap.timeline({
    onComplete: function() { self._endInteraction('squish'); }
  });

  // ① 直接倒地→帧[18]摆烂躺平
  tl.call(function() {
    self.setFrame(SPRITE_GROUPS.bounceA[0]); // [18] 躺平摆烂
    self.playSound('sit', { volume: 0.4 });
  })

  // ② 躺平摆烂1~2秒
  .to(self, { duration: 1.0 + Math.random() * 1.0, ease: 'none' })

  // ③ 爬起来
  .call(function() {
    self.setFrame(1); // 站立帧
  });

  this._addTween(tl);
};


// ============================================================
//  SECTION 10: 吃烦恼（六阶段）
// ============================================================

UsagiCharacter.prototype.playEat = function() {
  var self = this;
  this._startInteraction('eat');

  var stageDelay = 0;

  // Stage 1: 感知
  stageDelay += 400;
  this._delay(0, function() {
    self.setFrame(SPRITE_GROUPS.eatAlert[0]); // [5] 低头警觉
    self.playSound('start', { volume: 0.25 });
  });

  // Stage 2: 蓄力
  this._delay(stageDelay, function() {
    self.setFrame(SPRITE_GROUPS.eatCharge[0]); // [26] 抱胸蓄力
  });
  stageDelay += 400;

  // Stage 3: 大咬!
  this._delay(stageDelay, function() {
    self.setFrame(SPRITE_GROUPS.eatBite[0]); // [27] 张嘴大咬
    self.playSound('ha', { override: true }); // ★ 同步 5.wav
    // 弹性膨胀
    gsap.fromTo(self.imgEl,
      { scale: 1.2 },
      { scale: 1, duration: 0.35, ease: 'elastic.out(1, 0.4)' }
    );
  });
  stageDelay += 450;

  // Stage 4: 扭屁股嚼嚼（★ 循环可被 _ensureCleanState 取消）
  this._delay(stageDelay, function() {
    var chewFrames = SPRITE_GROUPS.eatChew; // [15,16,17]
    var ci = 0;
    var chewRounds = 2;

    function chewLoop() {
      if (ci >= chewRounds * chewFrames.length) {
        // 嚼完了进入满足阶段
        self.setFrame(SPRITE_GROUPS.eatSatisfy[0]); // [28]
        self.playSound('sit', { volume: 0.4 });
        self._extraFrameLoop = null;
        return;
      }
      self.setFrame(chewFrames[ci % chewFrames.length]);
      if (ci === 0) self.playSound('double', { volume: 0.5 }); // "嘟嘟嘟"
      ci++;
      self._extraFrameLoop = setTimeout(chewLoop, FRAME_DURATION.wiggle);
    }
    chewLoop();
  });
  stageDelay += 1200; // 2轮 × 3帧 × 200ms

  // Stage 5: 满足 + 触发夸夸事件
  this._delay(stageDelay, function() {
    self.setFrame(SPRITE_GROUPS.eatSatisfy[0]); // [28]
    // 触发自定义事件
    var evt = new CustomEvent('usagiEatComplete', {
      detail: { usagi: self }
    });
    document.dispatchEvent(evt);
  });
  stageDelay += 600;

  // Stage 6: 回味 + 结束
  this._delay(stageDelay, function() {
    self.setFrame(SPRITE_GROUPS.eatSavor[0]); // [5] 回味
    self._delay(400, function() {
      self.setFrame(1);
      self._endInteraction('eat');
    });
  });
};


// ============================================================
//  SECTION 11: 偷看输入框
// ============================================================

UsagiCharacter.prototype.startPeekInput = function(inputEl) {
  if (!inputEl) return;
  this.peekInputEl = inputEl;
  this._startPeekApproach();
};

UsagiCharacter.prototype.endPeekInput = function() {
  this.peekInputEl = null;
  this.peekState = null;
  // 如果正在偷看，中断并恢复
  if (this.state === ST.INTERACTING) {
    this._endInteraction('peek');
  }
};

/** 开始走向输入框 */
UsagiCharacter.prototype._startPeekApproach = function() {
  var self = this;
  if (!this.peekInputEl) return;

  this._startInteraction('peek');
  this.peekState = 'approaching';

  var rect = this.peekInputEl.getBoundingClientRect();
  var myPos = this.getPosition();
  var targetX = rect.left - 50;
  var targetY = rect.top - 80;
  var sw = this.imgEl.width || 128;
  var sh = this.imgEl.height || 128;
  targetX = Math.max(5, Math.min(window.innerWidth - sw - 5, targetX));
  targetY = Math.max(5, Math.min(window.innerHeight - sh - DOCK_RESERVE_PX, targetY));

  // 面向输入框
  this.facingRight = targetX > this.x;
  this._applyFacing();

  var approachTween = gsap.to(this, {
    x: targetX,
    y: targetY,
    duration: 1.5,
    ease: 'power2.out',
    onUpdate: function() { self._syncDOM(); },
    onComplete: function() {
      self._startWatching();
    }
  });
  this._addTween(approachTween);
};

/** 盯着输入框看 */
UsagiCharacter.prototype._startWatching = function() {
  var self = this;
  this.peekState = 'watching';
  this.setFrame(SPRITE_GROUPS.lookUp[0]); // [26] 抬头
  this.facingRight = true; // 面向右边（通常输入框在右下方）
  this._applyWatching();

  var watchTime = 0;
  var maxWatchTime = 20000; // 最长偷看20秒
  var checkInterval = 1000;

  function checkPeek() {
    if (self.peekState !== 'watching') return;
    watchTime += checkInterval;

    if (!self.peekInputEl) {
      self.endPeekInput();
      return;
    }

    // 根据时间变化表情
    if (watchTime < 5000) {
      // 好奇期：偶尔眨眼
      self.setFrame(Math.random() > 0.7 ? 5 : 26);
    } else if (watchTime < 15000) {
      // 无聊期：打哈欠/晃腿
      self.setFrame(Math.random() > 0.5 ? 11 : 31);
    } else {
      // 很无聊：趴下
      self.setFrame(21);
    }
  }

  // 每秒检查一次
  var peekInterval = setInterval(checkPeek, checkInterval);
  this._addTween({ kill: function() { clearInterval(peekInterval); } });

  // 最大超时
  var timeoutTimer = this._delay(maxWatchTime, function() {
    clearInterval(peekInterval);
    self.endPeekInput();
  });
  this._addTween({ kill: function() { clearTimeout(timeoutTimer); } });
};

UsagiCharacter.prototype._applyWatching = function() {
  // 面向输入框（通常朝右）
  this.imgEl.style.transform = this.facingRight ? 'scaleX(-1)' : 'scaleX(1)';
};


// ============================================================
//  SECTION 12: 拖拽系统（v5 简化版）
// ============================================================

UsagiCharacter.prototype._onDragStart = function(clientX, clientY) {
  this.isDragging = true;
  this._setState(ST.DRAGGED);
  this._cancelAll(); // 取消一切进行中的行为/动画

  var rect = this.spriteEl.getBoundingClientRect();
  this.dragOffsetX = clientX - rect.left; // 点击位置相对元素左上角的偏移
  this.dragOffsetY = clientY - rect.top;
  this.dragUsagiStartX = this.x;
  this.dragUsagiStartY = this.y;
  this.dragStartX = clientX;
  this.dragStartY = clientY;
  this.lastDragX = clientX;
  this.lastDragY = clientY;
  this.lastDragTime = Date.now();
  this.dragVelocityX = 0;
  this.dragVelocityY = 0;

  this.spriteEl.style.cursor = 'grabbing';

  // 探头帧
  this.setFrame(SPRITE_GROUPS.dragLeftSoft[0]); // [5]

  console.log('[Usagi-v5] Drag start @ (' + Math.round(this.x) + ',' + Math.round(this.y) + ')');
};

UsagiCharacter.prototype._onDragMove = function(clientX, clientY) {
  if (!this.isDragging) return;

  var now = Date.now();
  var dt = now - this.lastDragTime;
  if (dt <= 0) dt = 1;

  // 速度
  this.dragVelocityX = (clientX - this.lastDragX) / dt;
  this.dragVelocityY = (clientY - this.lastDragY) / dt;
  this.lastDragX = clientX;
  this.lastDragY = clientY;
  this.lastDragTime = now;

  // 直接设置坐标（left + top only!)
  var sw = this.imgEl.width || 128;
  var sh = this.imgEl.height || 128;
  var newX = clientX - this.dragOffsetX;
  var newY = clientY - this.dragOffsetY;
  var clamped = clampToScreen(newX, newY, sw, sh, true); // 拖拽允许进入 dock 区域
  this.x = clamped.x;
  this.y = clamped.y;
  this._syncDOM();

  // 根据水平速度选形变帧
  var vx = this.dragVelocityX;
  var avx = Math.abs(vx);

  if (avx < 0.1) {
    this.setFrame(Math.random() > 0.5 ? SPRITE_GROUPS.dragFloatL[0] : SPRITE_GROUPS.dragFloatR[0]); // [7] 或 [8]
  } else if (vx > 0) {
    this.setFrame(avx > 1.2 ? SPRITE_GROUPS.dragRightHard[0] : SPRITE_GROUPS.dragRightSoft[0]); // [10] 或 [6]
  } else {
    this.setFrame(avx > 1.2 ? SPRITE_GROUPS.dragLeftHard[0] : SPRITE_GROUPS.dragLeftSoft[0]); // [9] 或 [5]
  }
};

UsagiCharacter.prototype._onDragEnd = function() {
  if (!this.isDragging) return;

  var vx = this.dragVelocityX;
  var vy = this.dragVelocityY;
  var speed = Math.sqrt(vx * vx + vy * vy);

  this.isDragging = false;
  this.spriteEl.style.cursor = 'grab';
  this._clickIsDrag = false;

  console.log('[Usagi-v5] Drag end speed=' + speed.toFixed(2));

  if (speed > 0.8) {
    this._doFling(vx, vy, speed);
  } else {
    // 无惯性释放 → 检查是否在 dock 区域，是则弹回
    var sh = this.imgEl.height || 128;
    var safeY = window.innerHeight - sh - DOCK_RESERVE_PX;
    if (this.y > safeY) {
      this._escapeDockArea();
    } else {
      this.setFrame(1);
      this._setState(ST.IDLE);
      this._endInteraction('drag');
    }
  }
};

/** 惯性抛出 */
UsagiCharacter.prototype._doFling = function(vx, vy, speed) {
  var self = this;
  this._ensureCleanState();  // ★ 帧状态清理
  this._setState(ST.FALLING);

  this.facingRight = vx >= 0;
  this._applyFacing();
  this.setFrame(SPRITE_GROUPS.falling[0]); // [4] 翻滚
  this.playSound('start', { volume: 0.35 });

  var sw = this.imgEl.width || 128;
  var sh = this.imgEl.height || 128;

  var flightTime = Math.min(speed * 300, 800);
  var targetX = this.x + vx * flightTime;
  var targetY = this.y + vy * flightTime;
  var clamped = clampToScreen(targetX, targetY, sw, sh, true); // 惯性抛出允许进入 dock 区域

  var flingTween = gsap.to(this, {
    x: clamped.x,
    y: clamped.y,
    duration: flightTime / 1000,
    ease: 'power2.out',
    onUpdate: function() { self._syncDOM(); },
    onComplete: function() {
      self._flingLand();
    }
  });
  this._addTween(flingTween);
};

/** 抛出落地 */
UsagiCharacter.prototype._flingLand = function() {
  var self = this;
  var newRail = getRailFromY(this.y);
  var bounces = 1 + Math.floor(Math.random() * 2);
  var bi = 0;

  function doBounce() {
    self.setFrame(bi % 2 === 0 ? SPRITE_GROUPS.bounceA[0] : SPRITE_GROUPS.bounceB[0]);
    bi++;
    if (bi < bounces) {
      self._delay(120, doBounce);
    } else {
      self.currentRail = newRail;
      self.setFrame(newRail === 4 ? 11 : 1);
      self.playSound('sit', { volume: 0.4 });
      // 如果落在 dock 区域内，弹回安全区域
      var sh = self.imgEl.height || 128;
      var safeY = window.innerHeight - sh - DOCK_RESERVE_PX;
      if (self.y > safeY) {
        self._delay(300, function() {
          self._escapeDockArea();
        });
      } else {
        self._delay(300, function() {
          if (newRail === 4) self.setFrame(1);
          self._endInteraction('drag');
        });
      }
    }
  }

  this.playSound('start', { volume: 0.3 });
  this._delay(50, doBounce);
};

/** 从 dock 区域弹跳回到安全区域（拖拽释放后使用） */
UsagiCharacter.prototype._escapeDockArea = function() {
  var self = this;
  var sh = this.imgEl.height || 128;
  var safeY = window.innerHeight - sh - DOCK_RESERVE_PX;
  var targetY = safeY - Math.random() * 60; // 弹到安全线上方一点

  this.setFrame(SPRITE_GROUPS.falling[0]); // [4] 翻滚

  var escapeTween = gsap.to(this, {
    y: targetY,
    duration: 0.4,
    ease: 'back.out(1.5)',
    onUpdate: function() { self._syncDOM(); },
    onComplete: function() {
      self.currentRail = getRailFromY(self.y);
      self.setFrame(1);
      self._setState(ST.IDLE);
      self._endInteraction('drag');
    }
  });
  this._addTween(escapeTween);
};


// ============================================================
//  SECTION 13: 辅助功能
// ============================================================

/** 显示短暂文字气泡 */
UsagiCharacter.prototype._showSpeechBubble = function(text) {
  var bubble = document.createElement('div');
  bubble.className = 'usagi-speech-bubble';
  bubble.textContent = text;
  Object.assign(bubble.style, {
    position: 'absolute',
    left: '50%',
    bottom: 'calc(100% + 10px)',
    transform: 'translateX(-50%)',
    background: 'rgba(255,255,255,0.95)',
    padding: '6px 14px',
    borderRadius: '12px',
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#FF6B81',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    zIndex: '20',
    pointerEvents: 'none'
  });

  this.spriteEl.appendChild(bubble);

  gsap.fromTo(bubble,
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }
  );

  var removeTween = gsap.to(bubble, {
    opacity: 0, y: -5, duration: 0.3, delay: 2.7,
    onComplete: function() { bubble.remove(); }
  });
  this._addTween(removeTween);
};

// ---- 音效预载与解锁 ----
UsagiCharacter.prototype._preloadSounds = function() {
  var self = this;
  Object.keys(SOUND_MAP).forEach(function(key) {
    var cfg = SOUND_MAP[key];
    try {
      var audio = new Audio(cfg.file);
      audio.volume = cfg.volume;
      audio.preload = 'auto';
      self.audioCache[key] = audio;
    } catch(e) {
      console.warn('[Usagi-v5] Failed to preload sound:', key, e.message);
    }
  });
};

/** ★ 解锁浏览器音频播放策略（必须在用户交互事件中调用）*/
UsagiCharacter.prototype._unlockAudio = function() {
  // 方法1: 创建一个静音的 AudioContext 来解锁
  try {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
  } catch(e) { /* 某些浏览器不支持 */ }

  // 方法2: 预热所有缓存音频（让浏览器记住这是用户手势触发的）
  Object.keys(this.audioCache).forEach(function(key) {
    var a = this.audioCache[key];
    if (a) {
      a.volume = 0.001; // 几乎静音
      a.play().then(function() {
        a.pause();
        a.currentTime = 0;
        a.volume = SOUND_MAP[key].volume; // 恢复原音量
      }).catch(function() {});
    }
  }.bind(this));

  console.log('[Usagi-v5] Audio unlocked');
};
