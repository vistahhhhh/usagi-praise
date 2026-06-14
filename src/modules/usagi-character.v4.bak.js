/**
 * 乌萨奇角色引擎 — v4 执行版
 * 基于 Shimeji 原始动作编排（Actions.xml + Behaviors.xml）改编
 *
 * 架构：
 * - 5-Rail 楼层系统（Rail 0=天花板 ~ Rail 4=地板）
 * - 原子动作 + 行为状态机（Frequency 加权随机选择）
 * - 双轨墙壁交互（A轨撞墙 / B轨攀爬）
 * - 三大交互：HA!点击 / 吃烦恼 / 偷看输入框
 */

import gsap from 'gsap';

// ============================================================
//  SECTION 0: 配置常量（对应 v4 文档 第零~七章）
// ============================================================

/**
 * 帧分组配置 — 基于第六章完整帧使用表
 * 替代旧的 idle/happy/eat 三组分法
 */
var SPRITE_GROUPS = {
  // ===== 地面待机/基准 =====
  stand:       [1],            // 站立基准帧
  sit:         [11],           // 盘腿坐地上
  sprawl:      [21],           // 躺平/趴平

  // ===== 行走/奔跑（三档速度共用）=====
  walk:        [1, 2, 1, 3],   // 走路循环帧 [1]→[2]→[1]→[3]

  // ===== HA! 核心三连击 =====
  haPrepare:   [26],           // "哈!"预备(抱胸闭嘴)
  haBurst:     [27],           // "哈!!"爆发(抱胸张嘴) ★★★ 核心
 haEnd:       [28],           // "哈!"收尾(抱胸闭嘴)
  haExtra:     [29],           // HA!四帧版备用(=27重复)

  // ===== 吃烦恼序列 =====
  eatAlert:    [5],            // 低头警觉感知
  eatCharge:   [26],           // 抱胸蓄力
  eatBite:     [27],           // 张嘴大咬!(★同步5.wav)
  eatChew:     [15, 16, 17],   // 扭屁股嚼嚼三连
  eatSatisfy:  [28],           // 抱胸满足
  eatSavor:    [5],            // 低头回味

  // ===== 坐姿变体 =====
  sitLegsUp:   [30],           // 生气蹲/抬腿坐(+sit.wav)
  dangleLegs:  [31, 32, 31, 33], // 坐着晃腿
  lookUp:      [26],           // 坐着抬头(SitAndLookUp)

  // ===== 爬行 =====
  creepReady:  [20],           // 匍匐-拱起/预备
  creepMove:   [21],           // 匍匐-趴平/滑行

  // ===== 攀爬（墙壁+天花板）=====
  grabWall:    [13],           // 抓墙-张嘴/抓握
  climb1:      [14],           // 攀爬-伸展(ClimbWall第一帧)
  climb2:      [12],           // 攀爬-闭嘴/收手(ClimbWall第二帧)
  climb3:      [13],           // 攀爬-张嘴/抓握(ClimbWall第三帧)

  grabCeiling: [23],           // 抓天花板闭嘴
  ceilingPrep: [25],           // 天花板准备爬
  ceilingMove: [24],           // 天花板移动中
  ceilingAlt:  [23],           // 天花板移动交替

  // ===== 重力/跌落 =====
  falling:     [4],            // 翻滚/失控(Falling帧)
  bounceA:     [18],           // 冻结/僵硬(Bouncing帧1)
  bounceB:     [19],           // 打滑/轻微撞(Bouncing帧2/Tripping)
  tripping:    [22],           // 轻微滑坡(Tripping仰倒帧)

  // ===== 拖拽形变（简化3档）=====
  dragLeftHard:  [9],          // 大幅左歪(翻白眼撞墙)
  dragLeftSoft:  [5],          // 轻微左歪(探头)
  dragRightSoft: [6],          // 轻微右歪(+5.wav!)
  dragRightHard: [10],         // 大幅右歪(翻白眼撞墙)
  dragFloatL:    [7],          // 悬空坐左
  dragFloatR:    [8],          // 悬空坐右

  // ===== 连击扭屁股 =====
  wiggle:      [15, 16, 17],   // 扭屁股循环
};

/**
 * 五条 Rail 的 Y 轴划分 — 第一章
 */
var RAILS = [
  { id: 0, name: 'ceiling', yMinPct: 0,    yMaxPct: 0.12, anchorY: 'top' },
  { id: 1, name: 'high',    yMinPct: 0.12, yMaxPct:0.35, anchorY: null  },
  { id: 2, name: 'mid',     yMinPct: 0.35, yMaxPct:0.55, anchorY: null  },
  { id: 3, name: 'low',     yMinPct: 0.55, yMaxPct:0.80, anchorY: null  },
  { id: 4, name: 'floor',   yMinPct: 0.80, yMaxPct:1.0,  anchorY:'bottom'}
];

/** 速度配置（原始 Walk=-2 / Run=-4 / Dash=-8，保持比例 1:2:4）*/
var SPEED = {
  walk: 1.5,     // px/frame @60fps → ~90px/s
  run:  3.0,     // px/frame → ~180px/s
  dash: 6.0,     // px/frame → ~360px/s
};

/** 帧切换时间（ms per frame）— 第二章换算说明 */
var FRAME_DURATION = {
  walk: 140,      // 走路每帧切换时间
  run:  90,       // 奔跑每帧切换时间
  dash: 60,       // 冲刺每帧切换时间
  ha:    5,       // HA!转头每帧(原始5ms!但网页用5太快→实际靠GSAP控制总时长)
  climb: 40,      // 攀爬每pose时间(ms)
  climbPause: 160,// 攀爬中间停顿
  wiggle: 200,    // 扭屁股每帧
};

/**
 * 音效映射 — 第七章规范（修正旧版 eat → ha）
 * 覆盖全部行为场景
 */
var SOUND_MAP = {
  start:  { file: '/assets/sounds/start.wav',  volume: 0.3,  priority: 1 },
  ha:     { file: '/assets/sounds/5.wav',     volume: 0.85, priority: 3 }, // 最高优先级
  double: { file: '/assets/sounds/double.wav', volume: 0.6,  priority: 2 },
  sit:    { file: '/assets/sounds/sit.wav',    volume: 0.5,  priority: 0 }, // 可叠加
};

/**
 * 各 Rail 的候选行为池配置 — 第五章
 * 直接对应 behaviors.xml 中的 <Behavior> 定义
 */
var BEHAVIOR_POOLS = {

  // ===== Rail 4 (地板) =====
  4: {
    idleBehaviors: [
      { name: 'StandUp',     frequency: 200 },
      { name: 'SitDown',     frequency: 200 }
    ],
    activeBehaviors: [
      { name: 'WalkAndGrabLeftWall',  frequency: 100 },
      { name: 'WalkAndGrabRightWall', frequency: 100 },
      { name: 'WalkLeftAndSit_Fast',   frequency: 100 },
      { name: 'WalkRightAndSit_Fast',  frequency: 100 },
      { name: 'CrawlAlongFloor',      frequency: 10  },
      { name: 'StartleJumpDown',      frequency: 15  }
    ],
    sitNextBehaviors: [
      { name: 'SitWhileDanglingLegs', frequency: 100 },
      { name: 'LieDown',               frequency: 100 }
    ],
    lieNextBehaviors: [
      { name: 'SitDown',         frequency: 100 },
      { name: 'CrawlAlongFloor', frequency: 100 }
    ]
  },

  // ===== Rail 0 (天花板) =====
  0: {
    behaviors: [
      { name: 'HoldOntoCeiling',   frequency: 100 },
      { name: 'FallFromCeiling',   frequency: 50  },
      { name: 'CrawlAlongCeiling', frequency: 100 }
    ]
  },

  // ===== 墙壁上 =====
  wall: {
    behaviors: [
      { name: 'HoldOntoWall',  frequency: 100 },
      { name: 'FallFromWall',  frequency: 50  },
      { name: 'ClimbHalfway',  frequency: 100 },
      { name: 'ClimbFull',     frequency: 100 }
    ]
  },

  // ===== 边缘碰撞 A 轨选择 =====
  edgeBump: [
    { name: 'WallBump_Hard',   frequency: 60 },
    { name: 'WallBump_Soft',   frequency: 25 },
    { name: 'StartleFall',     frequency: 15 }
  ]
};


// ============================================================
//  SECTION 1: 工具函数
// ============================================================

/** 获取某条 Rail 的中心 Y 坐标（像素值）*/
function getRailCenterY(railId) {
  var rail = RAILS[railId];
  if (!rail) return window.innerHeight * 0.9;
  return window.innerHeight * (rail.yMinPct + rail.yMaxPct) / 2;
}

/** 判断一个 Y 像素值属于哪条 Rail */
function getRailFromY(yPx) {
  var h = window.innerHeight;
  var pct = yPx / h;
  for (var i = 0; i < RAILS.length; i++) {
    if (pct >= RAILS[i].yMinPct && pct < RAILS[i].yMaxPct) return i;
  }
  return 4; // 默认地板
}

/**
 * 从可用行为列表中按频度加权随机选一个
 * 直接翻译自原始 Shimeji Java 引擎的选择逻辑
 */
function selectBehavior(candidates, conditions) {
  if (!candidates || candidates.length === 0) return null;

  // 过滤: 只保留满足条件的候选者
  var valid = candidates.filter(function(b) {
    if (conditions && b.condition && !b.condition(conditions)) return false;
    if (b.hidden) return false;
    return true;
  });

  if (valid.length === 0) return null;

  // 计算总权重
  var totalWeight = 0;
  for (var i = 0; i < valid.length; i++) {
    totalWeight += valid[i].frequency;
  }

  // 加权随机掷骰
  var roll = Math.random() * totalWeight;
  var cumulative = 0;
  for (var j = 0; j < valid.length; j++) {
    cumulative += valid[j].frequency;
    if (roll < cumulative) {
      return valid[j].name;
    }
  }

  return valid[valid.length - 1]; // 兜底
}


// ============================================================
//  SECTION 2: USAGICHARACTER 主类
// ============================================================

export class UsagiCharacter {
  constructor(options) {
    options = options || {};

    // ---- DOM 引用 ----
    this.spriteEl = document.getElementById('usagi-character');
    this.imgEl = document.getElementById('usagi-sprite');
    if (!this.spriteEl || !this.imgEl) {
      console.warn('[Usagi-v4] DOM elements not found');
      return;
    }

    // ---- 位置与 Rail 状态 ----
    this.x = 0;
    this.y = 0;
    this.currentRail = 4;        // 默认在 Rail 4（地板）
    this.facingRight = true;     // 方向标志
    this.isOnWall = false;       // 是否在墙上（B轨攀爬中）
    this.isOnCeiling = false;    // 是否在天花板上
    this.wallSide = null;        // 'left' | 'right' | null

    // ---- 动画状态 ----
    this.currentFrame = 1;
    this.animTimers = [];        // 所有活动定时器句柄（用于取消）
    this.gsapTweens = [];        // 所有活动 GSAP 补间（用于取消）

    // ---- 行为状态机 ----
    this.currentBehavior = null; // 当前正在执行的行为名
    this.behaviorState = {};     // 行为执行进度暂存
    this.isInteracting = false;  // 是否正处于交互行为(HA/EAT/PEEK)中
    this.pausedBehavior = null;  // 被中断暂停的行为暂存
    this.behaviorLoopTimer = null; // 行为选择循环定时器

    // ---- 上下文感知（★新增：解决"爬墙后撅屁股"问题）----
    this.lastBehaviorType = null;   // 上一个行为的类别: 'idle'|'walk'|'climb'|'fall'|'sit'|'interaction'
    this.lastBehaviorName = null;   // 上一个行为名（用于日志）
    this.behaviorStreak = 0;        // 同类行为连续次数（防止连续太多次同类）

    // ---- 冷却计时器 ----
    this.cooldowns = {
      lieDown: 0,       // LieDown 冷却时间戳
      startleJump: 0,   // 受惊跳冷却
      haCombo: 0,       // HA!连击冷却
    };

    // ---- 交互计数器 ----
    this.haClickCount = 0;       // HA!连续点击次数
    this.lastHaClickTime = 0;    // 上次HA!点击时间
    this.peekStartTime = 0;      // 偷看开始时间

    // ---- 拖拽状态 ----
    this.isDragging = false;
    this.dragStartX = 0;         // 鼠标按下时的屏幕坐标
    this.dragStartY = 0;
    this.dragUsagiStartX = 0;    // 乌萨奇拖拽开始位置
    this.dragUsagiStartY = 0;
    this.lastDragX = 0;          // 上一帧鼠标坐标（算速度用）
    this.lastDragY = 0;
    this.lastDragTime = 0;       // 上一帧时间戳（算速度用）
    this.dragVelocityX = 0;      // 当前X速度 px/ms
    this.dragVelocityY = 0;      // 当前Y速度
    this._dragMoveRAF = null;    // drag 中的 requestAnimationFrame ID
    this._rafIds = [];            // ★ 所有活动 requestAnimationFrame 句柄（用于取消）

    // ---- 预加载音效 ----
    this.audioCache = {};
    this._preloadSounds();

    // ---- 初始化 ----
    this.setFrame(1);
    this._initPosition();
    this._bindEvents();
    this._applyRailAnchor();

    console.log('[Usagi-v4] Initialized on Rail', this.currentRail,
      'at (' + Math.round(this.x) + ', ' + Math.round(this.y) + ')');

    // 启动行为引擎
    this._startBehaviorEngine();
  }


  // ==================== 2.1 位置管理 ====================

  /** 初始化位置到 Rail 4 中下方 */
  _initPosition() {
    this.currentRail = 4;
    this.x = window.innerWidth * 0.5;
    this.y = getRailCenterY(4);
    this.facingRight = Math.random() > 0.5;
    this._updateDOMPosition();
    this._updateFacing();
  }

  /** 更新 DOM 元素位置 */
  _updateDOMPosition() {
    this.spriteEl.style.left = this.x + 'px';
    var rail = RAILS[this.currentRail];
    if (rail && rail.anchorY === 'top') {
      this.spriteEl.style.top = this.y + 'px';
      this.spriteEl.style.bottom = 'auto';
    } else if (rail && rail.anchorY === 'bottom') {
      this.spriteEl.style.bottom = (window.innerHeight - this.y) + 'px';
      this.spriteEl.style.top = 'auto';
    } else {
      this.spriteEl.style.top = this.y + 'px';
      this.spriteEl.style.bottom = 'auto';
    }
  }

  /** 根据 Rail 类型应用锚点 CSS */
  _applyRailAnchor() {
    var rail = RAILS[this.currentRail];
    if (!rail) return;

    // 清除所有锚点相关 class
    this.spriteEl.classList.remove('usagi-on-ceiling', 'usagi-on-floor', 'usagi-in-midair');

    if (this.currentRail === 0) {
      this.spriteEl.classList.add('usagi-on-ceiling');
      // 天花板倒挂：翻转
      this.imgEl.style.transform = 'rotate(180deg)';
    } else if (this.currentRail === 4) {
      this.spriteEl.classList.add('usagi-on-floor');
      this.imgEl.style.transform = '';
    } else {
      this.spriteEl.classList.add('usagi-in-midair');
      this.imgEl.style.transform = '';
    }
  }

  /** 更新方向（CSS class + scaleX 翻转）
   * ★ 修正：原始精灵图[1]脸朝左，scaleX(1)=朝左, scaleX(-1)=朝右 */
  _updateFacing() {
    if (this.facingRight) {
      this.spriteEl.classList.remove('usagi-facing-left');
      this.spriteEl.classList.add('usagi-facing-right');
      // facingRight = 脸朝右 → 需要翻转原始图
      this.imgEl.style.transform = this.currentRail === 0
        ? 'rotate(180deg) scaleX(-1)' : 'scaleX(-1)';
    } else {
      this.spriteEl.classList.remove('usagi-facing-right');
      this.spriteEl.classList.add('usagi-facing-left');
      // facingLeft = 脸朝左 → 不翻转原始图
      this.imgEl.style.transform = this.currentRail === 0
        ? 'rotate(180deg) scaleX(1)' : 'scaleX(1)';
    }
  }

  /** 设置当前 Rail 并更新锚点（★自动恢复朝向，不丢失翻转！）*/
  _setRail(railId) {
    this.currentRail = railId;
    this.isOnWall = false;
    this.isOnCeiling = (railId === 0);
    this.wallSide = null;
    this._applyRailAnchor();
    this._updateFacing(); // ★ 锚点变换后立即重置朝向！
  }

  /**
   * 获取乌萨奇屏幕位置（供外部模块使用）
   * 保持与旧版 API 兼容
   */
  getPosition() {
    var rect = this.spriteEl.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  }


  // ==================== 2.2 帧控制 ====================

  /** 设置显示帧 */
  setFrame(frameNum) {
    this.imgEl.src = '/assets/usagi/shime' + frameNum + '.png';
    this.currentFrame = frameNum;
  }

  /**
   * 播放帧序列动画
   * @param {number[]} frames - 帧号数组
   * @param {number} durationMs - 每帧持续时间(ms)
   * @param {function} onComplete - 完成回调
   * @returns {number} 定时器ID（可用于取消）
   */
  playFrameSequence(frames, durationMs, onComplete) {
    if (!frames || frames.length === 0) {
      if (onComplete) onComplete();
      return null;
    }

    var idx = 0;
    var self = this;
    var totalDuration = frames.length * durationMs;

    var timer = setInterval(function() {
      if (idx >= frames.length) {
        clearInterval(timer);
        self._removeAnimTimer(timer);
        if (onComplete) onComplete();
        return;
      }
      self.setFrame(frames[idx]);
      idx++;
    }, durationMs);

    this._addAnimTimer(timer);

    // 安全超时：强制结束
    var safetyTimeout = setTimeout(function() {
      clearInterval(timer);
      self._removeAnimTimer(timer);
      self._removeAnimTimer(safetyTimeout);
      if (onComplete) onComplete();
    }, Math.max(totalDuration + 500, 5000));
    this._addAnimTimer(safetyTimeout);

    return timer;
  }

  /** 取消所有进行中的帧动画（★ 包括 rAF / setInterval / setTimeout / GSAP）*/
  _cancelAllAnimations() {
    // 1. clearInterval / clearTimeout
    for (var i = this.animTimers.length - 1; i >= 0; i--) {
      clearInterval(this.animTimers[i]);
      clearTimeout(this.animTimers[i]);
    }
    this.animTimers = [];

    // 2. ★ cancelAnimationFrame（rAF 句柄必须用专用 API 取消！）
    for (var j = this._rafIds.length - 1; j >= 0; j--) {
      cancelAnimationFrame(this._rafIds[j]);
    }
    this._rafIds = [];

    // 3. GSAP tweens
    for (var k = this.gsapTweens.length - 1; k >= 0; k--) {
      if (this.gsapTweens[k] && this.gsapTweens[k].kill) {
        this.gsapTweens[k].kill();
      }
    }
    this.gsapTweens = [];
  }


  // ==================== 2.3 音效系统 ====================

  /** 预加载所有音效 */
  _preloadSounds() {
    var self = this;
    Object.keys(SOUND_MAP).forEach(function(key) {
      var cfg = SOUND_MAP[key];
      var audio = new Audio(cfg.file);
      audio.volume = cfg.volume;
      audio.preload = 'auto';
      self.audioCache[key] = audio;
    });
  }

  /**
   * 播放音效（带优先级控制 — 第七章约束）
   * @param {string} name - 音效名 (start/ha/double/sit)
   * @param {object} opts - 可选 {volume, override}
   */
  playSound(name, opts) {
    opts = opts || {};
    var cfg = SOUND_MAP[name];
    if (!cfg) return;

    var audio = this.audioCache[name];
    if (!audio) return;

    audio.volume = opts.volume || cfg.volume;

    // 同类音效不重叠检查
    if (!opts.override && !audio.ended && audio.currentTime > 0) {
      return; // 已在播放同类音效，不重复触发
    }

    audio.currentTime = 0;
    audio.play().catch(function() {
      // 浏览器可能阻止自动播放
    });
  }

  /** 检查某音效是否正在播放 */
  _isSoundPlaying(name) {
    var audio = this.audioCache[name];
    return audio && !audio.paused && audio.currentTime > 0 && !audio.ended;
  }


  // ==================== 2.4 事件绑定 ====================

  _bindEvents() {
    var self = this;

    // 点击 → ACTION_HA（拖拽时不算点击）
    this.spriteEl.addEventListener('click', function(e) {
      if (!self.isDragging) self._onActionHa(e);
    });

    // 触摸端 → ACTION_HA
    this.spriteEl.addEventListener('touchend', function(e) {
      e.preventDefault();
      if (!self._wasDraggingTouch) self._onActionHa(e);
      self._wasDraggingTouch = false;
    });

    // ===== 拖拽事件 =====
    // 鼠标按下 → 开始拖
    this.spriteEl.addEventListener('mousedown', function(e) {
      // 左键才触发拖拽
      if (e.button !== 0) return;
      e.preventDefault();
      self._onDragStart(e.clientX, e.clientY);
    });

    // 触摸开始
    this.spriteEl.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      self._onDragStart(t.clientX, t.clientY);
    }, { passive: false });

    // 全局鼠标移动/释放
    document.addEventListener('mousemove', function(e) {
      if (self.isDragging) self._onDragMove(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', function(e) {
      if (self.isDragging) self._onDragEnd();
    });

    // 全局触摸移动/结束
    document.addEventListener('touchmove', function(e) {
      if (self.isDragging && e.touches.length === 1) {
        e.preventDefault(); // 阻止滚动
        self._wasDraggingTouch = true;
        var t = e.touches[0];
        self._onDragMove(t.clientX, t.clientY);
      }
    }, { passive: false });
    document.addEventListener('touchend', function(e) {
      if (self.isDragging) self._onDragEnd();
    });

    // 窗口缩放
    window.addEventListener('resize', function() {
      self.handleResize();
    });

    // 页面可见性变化 → 性能保护
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        self._onPageHidden();
      } else {
        self._onPageVisible();
      }
    });
  }

  /** 窗口 resize 处理 — 重算 Rail Y 范围并钳位 */
  handleResize() {
    // 更新当前位置到新 Rail 中心Y
    if (!this.isOnWall && !this.isInteracting) {
      var newY = getRailCenterY(this.currentRail);
      this.y = newY;
      this._updateDOMPosition();
    }
  }

  /** 页面隐藏时降低活跃度 */
  _onPageHidden() {
    // 暂停行为选择循环
    if (this.behaviorLoopTimer) {
      clearTimeout(this.behaviorLoopTimer);
    }
  }

  /** 页面恢复时重启行为选择 */
  _onPageVisible() {
    if (!this.isInteracting) {
      this._scheduleNextBehavior(500); // 短延迟后重新选择行为
    }
  }


  // ==================== 2.5 定时器管理 ====================

  _addAnimTimer(timer) {
    this.animTimers.push(timer);
  }

  _removeAnimTimer(timer) {
    var idx = this.animTimers.indexOf(timer);
    if (idx !== -1) {
      this.animTimers.splice(idx, 1);
    }
  }

  _addGsapTween(tween) {
    this.gsapTweens.push(tween);
  }

  /** ★ 追踪 requestAnimationFrame 句柄（rAF 不能用 clearInterval/clearTimeout 取消！）*/
  _addRafId(rafId) {
    this._rafIds.push(rafId);
  }

  /** 安全的 delay 封装（记录 timer 以便取消）*/
  _delay(ms, callback) {
    var self = this;
    var timer = setTimeout(function() {
      self._removeAnimTimer(timer);
      callback();
    }, ms);
    this._addAnimTimer(timer);
    return timer;
  }


  // ============================================================
  //  SECTION 3: 行为引擎（状态机核心）
  // ============================================================

  /** 启动行为选择循环 */
  _startBehaviorEngine() {
    var self = this;
    this._behaviorTickCount = 0; // 行为计数器（用于首几次强制走动）
    this._scheduleNextBehavior(300);
  }

  /** 安排下一个行为选择 */
  _scheduleNextBehavior(delayMs) {
    var self = this;
    delayMs = delayMs || 1000;

    this.behaviorLoopTimer = this._delay(delayMs, function() {
      // 交互期间不选新行为 → 短时间后重试（不丢弃！）
      if (self.isInteracting) {
        self._scheduleNextBehavior(500);
        return;
      }
      self._executeBehavior();
    });
  }

  /**
   * 行为执行入口 — SELECT → ENTER → RUN → COMPLETE → NEXT
   * ★重写：上下文感知选择，防止不合理的动作衔接
   */
  _executeBehavior() {
    this._behaviorTickCount = (this._behaviorTickCount || 0) + 1;
    var forceActive = this._behaviorTickCount <= 3; // 前3次强制走动

    var behaviorName;

    // 如果已经在墙上或天花板上，使用特殊池子
    if (this.isOnWall) {
      behaviorName = selectBehavior(BEHAVIOR_POOLS.wall.behaviors);
    } else if (this.currentRail === 0) {
      behaviorName = selectBehavior(BEHAVIOR_POOLS[0].behaviors);
    } else if (this.currentRail === 4) {
      // ★ Rail 4: 根据上下文选择！
      var lastType = this.lastBehaviorType;

      // 刚从墙上/天花板下来 → 先恢复（站立发呆），不要直接坐下或爬行
      if ((lastType === 'climb' || lastType === 'fall' || lastType === 'wall') && !forceActive) {
        // 60% 站立恢复, 30% 走动, 10% 坐下
        var r = Math.random();
        if (r < 0.6) {
          behaviorName = 'StandUp';
        } else if (r < 0.9) {
          behaviorName = Math.random() > 0.5 ? 'WalkLeftAndSit_Fast' : 'WalkRightAndSit_Fast';
        } else {
          behaviorName = 'SitDown';
        }
      } else if (forceActive) {
        // 前3次强制走动
        var walkChoices = ['WalkLeftAndSit_Fast', 'WalkRightAndSit_Fast',
          'WalkAndGrabLeftWall', 'WalkAndGrabRightWall'];
        behaviorName = walkChoices[Math.floor(Math.random() * walkChoices.length)];
      } else {
        // 正常情况：主动行为优先，但给待机一定概率
        behaviorName = selectBehavior(BEHAVIOR_POOLS[4].activeBehaviors);
        if (!behaviorName) {
          behaviorName = selectBehavior(BEHAVIOR_POOLS[4].idleBehaviors);
        }
      }
    } else {
      // 中间层(Rail 1/2/3): 必须回地板或继续下落
      if (forceActive) {
        behaviorName = Math.random() > 0.5 ? 'FallFromCeiling' : 'SitDown';
      } else {
        behaviorName = 'FallFromCeiling'; // 中间层一律掉下去，不要在半空发呆
      }
    }

    // 最终兜底
    if (!behaviorName) {
      behaviorName = 'StandUp';
    }

    // 执行行为
    this.currentBehavior = behaviorName;
    console.log('[Usagi-v4] #' + this._behaviorTickCount + ' Run:', behaviorName,
      '| Rail:', this.currentRail, '@ (' + Math.round(this.x) + ',' + Math.round(this.y) + ')',
      '| last:', this.lastBehaviorType);
    this._runBehavior(behaviorName);
  }

  /**
   * 运行具体行为 — 分发到各实现方法
   */
  _runBehavior(name) {
    var self = this;

    console.log('[Usagi-v4] Run:', name, '| Rail:', this.currentRail);

    switch (name) {

      // ----- 待机 -----
      case 'StandUp':
        this._behStandUp();
        break;
      case 'SitDown':
        this._behSitDown();
        break;

      // ----- Sit 的 NextBehavior 链 -----
      case 'SitWhileDanglingLegs':
        this._behDangleLegs();
        break;
      case 'LieDown':
        this._behLieDown();
        break;

      // ----- LieDown 的 NextBehavior 链 -----
      case 'CrawlAlongFloor':
        this._behCreep();
        break;

      // ----- 主动运动 -----
      case 'WalkAndGrabLeftWall':
        this._behWalkAndGrabWall('left');
        break;
      case 'WalkAndGrabRightWall':
        this._behWalkAndGrabWall('right');
        break;
      case 'WalkLeftAndSit_Fast':
        this._behWalkAndSit('left', true);
        break;
      case 'WalkRightAndSit_Fast':
        this._behWalkAndSit('right', true);
        break;

      // ----- 特殊 -----
      case 'StartleJumpDown':
        this._behStartleJump();
        break;

      // ----- 墙壁行为 -----
      case 'HoldOntoWall':
        this._behHoldWall();
        break;
      case 'FallFromWall':
        this._behFallFromWall();
        break;
      case 'ClimbHalfway':
        this._behClimbWall(false); // 爬一半
        break;
      case 'ClimbFull':
        this._behClimbWall(true);  // 爬到顶
        break;

      // ----- 天花板行为 -----
      case 'HoldOntoCeiling':
        this._behHoldCeiling();
        break;
      case 'FallFromCeiling':
        this._behFallFromCeiling();
        break;
      case 'CrawlAlongCeiling':
        this._behCrawlCeiling();
        break;

      // ----- 边缘 A 轨 -----
      case 'WallBump_Hard':
        this._behWallBump('hard');
        break;
      case 'WallBump_Soft':
        this._behWallBump('soft');
        break;

      default:
        console.warn('[Usagi-v4] Unknown behavior:', name);
        this._behStandUp();
    }
  }

  /**
   * 行为完成后的下一步选择（★重写：上下文感知 + 节奏控制）
   * @param {string|null} nextChainName - NextBehavior链名称 (sitNext/lieNext)
   * @param {string} behType - 当前行为类别: 'idle'|'walk'|'climb'|'fall'|'sit'|'wall'
   */
  _onBehaviorComplete(nextChainName, behType) {
    var self = this;

    // ★ 记录上下文
    if (behType) {
      this.lastBehaviorType = behType;
      this.lastBehaviorName = this.currentBehavior;
    }

    if (nextChainName) {
      // 有 NextBehavior 链 → 从链中选择
      var chainPool;
      if (nextChainName === 'sitNext') {
        chainPool = BEHAVIOR_POOLS[4].sitNextBehaviors;
      } else if (nextChainName === 'lieNext') {
        chainPool = BEHAVIOR_POOLS[4].lieNextBehaviors;
      }

      if (chainPool) {
        var nextBeh = selectBehavior(chainPool);
        if (nextBeh) {
          this.currentBehavior = nextBeh;
          // ★ 链式转换也要有呼吸感：400~800ms 延迟
          this._delay(400 + Math.random() * 400, function() { self._runBehavior(nextBeh); });
          return;
        }
      }
    }

    // ★ 根据上一个行为类型决定"喘息时间"
    var pauseMs = this._getContextPause(behType);

    this._scheduleNextBehavior(pauseMs);
  }

  /**
   * ★ 根据上下文计算合理的动作间隔
   */
  _getContextPause(lastType) {
    switch (lastType) {
      case 'climb': return 1200 + Math.random() * 1500; // 攀爬后要喘: 1.2~2.7s
      case 'fall':  return 1000 + Math.random() * 1000; // 落地后缓: 1~2s
      case 'wall':  return 800 + Math.random() * 800;   // 墙上动作后: 0.8~1.6s
      case 'walk':  return 600 + Math.random() * 600;   // 走完后: 0.6~1.2s
      case 'sit':   return 500 + Math.random() * 700;   // 坐姿后: 0.5~1.2s
      case 'idle':  return 800 + Math.random() * 1200;  // 发呆后: 0.8~2s（慢节奏）
      default:      return 1000 + Math.random() * 1000; // 默认: 1~2s
    }
  }


  // ============================================================
  //  SECTION 4: 待机行为实现（Rail 4 对应原始 Floor 条件门控）
  // ============================================================

  /** StandUp: 站立发呆 [1]（★ 加长：这是待机，应该多停一会儿）*/
  _behStandUp() {
    this._setRail(4);
    this.setFrame(1);
    // ★ 待机时长：2~4秒（之前0.5~1.5s太短了！）
    var duration = 2000 + Math.random() * 2000;

    var self = this;
    this._delay(duration, function() {
      self._onBehaviorComplete(null, 'idle');
    });
  }

  /** SitDown: 坐下发呆 [11] → NextBehavior: Dangle/LieDown */
  _behSitDown() {
    this._setRail(4);
    this.setFrame(11);
    // ★ 坐下停留：1.5~3秒
    var duration = 1500 + Math.random() * 1500;

    var self = this;
    this._delay(duration, function() {
      self._onBehaviorComplete('sitNext', 'sit');
    });
  }

  /** SitWhileDanglingLegs: 坐着晃腿 [31]→[32]→[31]→[33] */
  _behDangleLegs() {
    this.playFrameSequence(SPRITE_GROUPS.dangleLegs, 200, function() {
      // 晃完一轮后回到 Sit 或继续晃
    }.bind(this));

    // 总时长约 1600ms 后进入下一步（加长）
    var self = this;
    this._delay(1600, function() {
      // 30% 概率再晃一轮，70% 进入 lieNext
      if (Math.random() < 0.3) {
        self._behDangleLegs();
      } else {
        self._onBehaviorComplete('lieNext', 'sit');
      }
    });
  }

  /** LieDown: 躺平 [21] — 极稀有，带全局冷却 */
  _behLieDown() {
    var now = Date.now();
    if (now < this.cooldowns.lieDown) {
      this._behSitDown(); // 冷却中改做别的
      return;
    }

    this._setRail(4);
    this.setFrame(21);
    this.cooldowns.lieDown = now + 90000 + Math.random() * 90000; // 90~180s 冷却

    var self = this;
    // ★ 躺平时长：3~5秒（稀有行为要让人看到！）
    this._delay(3000 + Math.random() * 2000, function() {
      self._onBehaviorComplete('lieNext', 'sit');
    });
  }


  // ============================================================
  //  SECTION 5: 复合行为 & 主动运动（Rail 4 地板动作）
  // ============================================================

  /**
   * WalkAndSit: 走一段 → 停 → 转 → 坐
   * @param {string} direction - 'left' | 'right'
   * @param {boolean} useRun - 是否用 Run 速度
   */
  _behWalkAndSit(direction, useRun) {
    var self = this;
    this._setRail(4);
    this.facingRight = (direction === 'right');
    this._updateFacing();

    var speed = useRun ? SPEED.run : SPEED.walk;
    var targetX = direction === 'right'
      ? this.x + 120 + Math.random() * 180  // 向右走 120~300px
      : this.x - 120 - Math.random() * 180; // 向左走 120~300px

    // 钳位到屏幕范围
    var spriteW = this.imgEl.width || 128;
    targetX = Math.max(10, Math.min(window.innerWidth - spriteW - 10, targetX));

    // Step 1: 奔跑过去
    this._horizontalMove(targetX, speed, SPRITE_GROUPS.walk, useRun ? FRAME_DURATION.run : FRAME_DURATION.walk, function() {

      // Step 2: 短暂站立
      self.setFrame(1);
      self._delay(200 + Math.random() * 300, function() {

        // Step 3: 转向（朝另一边看）
        self.facingRight = !self.facingRight;
        self._updateFacing();

        // Step 4: 坐下
        self.setFrame(11);
        self._delay(400 + Math.random() * 600, function() {
          self._onBehaviorComplete(null, 'walk');
        });
      });
    });
  }

  /**
   * WalkAndGrabWall: 跑到墙边 → 攀爬
   * 对应原始 WalkAndGrabLeftWall / WalkAndGrabRightWall
   * 这是进入 B 轨的唯一入口
   */
  _behWalkAndGrabWall(side) {
    var self = this;
    this._setRail(4);
    this.facingRight = (side === 'left'); // 面朝墙的方向
    this._updateFacing();

    var spriteW = this.imgEl.width || 128;
    var targetX = side === 'left' ? 0 : window.innerWidth - spriteW;

    // 用 Run 速度跑到墙边
    this._horizontalMove(targetX, SPEED.run, SPRITE_GROUPS.walk, FRAME_DURATION.run, function() {
      // 到达墙边 → 进入 B 轨抓墙
      self.wallSide = side;
      self.isOnWall = true;
      self._behGrabWall();
    });
  }

  /** Creep 爬行: [20]→[21] 加减速物理感 — 精确还原原始时间线 */
  _behCreep() {
    var self = this;
    this._setRail(4);
    this.facingRight = Math.random() > 0.5;
    this._updateFacing();

    // 爬行摩擦声
    if (Math.random() > 0.5) this.playSound('start', { volume: 0.15 });

    var speed = SPEED.walk * 0.5; // 爬行速度是走路的一半
    var distance = 80 + Math.random() * 120; // 爬行距离
    var targetX = this.facingRight
      ? this.x + distance : this.x - distance;
    var spriteW = this.imgEl.width || 128;
    targetX = Math.max(10, Math.min(window.innerWidth - spriteW - 10, targetX));

    // 原始 Creep 时间线精确还原（第二章）:
    // 阶段1: [20] 准备 150ms
    // 阶段2: [20] 发力移动 60ms
    // 阶段3: [21] 滑行 60ms
    // 阶段4: [21] 减速 60ms
    // 阶段5: [21] 停下 150ms
    // 总计 ~480ms 一个周期，可以重复多轮

    var crawlRounds = 1 + Math.floor(Math.random() * 3); // 1~3轮
    var currentRound = 0;
    var currentX = this.x;

    function doCrawlRound() {
      if (currentRound >= crawlRounds) {
        // 爬完所有轮次 → 必接 LieDown（原始定义！）
        self._delay(300, function() {
          self._onBehaviorComplete('lieNext');
        });
        return;
      }

      // Phase 1: 准备
      self.setFrame(20);
      currentX = self.x;

      self._delay(150, function() {
        // Phase 2: 发力 [20]
        currentX += self.facingRight ? speed * 0.06 : -speed * 0.06; // 60ms
        self.x = currentX;
        self._updateDOMPosition();
        self._delay(60, function() {

          // Phase 3: 滑行 [21]
          self.setFrame(21);
          currentX += self.facingRight ? speed * 0.06 : -speed * 0.06;
          self.x = currentX;
          self._updateDOMPosition();
          self._delay(60, function() {

            // Phase 4: 减速
            currentX += self.facingRight ? speed * 0.03 : -speed * 0.03;
            self.x = currentX;
            self._updateDOMPosition();
            self._delay(60, function() {

              // Phase 5: 停下
              self._delay(150, function() {
                currentRound++;
                doCrawlRound();
              });
            });
          });
        });
      });
    }

    doCrawlRound();
  }

  /** StartleJumpDown: 受惊向下跳 [4] → Falling → 落地 */
  _behStartleJump() {
    var now = Date.now();
    if (now < this.cooldowns.startleJump) {
      this._behStandUp(); // 冷却中改做别的
      return;
    }
    this.cooldowns.startleJump = now + 10000; // 10s 冷却

    var self = this;
    var targetRail = Math.min(this.currentRail + 1, 4); // 往下一层
    if (targetRail === this.currentRail) targetRail = 4; // 至少落到地板

    var targetY = getRailCenterY(targetRail);

    // [4] 翻白眼
    this.setFrame(4);
    this.playSound('start', { volume: 0.3 });

    this._delay(150, function() {
      // GSAP 自由落体
      self._gsapFallTo(targetY, targetRail, function() {
        // [11] 坐着落地
        self.setFrame(11);
        self.playSound('sit', { volume: 0.4 });
        self._delay(400, function() {
          // [1] 站起
          self.setFrame(1);
          self._delay(300, function() {
            self._onBehaviorComplete(null, 'fall');
          });
        });
      });
    });
  }


  // ============================================================
  //  SECTION 6: 移动原语（被多个行为复用的底层操作）
  // ============================================================

  /**
   * 水平移动到目标 X（帧动画驱动）
   * @param {number} targetX - 目标 X
   * @param {number} speed - px/frame
   * @param {number[]} frames - 帧序列
   * @param {number} frameDuration - 每帧ms（★实际使用！不再忽略）
   * @param {function} onComplete - 到达回调
   */
  _horizontalMove(targetX, speed, frames, frameDuration, onComplete) {
    var self = this;
    var frameIdx = 0;
    var lastFrameTime = 0; // 上次切帧的时间戳

    // 边缘检测：如果在移动过程中碰到了边缘，触发 A 轨
    function step(timestamp) {
      var dx = targetX - self.x;
      var dist = Math.abs(dx);

      if (dist < speed) {
        // 到达目标
        self.x = targetX;
        self._updateDOMPosition();
        self.setFrame(1);
        if (onComplete) onComplete();
        return;
      }

      // 检测是否碰到边缘
      var spriteW = self.imgEl.width || 128;
      var atEdge = (self.x <= 5 && !self.facingRight) ||
                   (self.x >= window.innerWidth - spriteW - 5 && self.facingRight);

      if (atEdge && !self.isOnWall) {
        // 触发边缘 A 轨选择
        self.setFrame(1);
        self._handleEdgeArrival(onComplete);
        return;
      }

      // 正常移动一帧
      self.x += (dx > 0 ? 1 : -1) * speed;
      self._updateDOMPosition();

      // ★ 按 frameDuration 切换行走帧（不再每 rAF 都切！）
      if (!lastFrameTime || timestamp - lastFrameTime >= frameDuration) {
        self.setFrame(frames[frameIdx % frames.length]);
        frameIdx++;
        lastFrameTime = timestamp;
      }

      // 继续下一步
      var rafId = requestAnimationFrame(step);
      self._addRafId(rafId); // ★ 用专用方法追踪 rAF，确保能被取消
    }

    requestAnimationFrame(step);
  }

  /**
   * 处理到达边缘时的路由（A轨 vs B轨判断）
   * 关键逻辑：取决于到达方式（被动碰 vs 主动走向）
   */
  _handleEdgeArrival(originalOnComplete) {
    // 这里需要区分是被动走到还是主动走向
    // 主动走向（WalkAndGrabWall）会在调用前设置意图标记
    if (this._intentionalClimb) {
      this._intentionalClimb = false;
      // B 轨 → 抓墙
      if (originalOnComplete) originalOnComplete();
      return;
    }

    // 被动碰到边缘 → A 轨撞墙选择
    var bumpChoice = selectBehavior(BEHAVIOR_POOLS.edgeBump);
    if (bumpChoice) {
      this._runBehavior(bumpChoice);
      // 原来的完成回调不再执行（被边缘行为取代）
    } else {
      // 兜底：简单掉头
      this.facingRight = !this.facingRight;
      this._updateFacing();
      this._onBehaviorComplete(null);
    }
  }


  // ============================================================
  //  SECTION 7: 墙壁双轨系统（第三章 3.3 + 3.3⭐双轨制）
  // ============================================================

  /** GrabWall: 抓住墙壁 [13] + 微颤动 */
  _behGrabWall() {
    this.setFrame(13);
    this.isOnWall = true;
    // 抓墙"啪"
    if (Math.random() > 0.4) this.playSound('sit', { volume: 0.3 });

    // 微颤动效果 ±2px
    var self = this;
    var shakeCount = 0;
    var maxShakes = 8 + Math.floor(Math.random() * 8); // 8~16次

    function doShake() {
      if (shakeCount >= maxShakes) {
        // 颤完 → 选择下一步（爬 or 掉）
        var wallBeh = selectBehavior(BEHAVIOR_POOLS.wall.behaviors.filter(function(b) {
          return b.name !== 'HoldOntoWall'; // 已经在做 Hold 了
        }));
        if (!wallBeh) wallBeh = 'FallFromWall';
        self._runBehavior(wallBeh);
        return;
      }

      var offsetX = (Math.random() - 0.5) * 4;
      self.x += offsetX;
      self._updateDOMPosition();
      shakeCount++;

      self._delay(80 + Math.random() * 40, doShake);
    }

    doShake();
  }

  /** HoldOntoWall: 在墙上发呆/喘息 */
  _behHoldWall() {
    this.setFrame(13);
    // ★ 墙上发呆：1.5~3秒（之前0.5~1.5s太短）
    var duration = 1500 + Math.random() * 1500;
    var self = this;
    this._delay(duration, function() {
      self._onBehaviorComplete(null, 'wall');
    });
  }

  /**
   * ClimbWall: 攀爬 [12][13][14] 三帧循环 + 纯Y轴 + 两段速
   * 核心中的核心 — 精确翻译自原始 XML
   * @param {boolean} toTop - 是否爬到顶部(true=爬到Rail0/1, false=爬一半)
   */
  _behClimbWall(toTop) {
    var self = this;
    this.isOnWall = true;

    // 目标 Rail
    var targetRail = toTop ? (Math.random() > 0.3 ? 0 : 1) : // 70%到天花板 30%到高空
                            2 + Math.floor(Math.random() * 2);   // Rail 2 或 3
    var targetY = getRailCenterY(targetRail);

    // 攀爬一"组" = 8个Pose（第二章精确规格）
    var climbCycle = [
      { frame: 14, vy: 0,    dur: FRAME_DURATION.climbPause }, // 伸展准备
      { frame: 14, vy: -1.5, dur: FRAME_DURATION.climb },       // 慢速伸展爬
      { frame: 12, vy: -1.5, dur: FRAME_DURATION.climb },       // 慢速收手爬
      { frame: 13, vy: -1.5, dur: FRAME_DURATION.climb },       // 慢速抓握爬
      { frame: 13, vy: 0,    dur: FRAME_DURATION.climbPause },  // 中间停顿（喘息）
      { frame: 13, vy: -3,   dur: FRAME_DURATION.climb },       // 快速抓握爬
      { frame: 12, vy: -3,   dur: FRAME_DURATION.climb },       // 快速收手爬
      { frame: 14, vy: -3,   dur: FRAME_DURATION.climb }        // 快速伸展爬
    ];

    var cycleIndex = 0;

    function doClimbStep() {
      // 检查是否已到达目标高度
      if (self.y <= targetY) {
        // 到达目标 → 离开墙壁
        self._leaveWall(targetRail);
        return;
      }

      var step = climbCycle[cycleIndex % climbCycle.length];
      self.setFrame(step.frame);
      self.y += step.vy;
      self._updateDOMPosition();

      cycleIndex++;
      self._delay(step.dur, doClimbStep);
    }

    doClimbStep();
  }

  /** FallFromWall: 从墙松手掉落 */
  _behFallFromWall() {
    var self = this;
    this.playSound('start', { volume: 0.25 });

    var targetRail = 4; // 掉回地板
    var targetY = getRailCenterY(targetRail);

    this._gsapFallTo(targetY, targetRail, function() {
      self._bounceThenStand(); // ★ bounceThenStand 内部会调用 _onBehaviorComplete(null, 'fall')
    });
  }

  /** 离开墙壁，进入目标 Rail（★有过渡动画，不再瞬移！）*/
  _leaveWall(targetRail) {
    this.isOnWall = false;
    this.wallSide = null;
    this._setRail(targetRail);

    var targetY = getRailCenterY(targetRail);
    var self = this;

    // ★ GSAP 过渡动画到目标 Rail Y（不再瞬移！）
    var tween = gsap.to(this, {
      y: targetY,
      duration: 0.4,
      ease: 'power1.out',
      onStart: function() {
        // 离开墙的弹出动量
        var pushDir = self.facingRight ? 30 : -30;
        self.x = Math.max(5, Math.min(window.innerWidth - 138, self.x + pushDir));
        self._updateDOMPosition();
        self.setFrame(4); // 翻滚帧
      },
      onUpdate: function() { self._updateDOMPosition(); },
      onComplete: function() {
        self.setFrame(1); // 稳定后站立
        self._onBehaviorComplete(null, 'climb'); // ★ 标记为攀爬后
      }
    });
    this._addGsapTween(tween);
  }


  // ============================================================
  //  SECTION 8: 边缘 A 轨 — 撞墙反应
  // ============================================================

  /**
   * WallBump: 撞墙反应
   * @param {string} intensity - 'hard' | 'soft'
   */
  _behWallBump(intensity) {
    var self = this;

    if (intensity === 'hard') {
      // 翻白眼硬撞 [9] 或 [10]
      var bumpFrame = this.facingRight ? 9 : 10;
      this.setFrame(bumpFrame);
      this.playSound('sit', { volume: 0.55 }); // 撞击"咚"

      // 弹回 20px + 掉头
      var bounceBack = this.facingRight ? -30 : 30;
      gsap.to(this, {
        x: Math.max(10, Math.min(window.innerWidth - 138, this.x + bounceBack)),
        duration: 0.25,
        ease: 'power2.out',
        onUpdate: function() { self._updateDOMPosition(); },
        onComplete: function() {
          self.facingRight = !self.facingRight;
          self._updateFacing();
          self.setFrame(1);
          self._onBehaviorComplete(null, 'wall');
        }
      });

    } else {
      // 软撞 [19] 或 [22]
      var softFrame = Math.random() > 0.5 ? 19 : 22;
      this.setFrame(softFrame);
      this.playSound('start', { volume: 0.35 });

      this._delay(250, function() {
        self.facingRight = !self.facingRight;
        self._updateFacing();
        self.setFrame(1);
        self._onBehaviorComplete(null, 'wall');
      });
    }
  }


  // ============================================================
  //  SECTION 9: 多 Rail + 天花板系统（第三章 3.4 + 3.5）
  // ============================================================

  /** HoldOntoCeiling: 在天花板发呆 */
  _behHoldCeiling() {
    this._setRail(0);
    this.setFrame(23);
    // ★ 天花板发呆：1.5~3秒
    var duration = 1500 + Math.random() * 1500;
    var self = this;
    this._delay(duration, function() {
      self._onBehaviorComplete(null, 'wall'); // 天花板也算 wall 类
    });
  }

  /** CrawlAlongCeiling: 沿天花板爬行 [23][24][25] + 水平移动 */
  _behCrawlCeiling() {
    var self = this;
    this._setRail(0);
    this.facingRight = Math.random() > 0.5;
    this._updateFacing();

    var spriteW = this.imgEl.width || 128;
    var targetX = this.facingRight
      ? this.x + 100 + Math.random() * 200
      : this.x - 100 - Math.random() * 200;
    targetX = Math.max(5, Math.min(window.innerWidth - spriteW - 5, targetX));

    var ceilingFrames = [23, 24, 23, 25]; // 天花板爬行帧循环
    var fIdx = 0;

    function ceilStep() {
      if (Math.abs(targetX - self.x) < SPEED.walk) {
        self.x = targetX;
        self._updateDOMPosition();
        self._onBehaviorComplete(null, 'wall');
        return;
      }

      self.x += self.facingRight ? SPEED.walk : -SPEED.walk;
      self._updateDOMPosition();
      self.setFrame(ceilingFrames[fIdx % ceilingFrames.length]);
      fIdx++;

      self._delay(FRAME_DURATION.walk, ceilStep);
    }

    ceilStep();
  }

  /** FallFromCeiling: 从天花板掉落回 Rail 4 */
  _behFallFromCeiling() {
    var self = this;
    this.playSound('start', { volume: 0.3 });

    var targetY = getRailCenterY(4);
    this._gsapFallTo(targetY, 4, function() {
      self._bounceThenStand();
    });
  }

  /**
   * GSAP 自由落体动画（通用，被多处调用）
   * @param {number} targetY - 目标 Y 像素
   * @param {number} targetRail - 落到的 Rail ID
   * @param {function} onComplete - 落地回调
   */
  _gsapFallTo(targetY, targetRail, onComplete) {
    var self = this;
    this.setFrame(4); // Falling 帧

    var tween = gsap.to(this, {
      y: targetY,
      duration: 0.6,
      ease: 'power2.in',
      onStart: function() {
        if (!self._isSoundPlaying('start')) {
          self.playSound('start', { volume: 0.3 });
        }
      },
      onUpdate: function() { self._updateDOMPosition(); },
      onComplete: function() {
        self._setRail(targetRail);
        if (onComplete) onComplete();
      }
    });
    this._addGsapTween(tween);
  }

  /** 落地弹跳 → 站立（通用落地处理，★加喘息时间） */
  _bounceThenStand() {
    var self = this;
    var bounceCount = 0;
    var maxBounces = 1 + Math.floor(Math.random() * 3); // 1~3次（减少弹跳次数）

    function doBounce() {
      if (bounceCount >= maxBounces) {
        // ★ 弹完不立刻选下一个行为！先站立喘息
        self.setFrame(1);
        self._delay(1000 + Math.random() * 1000, function() {
          self._onBehaviorComplete(null, 'fall');
        });
        return;
      }

      // [18] ↔ [19] 交替
      self.setFrame(bounceCount % 2 === 0 ? 18 : 19);
      bounceCount++;
      self._delay(120, doBounce); // ★ 每次120ms（之前100ms太快）
    }

    doBounce();
  }


  // ============================================================
  //  SECTION 10: 交互行为 — ACTION_HA（第四章 4.1）
  // ============================================================

  /**
   * 点击 HA! 反应
   * 基于 SitAndSpinHead [26]→[27](sync 5.wav)→[28] + 连击增强
   */
  _onActionHa(e) {
    // 冷却检查
    var now = Date.now();
    if (now < this.cooldowns.haCombo) return; // HA!冷却期内

    // 连击判定
    if (now - this.lastHaClickTime < 1200) {
      this.haClickCount++;
    } else {
      this.haClickCount = 1; // 重置连击
    }
    this.lastHaClickTime = now;

    // 中断当前行为
    this._interruptForInteraction('ha');

    var self = this;

    if (this.haClickCount === 1) {
      // ===== 第1次点击: 标准 HA! =====
      this._doHaStandard();
    } else if (this.haClickCount === 2) {
      // ===== 第2次: 连击增强 =====
      this._doHaCombo2();
    } else if (this.haClickCount === 3) {
      // ===== 第3次: 扭屁股+星星 =====
      this._doHaCombo3();
    } else {
      // ===== 第4次+: 生气蹲 =====
      this._doHaAngry();
    }
  }

  /** 标准 HA! 流程: [26] → [27](sync 5.wav) → [28] */
  _doHaStandard() {
    var self = this;

    // 步骤1: [26] 抱胸预备 (0~300ms 随机延迟)
    this.setFrame(26);
    var prepDelay = Math.random() * 300;
    this._delay(prepDelay, function() {

      // 步骤2: [27] 张嘴 "呀哈!!!" ★★★ 核心
      self.setFrame(27);
      self.playSound('ha', { volume: 0.85 });

      // GSAP 弹性膨胀 + 震动
      var tween = gsap.fromTo(self.spriteEl,
        { scale: 1 },
        {
          scale: 1.15,
          duration: 0.15,
          yoyo: true,
          repeat: 1,
          ease: 'power2.out',
          onComplete: function() {
            // 步骤3: [28] 收尾
            self.setFrame(28);
            self._delay(300, function() {
              self._endInteraction('ha');
            });
          }
        }
      );
      self._addGsapTween(tween);
    });
  }

  /** 第2次连击: double.wav + 加大 scale */
  _doHaCombo2() {
    var self = this;
    this.setFrame(27);
    this.playSound('double', { volume: 0.7 }); // 叠加嘟嘟嘟嘟

    var tween = gsap.fromTo(self.spriteEl,
      { scale: 1 },
      {
        scale: 1.25,
        duration: 0.12,
        yoyo: true,
        repeat: 2,
        ease: 'power2.out',
        onComplete: function() {
          self.setFrame(28);
          self._delay(250, function() {
            self._endInteraction('ha');
          });
        }
      }
    );
    self._addGsapTween(tween);
  }

  /** 第3次连击: 扭屁股 [15]→[16]→[17] + 星星粒子 */
  _doHaCombo3() {
    var self = this;

    // 先来一个短的 HA!
    self.setFrame(27);
    self.playSound('ha', { volume: 0.8 });

    this._delay(400, function() {
      // 接扭屁股循环
      self.playFrameSequence(SPRITE_GROUPS.wiggle, FRAME_DURATION.wiggle, function() {
        self.setFrame(28);
        self._endInteraction('ha');
      });

      // double.wav 循环感
      self._delay(200, function() {
        self.playSound('double', { volume: 0.5 });
      });
    });
  }

  /** 第4次+: 生气蹲 [30] + "别戳啦！" */
  _doHaAngry() {
    var self = this;
    this.setFrame(30);
    this.playSound('sit', { volume: 0.55 });

    // 显示文字气泡
    this._showSpeechBubble('别戳啦！');

    // 3s 冷却
    this.cooldowns.haCombo = Date.now() + 3000;

    this._delay(1500, function() {
      self.setFrame(1);
      self._endInteraction('ha');
    });
  }


  // ============================================================
  //  SECTION 11: 交互行为 — ACTION_EAT（第四章 4.2）
  // ============================================================

  /**
   * 吃烦恼 — 六阶段完整流程
   * 由 Shredder.js 调用（保持兼容旧API playEat）
   */
  playEat() {
    if (this.isInteracting) return; // 正在交互中不重复触发
    this._interruptForInteraction('eat');

    console.log('[Usagi-v4] ACTION_EAT started');

    var self = this;

    // 如果不在 Rail 4（地板），先掉下来
    if (this.currentRail !== 4 && !this.isOnWall) {
      var floorY = getRailCenterY(4);
      this._gsapFallTo(floorY, 4, function() {
        self._eatStage1_Sense();
      });
    } else {
      this._eatStage1_Sense();
    }
  }

  /** 阶段1: 感知与准备 — [5]+start.wav → [26]蓄力 */
  _eatStage1_Sense() {
    var self = this;
    this._setRail(4);

    // [5] 低头警觉
    this.setFrame(5);
    this.playSound('start', { volume: 0.3 });

    this._delay(200, function() {
      // [26] 抱胸蓄力
      self.setFrame(26);
      self._delay(300, function() {
        self._eatStage2_Bite();
      });
    });
  }

  /** 阶段2: 咬! ★高潮★ — [27] + 5.wav 同步 */
  _eatStage2_Bite() {
    var self = this;
    this.setFrame(27);
    this.playSound('ha', { volume: 0.9 }); // "呀哈!"

    // 视觉膨胀 + 飞来文字在此刻消失（由 Shredder 控制）
    var eatTween = gsap.fromTo(this.spriteEl,
      { scale: 1 },
      {
        scale: 1.2,
        duration: 0.2,
        yoyo: true,
        repeat: 1,
        ease: 'elastic.out(1, 0.5)'
      }
    );
    this._addGsapTween(eatTween); // ★ 追踪！防止中断泄漏

    // 咬持续约 1s（与 5.wav 时长匹配）
    this._delay(1000, function() {
      self._eatStage3_Chew();
    });
  }

  /** 阶段3: 嚼嚼嚼 — [15]→[16]→[17] + double.wav */
  _eatStage3_Chew() {
    var self = this;

    this.playSound('double', { volume: 0.6 });

    // 扭屁股两轮
    var round = 0;
    var maxRounds = 2;

    function doChewRound() {
      if (round >= maxRounds) {
        self._eatStage4_Satisfy();
        return;
      }
      self.playFrameSequence(SPRITE_GROUPS.eatChew.slice(), FRAME_DURATION.wiggle, function() {
        round++;
        self._delay(100, doChewRound);
      });
    }

    doChewRound();
  }

  /** 阶段4: 满足收尾 — [28] + sit.wav("哈") */
  _eatStage4_Satisfy() {
    var self = this;
    this.setFrame(28);
    this.playSound('sit', { volume: 0.5 });

    this._delay(300, function() {
      // [5] 回味
      self.setFrame(5);
      self._delay(400, function() {
        self._eatStage5_Praise();
      });
    });
  }

  /** 阶段5: 夸夸气泡弹出 */
  _eatStage5_Praise() {
    var self = this;

    // 触发夸夸气泡（通过自定义事件通知 main.js）
    var event = new CustomEvent('usagiEatComplete', {
      detail: { position: self.getPosition() }
    });
    document.dispatchEvent(event);

    // 恢复行为
    this._delay(500, function() {
      self._endInteraction('eat');
    });
  }


  // ============================================================
  //  SECTION 12: 交互行为 — PEEK_INPUT（第四章 4.3）
  // ============================================================

  /**
   * 偷看输入框 — 由外部 focus 事件触发
   * @param {HTMLElement} inputEl - 输入框元素引用
   */
  startPeekInput(inputEl) {
    if (this.isInteracting || !inputEl) return;
    this._interruptForInteraction('peek');

    this.peekInputEl = inputEl;
    this.peekStartTime = Date.now();

    console.log('[Usagi-v4] PEEK_INPUT started');

    var self = this;
    var inputRect = inputEl.getBoundingClientRect();
    var myPos = this.getPosition();
    var dx = (inputRect.left + inputRect.width / 2) - myPos.x;
    var dy = (inputRect.top + inputRect.height / 2) - myPos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    // 高度判断：如果在天花板/太高先掉落
    if (this.currentRail === 0) {
      var midY = getRailCenterY(2);
      this._gsapFallTo(midY, 2, function() {
        self._peekDecideApproach(dist);
      });
    } else if (dist > 200) {
      this._peekDecideApproach(dist);
    } else {
      // 已经够近，直接偷看
      this._peekStartWatching(inputEl);
    }
  }

  /** 决定是否需要走过去 */
  _peekDecideApproach(dist) {
    if (dist <= 200) {
      this._peekStartWatching(this.peekInputEl);
      return;
    }

    // 需要跑过去（改编自 ChaseMouse Dash 段）
    var self = this;
    var inputRect = this.peekInputEl.getBoundingClientRect();

    // 目标X = 输入框左侧或右侧（留间隙不遮挡）
    var targetX = Math.random() > 0.5
      ? inputRect.left - 160  // 停左边
      : inputRect.right + 20; // 停右边
    targetX = Math.max(10, Math.min(window.innerWidth - 138, targetX));

    // 确保 z-index 不遮挡输入框
    this.spriteEl.style.zIndex = '9';

    // Run 过去
    this.facingRight = targetX > this.x;
    this._updateFacing();

    this._horizontalMove(targetX, SPEED.run, SPRITE_GROUPS.walk, FRAME_DURATION.run, function() {
      self._peekStartWatching(self.peekInputEl);
    });
  }

  /** 开始偷看等待递进 */
  _peekStartWatching(inputEl) {
    var self = this;
    this.peekStartTime = Date.now();

    function peekLoop() {
      if (!self.isInteracting || self.currentBehavior !== '_PEEK_') return;

      var elapsed = (Date.now() - self.peekStartTime) / 1000;

      if (elapsed < 5) {
        // t=0~5s: [5] 偷看为主 + 偶尔 [1] 装没事
        self.setFrame(Math.random() < 0.7 ? 5 : 1);
      } else if (elapsed < 15) {
        // t=5~15s: 无聊 — [7][8] 悬空坐 + 偶尔扭屁股
        var r = Math.random();
        if (r < 0.5) self.setFrame(7);
        else if (r < 0.85) self.setFrame(8);
        else self.setFrame(SPRITE_GROUPS.wiggle[Math.floor(Math.random() * 3)]); // 扭屁股
      } else {
        // t=15s+: 很无聊 — 高频扭屁股 + 偶尔伸懒腰
        var r2 = Math.random();
        if (r2 < 0.6) {
          self.setFrame(SPRITE_GROUPS.wiggle[Math.floor(Math.random() * 3)]);
        } else {
          self.setFrame(26); // 伸懒腰
        }
      }

      // 下一次更新: 300~600ms
      self._delay(300 + Math.random() * 300, peekLoop);
    }

    this.currentBehavior = '_PEEK_';
    peekLoop();
  }

  /** 结束偷看（blur 或提交时调用） */
  endPeekInput() {
    if (this.currentBehavior !== '_PEEK_') return;

    var self = this;
    this.setFrame(1);
    this.spriteEl.style.zIndex = ''; // 恢复 z-index
    this.peekInputEl = null;

    this._delay(200, function() {
      self._endInteraction('peek');
    });
  }


  // ============================================================
  //  SECTION 13: 全局中断机制
  // ============================================================

  /**
   * 为交互行为中断当前运动行为
   * @param {string} interactionType - 'ha' | 'eat' | 'peek'
   */
  _interruptForInteraction(interactionType) {
    this.isInteracting = true;

    // 暂存当前行为状态
    if (this.currentBehavior && this.currentBehavior.indexOf('_') !== 0) {
      this.pausedBehavior = {
        name: this.currentBehavior,
        rail: this.currentRail,
        x: this.x,
        y: this.y,
        facingRight: this.facingRight,
      };
    }

    // 取消所有进行中的动画和移动
    this._cancelAllAnimations();

    // 取消行为选择循环
    if (this.behaviorLoopTimer) {
      clearTimeout(this.behaviorLoopTimer);
      this.behaviorLoopTimer = null;
    }
  }

  /**
   * 结束交互行为，恢复之前的状态或重新选择
   * @param {string} interactionType - 'ha' | 'eat' | 'peek'
   */
  _endInteraction(interactionType) {
    this.isInteracting = false;
    this.currentBehavior = null;

    if (interactionType === 'peek') {
      this.peekInputEl = null;
    }

    // 尝试恢复之前的行为状态
    if (this.pausedBehavior) {
      var pb = this.pausedBehavior;
      // 检查恢复条件是否还成立（Rail没变太多等）
      if (pb.rail === this.currentRail || pb.rail === 4) {
        this.x = pb.x;
        this.y = pb.y;
        this.facingRight = pb.facingRight;
        this._updateDOMPosition();
        this._updateFacing();
      }
      this.pausedBehavior = null;
    }

    // 重新启动行为引擎（拖拽后给更长喘息时间，让用户看清释放结果）
    var resumeDelay = (interactionType === 'drag')
      ? 800 + Math.random() * 800   // 拖拽后：0.8~1.6s
      : 200 + Math.random() * 300;  // 其他交互：0.2~0.5s
    this._scheduleNextBehavior(resumeDelay);
  }


  // ============================================================
  //  SECTION 13.5: 拖拽系统（完整实现）
  // ============================================================

  /**
   * 拖拽开始 — 记录初始位置，中断行为引擎，脱离 Rail 锚点系统
   */
  _onDragStart(clientX, clientY) {
    this.isDragging = true;
    this.dragStartX = clientX;
    this.dragStartY = clientY;
    this.dragUsagiStartX = this.x;
    this.dragUsagiStartY = this.y;
    this.dragSavedRail = this.currentRail; // ★ 保存原始 Rail（释放后恢复）
    this.lastDragX = clientX;
    this.lastDragY = clientY;
    this.lastDragTime = Date.now();
    this.dragVelocityX = 0;
    this.dragVelocityY = 0;

    // 中断当前行为
    this._interruptForInteraction('drag');

    // 改变光标
    this.spriteEl.style.cursor = 'grabbing';

    // ★ 脱离 Rail 锚点：强制使用 top + left 绝对定位（不再用 bottom）
    this.spriteEl.style.top = this.y + 'px';
    this.spriteEl.style.bottom = 'auto';
    this.spriteEl.style.left = this.x + 'px';

    // 初始帧：探头 [5]
    this.setFrame(5);

    console.log('[Usagi-v4] DRAG start @ (' + Math.round(this.x) + ',' + Math.round(this.y) + ') | savedRail:', this.dragSavedRail);
  }

  /**
   * 拖拽移动 — 跟随鼠标 + 根据速度切换形变帧
   * ★ 使用纯 absolute 定位，不受 Rail 锚点影响
   */
  _onDragMove(clientX, clientY) {
    if (!this.isDragging) return;

    var now = Date.now();
    var dt = now - this.lastDragTime;
    if (dt <= 0) dt = 1; // 防除零

    // 计算速度 (px/ms)
    this.dragVelocityX = (clientX - this.lastDragX) / dt;
    this.dragVelocityY = (clientY - this.lastDragY) / dt;

    this.lastDragX = clientX;
    this.lastDragY = clientY;
    this.lastDragTime = now;

    // 更新乌萨奇位置（直接跟随鼠标）
    var dx = clientX - this.dragStartX;
    var dy = clientY - this.dragStartY;

    var spriteW = this.imgEl.width || 128;
    var spriteH = this.imgEl.height || 128;

    this.x = Math.max(0, Math.min(window.innerWidth - spriteW, this.dragUsagiStartX + dx));
    this.y = Math.max(0, Math.min(window.innerHeight - spriteH, this.dragUsagiStartY + dy));

    // ★ 拖拽期间：强制用 top + left 绝对定位（不走 _updateDOMPosition 的 Rail 锚点逻辑）
    this.spriteEl.style.left = this.x + 'px';
    this.spriteEl.style.top = this.y + 'px';
    // 确保 bottom 被清除（防止和 top 冲突）
    this.spriteEl.style.bottom = 'auto';

    // ===== 根据水平速度选择形变帧 =====
    var vx = this.dragVelocityX;
    var absVx = Math.abs(vx);

    if (absVx < 0.1) {
      // 几乎不动 → 悬空坐
      this.setFrame(Math.random() > 0.5 ? 7 : 8);
    } else if (vx > 0) {
      // 向右拖
      if (absVx > 1.2) {
        // 快速 → 大幅右歪 [10] 翻白眼
        this.setFrame(10);
        if (Math.random() > 0.85) this.playSound('double', { volume: 0.25 }); // 嗡嗡声
      } else {
        // 慢速 → 微右歪 [6]
        this.setFrame(6);
        if (Math.random() > 0.9) this.playSound('ha', { volume: 0.15 });
      }
    } else {
      // 向左拖
      if (absVx > 1.2) {
        // 快速 → 大幅左歪 [9] 翻白眼
        this.setFrame(9);
        if (Math.random() > 0.85) this.playSound('double', { volume: 0.25 });
      } else {
        // 慢速 → 微左歪 [5] 探头
        this.setFrame(5);
      }
    }
  }

  /**
   * 拖拽释放 — 根据惯性行为 + 恢复行为引擎
   */
  _onDragEnd() {
    if (!this.isDragging) return;

    var releaseVx = this.dragVelocityX;
    var releaseVy = this.dragVelocityY;
    var speed = Math.sqrt(releaseVx * releaseVx + releaseVy * releaseVy);

    this.isDragging = false;
    this.spriteEl.style.cursor = 'grab'; // 恢复抓取光标（不是pointer！）

    console.log('[Usagi-v4] DRAG end | speed=' + speed.toFixed(2) +
      ' vx=' + releaseVx.toFixed(2) + ' vy=' + releaseVy.toFixed(2));

    var self = this;

    if (speed > 0.8) {
      // ===== 有惯性 → 抛出效果 =====
      this._doFling(releaseVx, releaseVy, speed);
    } else {
      // ===== 无惯性 → 松手弹回 =====
      this._doDropRelease();
    }
  }

  /**
   * 惯性抛出 — GSAP 物理抛物线 + 落地
   */
  _doFling(vx, vy, speed) {
    var self = this;

    // 方向判断
    this.facingRight = vx >= 0;
    this._updateFacing();

    // 翻滚帧 [4]
    this.setFrame(4);

    // "呀—"
    this.playSound('start', { volume: 0.35 });

    var spriteW = this.imgEl.width || 128;
    var spriteH = this.imgEl.height || 128;

    // 目标位置：沿速度方向飞出（限制在屏幕内）
    var flightTime = Math.min(speed * 300, 800); // 飞行时间 ms
    var targetX = this.x + vx * flightTime;
    var targetY = this.y + vy * flightTime;

    // 钳位到屏幕
    targetX = Math.max(0, Math.min(window.innerWidth - spriteW, targetX));
    targetY = Math.max(spriteH, Math.min(window.innerHeight - spriteH, targetY));

    // GSAP 抛物线飞行（★ 继续用 absolute 定位，避免从拖拽模式切换时的锚点冲突）
    var tween = gsap.to(this, {
      x: targetX,
      y: targetY,
      duration: flightTime / 1000,
      ease: 'power2.out',
      onUpdate: function() {
        // ★ 飞行中保持 top+left 绝对定位
        self.spriteEl.style.left = self.x + 'px';
        self.spriteEl.style.top = self.y + 'px';
        self.spriteEl.style.bottom = 'auto';
        // 飞行中翻滚
        if (Math.random() > 0.6) self.setFrame(4);
      },
      onComplete: function() {
        self._flingLand(targetY);
      }
    });
    this._addGsapTween(tween);
  }

  /** 抛出后落地处理 */
  _flingLand(landY) {
    var self = this;
    var newRail = getRailFromY(this.y);

    // 弹跳 [18][19]
    var bounces = 1 + Math.floor(Math.random() * 3);
    var bounceIdx = 0;

    function doBounce() {
      self.setFrame(bounceIdx % 2 === 0 ? 18 : 19);
      bounceIdx++;
      if (bounceIdx < bounces) {
        self._delay(100, doBounce);
      } else {
        // 落地稳定
        self._setRail(newRail);
        self.y = getRailCenterY(newRail);
        self._updateDOMPosition();
        self.setFrame(newRail === 4 ? 11 : 1); // 地板就坐着，其他站着

        // 落地"咚"
        self.playSound('sit', { volume: 0.4 });

        self._delay(400, function() {
          if (newRail === 4) self.setFrame(1); // 站起来
          self._endInteraction('drag');
        });
      }
    }

    // 先播放落地音效再弹跳
    this.playSound('start', { volume: 0.3 });
    this._delay(50, doBounce);
  }

  /**
   * 无惯性释放 — 停留在释放位置附近，缓慢稳定后恢复行为引擎
   * ★ 不再强制 snap 到 Rail 中心！让乌萨奇待在用户放的地方
   */
  _doDropRelease() {
    var self = this;

    // 叹气/放松帧
    this.setFrame(Math.random() > 0.5 ? 8 : 7);

    var spriteH = this.imgEl.height || 128;
    var currentY = this.y;

    // 判断：如果在屏幕下半区以上（可能看起来悬空），给一个轻微下落
    // 否则就停在原地
    var floorThreshold = window.innerHeight * 0.75; // 75%以下算"地面区域"
    var targetY = currentY;

    if (currentY < floorThreshold) {
      // 悬空 → 缓慢落到 75% 线（不强制到底部）
      targetY = Math.min(floorThreshold + Math.random() * 50, window.innerHeight - spriteH);
    }
    // 如果已经在地面区域就直接停在那

    // 先恢复 Rail 系统（用释放位置的 Rail）
    var targetRail = getRailFromY(targetY);

    // 轻微下落/稳定动画（如果需要移动的话）
    var distance = Math.abs(targetY - currentY);
    if (distance < 3) {
      // 基本没动 → 直接恢复
      this._setRail(targetRail);
      this.y = targetY;
      this._updateDOMPosition();
      this.setFrame(1);
      this._delay(300, function() { self._endInteraction('drag'); });
    } else {
      // 需要小幅移动 → GSAP 缓动
      var tween = gsap.to(this, {
        y: targetY,
        duration: Math.max(0.2, distance * 0.003), // 距离越远越久，最短 200ms
        ease: 'power1.out',
        onUpdate: function() {
          // ★ 动画中继续用 absolute 定位（top），不走 Rail 锚点
          self.spriteEl.style.top = self.y + 'px';
          self.spriteEl.style.bottom = 'auto';
        },
        onComplete: function() {
          // 动画结束后才恢复 Rail 锚点系统
          self._setRail(targetRail);
          self.setFrame(1);
          self._delay(300, function() { self._endInteraction('drag'); });
        }
      });
      this._addGsapTween(tween);
    }
  }


  // ============================================================
  //  SECTION 14: 辅助功能
  // ============================================================

  /** 显示短暂文字气泡 */
  _showSpeechBubble(text) {
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
      pointerEvents: 'none',
    });

    this.spriteEl.appendChild(bubble);

    gsap.fromTo(bubble,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }
    );

    // 3秒后消失
    var self = this;
    var removeTween = gsap.to(bubble, {
      opacity: 0, y: -5, duration: 0.3, delay: 2.7,
      onComplete: function() { bubble.remove(); }
    });
    this._addGsapTween(removeTween); // ★ 追踪，防止泄漏
  }
}
