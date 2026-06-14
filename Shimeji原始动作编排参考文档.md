# Shimeji 原始动作编排参考文档

> 基于「兔-桌宠」与「呀哈桌面宠物」源码完整分析
> 两个项目使用**完全相同的** Actions.xml（724行）和 Behaviors.xml（173行）
> 素材集：`shime1.png` ~ `shime46.png`（46帧乌萨奇精灵图）

---

## 一、架构总览：双层动作系统

Shimeji 桌面宠物采用 **Action（原子动作）+ Behavior（行为状态机）** 双层架构：

```
┌─────────────────────────────────────────────┐
│              Behavior 层（行为编排）            │
│   条件判断 → 频度加权随机选择 → 动作序列链       │
│   behaviors.xml: "什么时候做什么"              │
├─────────────────────────────────────────────┤
│               Action 层（原子动作）             │
│   单帧/多帧动画 + 移动速度 + 音效 + 锚点        │
│   actions.xml: "怎么做这个动作"                │
└─────────────────────────────────────────────┘
```

### 核心概念

| 概念 | 说明 |
|------|------|
| **BorderType（附着面）** | Floor（地面）/ Wall（墙壁）/ Ceiling（天花板）— 动作只能在特定面上执行 |
| **ImageAnchor（锚点）** | 精灵图的哪个像素坐标对齐到附着面，如 `"64,128"` 表示图片底部中心贴地 |
| **Velocity（速度矢量）** | 每帧移动的 `(x, y)` 像素数，**注意：全部是纯水平或纯垂直！** |
| **Duration（持续帧数）** | 该 Pose 保持的帧数/毫秒数 |
| **Frequency（频度）** | Behavior 被随机选中的权重，数值越大越容易被选中 |
| **Condition（条件）** | 行为触发的前提条件（位置、朝向等） |
| **NextBehavior（后续行为）** | 当前行为结束后可选的下一个行为列表（也带频度权重） |

---

## 二、全部原子动作（Action）详解

### 2.1 站立类（Floor 地面）

| Action 名 | 类型 | 帧序列 | 速度 | 时长 | 说明 |
|-----------|------|--------|------|------|------|
| **Stand** | Stay | [1] | (0,0) | 250ms | 原地站立 |
| **Walk** | Move | [1]→[2]→[1]→[3] | (-2,0)×4 | 每帧6ms | 缓步走（四帧循环） |
| **Run** | Move | [1]→[2]→[1]→[3] | (-4,0)×4 | 每帧2ms | 跑步走 |
| **Dash** | Move | [1]→[2]→[1]→[3] | (-8,0)×4 | 每帧2ms | 冲刺跑（最快） |

**关键发现 — 三档速度体系：**

```
Walk: vx=-2  →  悠闲散步
Run:  vx=-4  →  正常跑动
Dash: vx=-8  →  冲刺追逐鼠标
```

所有速度矢量的 x 分量都是**负值**，因为 Shimeji 通过翻转精灵图来处理左右方向，内部始终向"左"移动。

### 2.2 坐姿类（Floor 地面）

| Action 名 | 帧序列 | 速度 | 音效 | 说明 |
|-----------|--------|------|------|------|
| **Sit** | [11] | (0,0) | — | 普通坐下 |
| **SitAndLookUp** | [26] | (0,0) | — | 坐着抬头（HA!表情第一帧）|
| **SitAndLookAtMouse** | [26]/[11] | (0,0) | — | 坐着追踪鼠标方向（条件分支）|
| **SitAndSpinHeadAction** | [26]→[27]→[28]→[29] | (0,0) | — | **转头三连击！（HA!动画）**每帧5ms，超快 |
| **SitWithLegsUp** | [30] | (0,0) | **sit.wav** ("哈") | 抬腿坐（生气坐姿） |
| **SitWithLegsDown** | [31] | (0,0) | — | 放下腿 |
| **SitAndDangleLegs** | [31]→[32]→[31]→[33] | (0,0) | — | 腿晃荡循环 |

**SitAndSpinHeadAction 就是那个经典的 "HA! HA! HA!" 转头动画！**
使用帧 [26][27][28][29]，每帧仅 5ms（0.2秒完成整套）。

### 2.3 躺卧类（Floor 地面）

| Action 名 | 帧序列 | 速度 | 说明 |
|-----------|--------|------|------|
| **Sprawl** | [21] | (0,0) | 趴下/躺平 |
| **Creep** | [20]停→[20]走→[21]走→[21]慢→[21]停 | (-2,0)→(-2,0)→(-1,0)→(0,0) | 匍匐爬行（有启动-滑动-停止过程）|

**Creep 的精妙设计：** 不是匀速爬行，而是模拟"发力→滑行→减速→停下"的物理感：
1. [20] 停顿 10ms（准备姿势）
2. [20] 以 -2 加速 4ms（发力）
3. [21] 以 -2 滑行 4ms（滑行中）
4. [21] 以 -1 减速 4ms（减速）
5. [21] 停顿 10ms（完全停下）

### 2.4 天花板类（Ceiling 天花板）

| Action 名 | 帧序列 | 锚点 | 速度 | 说明 |
|-----------|--------|------|------|------|
| **GrabCeiling** | [23] | 64,48 | (0,0) | 抓住天花板（倒挂静止） |
| **ClimbCeiling** | [25]停→[25]走→[23]走→[24]停→[24]快走→[23]快走→[25]快走 | 64,48 | (-1,0)/(-2,0) | 倒挂着在天花板上爬行 |

**天花板特殊之处：**
- ImageAnchor 从 `"64,128"` 变为 `"64,48"` — 因为倒挂时锚点在头部
- 速度只有 (-1,0) 和 (-2,0) 两档（比地面慢）
- 使用不同的帧：[23]=倒挂抓握, [24]=倒挂移动中, [25]=倒挂准备

### 2.5 墙壁类（Wall 墙壁）

| Action 名 | 帧序列 | 速度 | 说明 |
|-----------|--------|------|------|
| **GrabWall** | [13] | (0,0) | 抓住墙壁（侧身静止） |
| **ClimbWall** | [14]→[14]→[12]→[13]→[13]→[13]→[12]→[14] | (0,-1)/(0,-2)**或**(0,1)/(0,2) | **在墙上攀爬（纯垂直移动！）** |

**ClimbWall 的双分支设计：**

```
如果 目标Y < 当前Y （向上爬）:
  [14]停16ms → [14]向上1px(4ms) → [12]向上1px(4ms) → [13]向上1px(4ms)
  → [13]停16ms → [13]向上2px(4ms) → [12]向上2px(4ms) → [14]向上2px(4ms)

如果 目标Y >= 当前Y （向下爬）:
  同样的帧序列，但 velocity 为 (0,+1) 和 (0,+2)
```

这就是 **Shimeji 攀爬系统的核心**：
- **纯垂直移动** `(0, ±y)` — 绝无水平分量
- 两档速度：慢爬 ±1px/帧，快爬 ±2px/帧
- 三帧循环：[14](伸展)→[12](收手)→[13](抓握)，模拟攀爬节奏
- 先慢后快的两段式加速（类似 Creep 的设计思路）

### 2.6 重力/跌落类（Embedded 内置物理引擎）

| Action 名 | 帧 | 物理参数 | 音效 | 说明 |
|-----------|-----|----------|------|------|
| **Falling** | [4] | 阻力X=0.05, 阻力Y=0.1, **重力=2** | start.wav("短嘟") | 自由落体（内置物理引擎计算轨迹）|
| **Jumping** | [22] | 初速度=20 | — | 向目标点跳跃（抛物线） |
| **Bouncing** | [18]→[19] | — | — | 落地弹跳（两帧快速切换，每帧4ms）|
| **Tripping** | [19]冲→[18]减速→[20]减速→[20]停→[19]仰 | (-8)→(-4)→(-2)→(0)→(-4) | 被绊倒（冲刺时5%概率触发） |

**Fall 序列（必选行为）的标准流程：**
```
Falling → { 如果落到地面/IE顶: Bouncing → Stand(100~200ms随机)
           如果落到墙壁:   GrabWall(100ms) }
```

### 2.7 拖拽交互类

| Action 名 | 帧逻辑 | 说明 |
|-----------|--------|------|
| **Pinched** | 根据光标相对脚位置的偏移量，在 [9][7][5][1][6]**[音效:5.wav/呀哈!]****[8][10] 七个帧之间切换 | 被捏住时的形变反应 |
| **Resisting** | [5]↔[6] 快速交替，中间插入 [1] 长停顿，逐渐加速 | 抗拒挣扎（频率从5ms加速到2ms） |

**Pinched 的位置映射（非常精巧的设计）：**

```
光标在脚左边 >50px:  [9]  大幅度左歪
光标在脚左边 >30px:  [7]  中度左歪
光标在脚左边:        [5]  轻微左歪
光标正对脚±10px:     [1]  正常站姿 ← 自然状态
光标在脚右边 <30px:  [6]  轻微右歪 + 播放"呀哈!"音效
光标在脚右边 <50px:  [8]  中度右歪
光标在脚右边 ≥30px:  [10] 大幅度右歪
```

这创造了**被拖拽时身体跟随光标方向拉伸变形**的效果！

**Resisting 的渐进加速设计：**
```
阶段1: [5]↔[6] 每5ms交替 × 4次（普通挣扎）
停顿: [1] 50ms（喘息）
阶段2: [5]↔[6] 每5ms交替 × 8次（加大力度）
停顿: [1] 100ms（再次喘息）
阶段3: [5]↔[6] 每2ms交替 × 8件（疯狂挣扎！）
```

### 2.8 IE 浏览器交互类（Shimeji 特色）

> Shimeji 最初是为 IE 浏览器设计的桌面宠物，可以跟浏览器窗口互动。
> 我们的网页版不需要这部分，但理解其设计仍有参考价值。

| Action 名 | 说明 |
|-----------|------|
| **FallWithIe** | 抓着 IE 窗口一起落下 [36] |
| **WalkWithIe** | 抱着 IE 窗口走 [34]→[35]→[34]→[36] |
| **RunWithIe** | 抱着 IE 窗口跑 |
| **ThrowIe** | 把 IE 窗口扔出去 [37]，初速度(32,-10)，重力0.5 |

### 2.9 特殊行为类

| Action 名 | 帧序列 | 音效 | 说明 |
|-----------|--------|------|------|
| **PullUpShimeji1** | [1]→[39]→[40]→[41] | double.wav("嘟嘟嘟嘟") | **生小乌萨奇！**（繁殖动作第一段） |
| **PullUpShimeji2** | [9]飞(20,-20)→(20,-10)→(20,-5) | — | 新生的乌萨奇被"弹飞"出去 |
| **Divide1** | [42]→[43]→[44]→[45]→[46] | double.wav("嘟嘟嘟嘟") | **分裂！**变成两只（用到了全部剩余帧42-46） |

---

## 三、Behavior 行为状态机完整解析

### 3.1 必选行为（ALWAYS REQUIRED）

这些行为不由频度系统触发，而是由**外部事件**直接激活：

| Behavior 名 | Frequency | 触发方式 | 后续行为 |
|-------------|-----------|----------|----------|
| **ChaseMouse** | 0 (Hidden) | 用户点击桌面宠物 | → SitAndFaceMouse |
| **Fall** | 0 (Hidden) | 离开附着面时自动 | 无（内部处理落地选择）|
| **Dragged** | 0 (Hidden) | 用户按住拖拽 | Loop: Pinched → Resisting |
| **Thrown** | 0 (Hidden) | 用户甩出 | 内部处理落地 |
| **PullUp** | 0 (Hidden) | 被新生乌萨奇弹出 | → Bouncing |
| **Divided** | 0 (Hidden) | 被分裂体弹出 | → Bouncing |

### 3.2 地面行为树（On the Floor）

```
条件: 在地面(mascot.environment.floor.isOn) 或 IE顶面
│
├── StandUp      [频度200, Hidden]  → 站立 500~1500ms 随机
├── SitDown      [频度200]          → 坐下 500~1500ms 随机
│   └─ NextBehavior (Add=true):
│       ├── SitWhileDanglingLegs [100]  → 腿晃荡坐姿
│       └── LieDown              [100]  → 躺平
│
├── SitWhileDanglingLegs [频度0]  (只能从SitDown链入)
│
├── LieDown      [频度0]          (只能从SitDown链入)
│   └─ NextBehavior:
│       ├── SitDown               [100]
│       ├── CrawlAlongIECeiling   [100] (如果在IE上)
│       └── CrawlAlongWorkAreaFloor [100] (如果在地面)
│
└── SplitIntoTwo [频度50]         (仅当总数<50时) → 分裂！
```

**频度解读：** StandUp(200) 和 SitDown(200) 权重相等 = 各50%概率选站立或坐下。

### 3.3 地面主动行为（On Work Area Floor）

> 这是乌萨奇在地面上时的**主要行为池**！

```
条件: 严格在地面(mascot.environment.floor.isOn)
│
├── WalkAlongWorkAreaFloor    [100, Hidden]  → 走到屏幕随机位置
├── RunAlongWorkAreaFloor     [100, Hidden]  → 跑到屏幕随机位置
├── CrawlAlongWorkAreaFloor   [10]           → 爬到随机位置（低频！）
│   └─ Next: LieDown [1]                    (爬完必躺)
│
├── WalkLeftAlongFloorAndSit  [100, Hidden]  → 向左走一段 → 停 → 转 → 坐
├── WalkRightAlongFloorAndSit [100, Hidden]  → 向右走一段 → 停 → 转 → 坐
├── GrabWorkAreaBottomLeftWall [100, Hidden] → 走到左墙 → 沿墙爬
├── GrabWorkAreaBottomRightWall [100, Hidden] → 走到右墙 → 沿墙爬
│
├── WalkLeftAndSit            [100, Hidden]  → 跑向左侧 → 停 → 转 → 坐
├── WalkRightAndSit           [100, Hidden]  → 跑向右侧 → 停 → 转 → 坐
│
├── WalkAndGrabBottomLeftWall [100]          → 跑到左墙 → 沿墙爬（非隐藏=可见选项）
├── WalkAndGrabBottomRightWall[100]          → 跑到右墙 → 沿墙爬
│
├── JumpFromBottomOfIE        [50]           → 从IE底部跳到IE顶（如果在IE范围内）
│
└── PullUpShimeji             [50]           → 生小乌萨奇（仅当<50只时）
```

**关键设计洞察：**
- **Hidden 行为**（如 WalkAlongWorkAreaFloor）不会直接出现在随机选择中，只能作为 NextBehavior 链的目标
- **非 Hidden 行为**（如 WalkAndGrabBottomLeftWall）才是真正的随机选择候选项
- 走-停-转-坐 是一个完整的组合行为模板，出现频率很高

### 3.4 墙壁行为树

```
条件: 面对并接触墙壁 (lookRight ? 右墙 : 左墙)
│
├── ClimbHalfwayAlongWall  [100, Hidden]  → 爬到墙壁半随机高度
├── ClimbAlongWall         [100]          → 爬到墙顶 → Offset Y=-64 → Look → 沿天花板爬
│
条件: 已经在墙上（不在地面）
├── HoldOntoWall           [100, Hidden]  → 抓墙不动 500~1500ms
└── FallFromWall           [50, Hidden]   → 松手掉落（仅当不在地面时）
```

**ClimbAlongWall 完整序列（爬墙→上天花板）：**
```
ClimbWall(爬到 workArea.top+64)
  → Offset(Y=-64)          // 往上挪一点，确保抓住天花板
  → Look()                 // 转向
  → ClimbCeiling(沿天花板走向随机一侧)
```

### 3.5 天花板行为树

```
条件: 在天花板上
│
├── HoldOntoCeiling        [100, Hidden]  → 抓天花板不动 500~1500ms
├── FallFromCeiling        [50, Hidden]   → 松手坠落
│
├── ClimbAlongCeiling      [100]          → 沿天花板走到随机位置
```

### 3.6 IE 窗口互动行为（我们可忽略的部分）

Shimeji 可以探测到 IE 浏览器窗口的位置，并在其表面/边缘/侧面活动：

- **IE 顶部（当作天花板）：** Walk/Run/Crawl + 边缘坐/跳（8种行为）
- **IE 侧面（当作墙壁）：** Hold/Climb（2种行为）
- **IE 底部（也是天花板）：** Crawl + 抓角（3种行为）
- **扔 IE 行为：** 4种变体（从左右两侧、走路/跑步过去扔）

### 3.7 追逐鼠标行为（ChaseMouse）

这是最复杂的单一体行为，**完整的追逐流程：**

```
ChaseMouse 序列:
│
├── 【前置处理】根据当前所在面自动脱离:
│   如果在天花板/IE底面 → Offset(Y=1) → Falling → Bouncing（先掉下来）
│   如果在左墙/IE右边   → Offset(X=1) → Falling → Bounding（先松手）
│   如果在右墙/IE左边   → Offset(X=-1) → Falling → Bouncing
│   如果在IE顶面且在左半 → DashIeCeilingLeftEdgeFromJump（从IE左边缘跳下）
│   如果在IE顶面且在右半 → DashIeCeilingRightEdgeFromJump（从IE右边缘跳下）
│
├── 第一段冲刺: Dash 到 "当前位置+(鼠标距离)*0~50%" 的随机位置
├── 5% 概率绊倒: Tripping
├── 第二段冲刺: Dash 到 "当前位置+(鼠标距离)*0~100%" 的随机位置
├── 5% 概率绊倒: Tripping
├── 最终冲刺: Dash 到 "鼠标位置 ± 0~200px随机偏差"
└── Look(面向鼠标) → 结束
```

### 3.8 坐着追踪鼠标（SitAndFaceMouse）

ChaseMouse 的后续行为，一个非常**长的循环**：

```
循环 12 次 (!):
  SitAndLookAtMouse(10~20ms随机) → Look(转向鼠标方向)
```

每次循环极短（~15ms），但重复12次 = 总共约 **180ms 的连续转头追踪**效果。

NextBehavior 选择（每次 SitAndFaceMouse 结束后）：
- SitAndFaceMouse [100] → 继续追踪（大概率）
- SitAndSpinHead [1] → 偶尔来一个 HA! 转头
- SitWhileDanglingLegs [1] → 偶尔晃腿

---

## 四、频度权重与概率分析

### 4.1 地面主要行为的概率分布

**可被随机选中的地面行为（排除 Hidden）：**

| Behavior | Frequency | 归一化概率 | 说明 |
|----------|-----------|------------|------|
| WalkAndGrabBottomLeftWall | 100 | ~16.7% | 跑→左墙爬 |
| WalkAndGrabBottomRightWall | 100 | ~16.7% | 跑→右墙爬 |
| CrawlAlongWorkAreaFloor | 10 | ~1.7% | 爬行（稀有）|
| JumpFromBottomOfIE | 50 | ~8.3% | 跳上IE（有条件）|
| PullUpShimeji | 50 | ~8.3% | 生宝宝（有条件）|
| **合计** | **~600（有条件的会动态变化）** | | |

**加上隐藏行为作为链式目标的实际感受：**
- 走/跑/走-停-坐 这些 Hidden 行为通过 SitDown → NextBehavior 链间接执行
- 所以实际体验是：**约一半时间站立/坐着，一半时间在四处移动**

### 4.2 墙面行为概率

| Behavior | Frequency | 概率 |
|----------|-----------|------|
| ClimbAlongWall | 100 | **50%** — 爬到顶转天花板 |
| ClimbHalfwayAlongWall | 100 (Hidden) | 仅作为链目标 |

爬到顶 vs 爬一半 = 50:50（因为只有一个非 Hidden 选项时会必然选中，Hidden 作为 fallback）

### 4.3 坐下后的行为扩散

```
SitDown (200)
  ├─ 50% → SitWhileDanglingLegs → (结束，回顶层选择)
  └─ 50% → LieDown → Crawl(爬走) or SitDown(再坐)
```

---

## 五、动作编排的核心设计模式

### 模式 A：走-停-转-坐（最常用的复合行为）

```
Walk/Run(TargetX=随机位置)
  → Stand(20~40ms 随机停顿)
    → Look(转向)
      → Stand(20~40ms)
        → Sit(500~1500ms 长时间坐)
```

**出现版本：**
- WalkLeftAlongFloorAndSit / WalkRightAlongFloorAndSit（走版）
- WalkLeftAndSit / WalkRightAndSit（跑版）
- SitOnTheLeftEdgeOfIE / SitOnTheRightEdgeOfIE（IE版）
- WalkLeftAlongIEAndSit / WalkRightAlongIEAndSit（IE跑版）

**设计意图：** 让乌萨奇的移动看起来"有目的性"——不是乱走，而是"走到某处→停下来→坐下休息"

### 模式 B：走-碰墙-爬（墙面转换通道）

```
Walk/Run(TargetX=墙壁位置)
  → ClimbWall(TargetY=墙上某高度)
```

**这是地面↔墙壁之间的唯一转换通道！** 乌萨奇不会凭空出现在墙上，必须先走到墙边再爬上去。

### 模式 C：爬墙-上天花板-爬行（墙面→天花板转换）

```
ClimbWall(TargetY=墙顶)
  → Offset(Y=-64)         // 确保够到天花板
  → Look()                // 调整朝向
  → ClimbCeiling(TargetX=随机位置)
```

### 模式 D：落地反弹统一处理

```
Falling(物理引擎驱动)
  → Select:
      如果落地/落IE顶: Bouncing → Stand(短停顿)
      如果落墙壁:     GrabWall(短暂抓)
```

### 模式 E：条件分叉的帧选择

```xml
<!-- SitAndLookAtMouse: 根据鼠标在屏幕上半还是下半选择不同表情 -->
<Animation Condition="鼠标Y < 屏幕高度/2">
    <Pose Image="[26]" />  <!-- 抬头看 -->
</Animation>
<Animation>
    <Pose Image="[11]" />  <!-- 正常坐 -->
</Animation>

<!-- ClimbWall: 根据目标在上还是下决定爬升方向 -->
<Animation Condition="TargetY < 当前Y">
    <!-- 向上爬: velocity (0, -1) / (0, -2) -->
</Animation>
<Animation Condition="TargetY >= 当前Y">
    <!-- 向下爬: velocity (0, +1) / (0, +2) -->
</Animation>
```

---

## 六、全部 46 帧的使用映射

| 帧号 | 文件名 | 在 Action 中用途 | 语义（用户校正） |
|------|--------|------------------|------------------|
| shime1 | [1] | Stand, Walk/Run循环第1/3帧, Pinched居中, Resisting停顿 | **站立** |
| shime2 | [2] | Walk/Run循环第2帧 | **跑步-帧A** |
| shime3 | [3] | Walk/Run循环第4帧 | **跑步-帧B** |
| shime4 | [4] | Falling（自由落体） | **翻滚/下落** |
| shime5 | [5] | Pinched(轻微左歪), Resisting(左倾) | **偷看-左/探头-左** |
| shime6 | [6] | Pinched(轻微右歪+音效5.wav), Resisting(右倾) | **偷看-右/探头-右** |
| shime7 | [7] | Pinched(中度左歪) | **空中坐-左** |
| shime8 | [8] | Pinched(中度右歪) | **空中坐-右** |
| shime9 | [9] | Pinched(大幅度左歪), PullUpShimeji2(被弹飞) | **撞墙-左** |
| shime10 | [10] | Pinched(大幅度右歪) | **撞墙-右** |
| shime11 | [11] | Sit, SitAndLookAtMouse(默认) | **坐地板** |
| shime12 | [12] | ClimbWall(收手帧) | **扒墙-收手** |
| shime13 | [13] | GrabWall, ClimbWall(抓握帧) | **扒墙-抓握** |
| shime14 | [14] | ClimbWall(伸展帧) | **扒墙-伸展** |
| shime15 | — | *(未使用)* | **扭屁股A** |
| shime16 | — | *(未使用)* | **扭屁股B** |
| shime17 | — | *(未使用)* | **扭屁股C** |
| shime18 | [18] | Bouncing(帧1), Tripping(减速帧) | **冻结/僵硬** |
| shime19 | [19] | Bouncing(帧2), Tripping(冲刺/仰倒帧) | **打滑/ minor slip** |
| shime20 | [20] | Creep(准备/发力帧) | **匍匐-预备** |
| shime21 | [21] | Sprawl, Creep(滑行/停止帧) | **趴下/躺平** |
| shime22 | [22] | Jumping(起跳姿态) | *未在校正表中明确标注* |
| shime23 | [23] | GrabCeiling, ClimbCeiling(抓握帧) | **抓天花板** |
| shime24 | [24] | ClimbCeiling(移动帧) | **天花板-移动** |
| shime25 | [25] | ClimbCeiling(准备帧) | **天花板-准备** |
| shime26 | [26] | SitAndLookUp, SitAndSpinHead(帧1), SitAndLookAtMouse(抬头) | **"HA!" A** |
| shime27 | [27] | SitAndSpinHead(帧2) | **"HA!" B** |
| shime28 | [28] | SitAndSpinHead(帧3) | **"HA!" C** |
| shime29 | [29] | SitAndSpinHead(帧4) | **"HA!" D（同A?）** |
| shime30 | [30] | SitWithLegsUp(+音效sit.wav) | **生气坐** |
| shime31 | [31] | SitWithLegsDown, SitAndDangleLegs(基础帧) | *辅助帧* |
| shime32 | [32] | SitAndDangleLegs(晃腿帧A) | *辅助帧* |
| shime33 | [33] | SitAndDangleLegs(晃腿帧B) | *辅助帧* |
| shime34 | [34] | WalkWithIe/RunWithIe(帧1/3) | *IE互动专用* |
| shime35 | [35] | WalkWithIe/RunWithIe(帧2) | *IE互动专用* |
| shime36 | [36] | FallWithIe, WalkWithIe/RunWithIe(帧4) | *IE互动专用* |
| shime37 | [37] | ThrowIe(投掷姿态) | *IE互动专用* |
| shime38 | — | *(不存在？)* | — |
| shime39 | [39] | PullUpShimeji1(生宝宝帧2, +double.wav) | *繁殖专用* |
| shime40 | [40] | PullUpShimeji1(帧3) | *繁殖专用* |
| shime41 | [41] | PullUpShimeji1(帧4) | *繁殖专用* |
| shime42 | [42] | Divide1(分裂帧1, +double.wav) | *分裂专用* |
| shime43 | [43] | Divide1(帧2) | *分裂专用* |
| shime44 | [44] | Divide1(帧3) | *分裂专用* |
| shime45 | [45] | Divide1(帧4) | *分裂专用* |
| shime46 | [46] | Divide1(帧5) | *分裂专用* |

**未使用的帧（在我们的场景下）：** [15][16][17]（扭屁股三连）、[38]（不存在）

**IE/繁殖/分裂专用帧（我们的网页版不需要）：** [34-37]、[39-46]

---

## 七、对我们 v3 实现的关键参考价值

### 7.1 可以直接借鉴的模式

| 原始模式 | 我们如何适配 |
|----------|-------------|
| **三档速度** Walk(-2)/Run(-4)/Dash(-8) | Rail 上行走可用同样的 speed/slow/fast 三档 |
| **走-停-转-坐** 复合行为 | Rail 行走的自然终点：走一段 → 停 → 坐 |
| **走-碰墙-爬** 墙面转换 | 到达屏幕边缘 → Wall Bump([9][10]) → 选择爬或受惊掉落 |
| **爬墙纯垂直** (0,±y) + 三帧循环 | Wall Climb([12][13][14]) 用同样的纯Y轴 + 帧循环 |
| **落地反弹** Falling → Bouncing → Stand | 掉落到下层 Rail → Bounce([18][19]) → 恢复行走 |
| **频度加权随机** Frequency 属性 | 我们的 Behavior Selector 可用完全相同的权重系统 |
| **条件门控** Condition 属性 | 只在特定 Rail/状态下启用特定行为 |
| **NextBehavior 链** | 行为结束后的自然过渡（如坐下→躺下→爬走） |
| **SitAndSpinHead** HA!动画 [26]→[27]→[28]→[29] | **直接搬用！**这是我们夸夸功能的视觉高潮 |
| **Pinched 位置映射** | 点击/拖拽时的形变反馈参考 |

### 7.2 需要改造的差异

| 原始设计 | 我们的改造 |
|----------|-----------|
| 4种附着面(Floor/Wall/Ceiling/IE) | 5条水平Rail（简化Y轴为离散层）|
| 连续坐标系（任意像素位置） | 离散Rail系统（Y值量化为5档）|
| IE 窗口互动 | 替换为**输入框互动**（偷看/吃掉烦恼）|
| 繁殖/分裂行为 | 替换为**夸夸回应**（输出文字气泡）|
| 拖拽形变(Pinched) | 保留点击反馈，但简化形变逻辑 |
| ChaseMouse（追逐光标） | 替换为**PeekInput**（偷看输入框）|

### 7.3 原始设计的"灵魂"值得保留

1. **不确定性带来的生动感** — 所有停留时间都有 `Math.random()` 随机量
2. **行为链的自然流动** — 不是每次都从零随机选，而是有 NextBehavior 引导的"叙事流"
3. **物理感的运动设计** — Creep 的加减速、ClimbWall 的两段速、Resisting 的渐进加速
4. **Rare but memorable 特殊事件** — 分裂(SplitIntoTwo)频度仅50远低于走/坐(200)，HA!转头在追踪鼠标时仅1%概率
5. **Surface attachment 的约束感** — 每个动作都被 BorderType 管束，不会出现不合逻辑的状态组合

---

## 附录：音频映射（原始用法汇总）

| 文件名 | 原始用途 | 触发位置 |
|--------|----------|----------|
| `start.wav` ("短嘟/嘟") | Falling 开始下落时 | `<Pose ... Sound="/start.wav" />` in Falling action |
| `5.wav` ("呀哈!") | Pinched 形变到右侧中度偏移时 | `<Pose ... Sound="/5.wav" />` in Pinched action |
| `sit.wav` ("哈") | SitWithLegsUp（生气坐/抬腿坐） | `<Pose ... Sound="/sit.wav" />` in SitWithLegsUp |
| `double.wav` ("嘟嘟嘟嘟") | PullUpShimeji1(生宝宝)、Divide1(分裂) | `<Pose ... Sound="/double.wav" />` |

---

*文档生成时间：2026-06-14*
*数据来源：兔-桌宠/shimeji/conf/Actions.xml + Behavior.xml & 呀哈桌面宠物/conf/actions.xml + behaviors.xml（两者内容一致）*
