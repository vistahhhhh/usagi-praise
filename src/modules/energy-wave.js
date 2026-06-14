/**
 * 能量波扩散特效模块
 * 从指定位置向外扩散金色/彩色圆环
 */

// 根据夸夸类型映射波纹颜色
const WAVE_COLORS = {
  warmth: ['#FF9F43', '#FFD700'],
  gentle: ['#FFB6C1', '#FFE4EC'],
  funny: ['#6DD5FA', '#B8E8FF'],
  yaha: ['#FFD700', '#FFF176', '#FFAB40'],
};

export class EnergyWave {
  constructor(containerId = 'energy-wave-container') {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
  }

  /**
   * 在目标位置触发能量波
   * @param {Object} pos - {x, y} 屏幕坐标
   * @param {string} type - 夸夸类型（warmth/gentle/funny/yaha）
   */
  emit(pos, type = 'yaha') {
    const colors = WAVE_COLORS[type] || WAVE_COLORS.yaha;
    const ringCount = type === 'yaha' ? 3 : 2; // 呀哈型更夸张

    for (let i = 0; i < ringCount; i++) {
      setTimeout(() => {
        this.createRing(pos, colors[i % colors.length], i);
      }, i * 200); // 错开时间
    }
  }

  /**
   * 创建单个扩散圆环
   */
  createRing(pos, color, index) {
    const ring = document.createElement('div');
    ring.className = 'energy-wave-ring';

    // 初始尺寸和位置
    const startSize = 60 + index * 20;

    Object.assign(ring.style, {
      left: pos.x + 'px',
      top: pos.y + 'px',
      width: startSize + 'px',
      height: startSize + 'px',
      borderColor: color,
      boxShadow: `0 0 ${12}px ${color}, inset 0 0 ${8}px ${color}`,
    });

    this.container.appendChild(ring);

    // 动画结束后自动移除
    setTimeout(() => {
      if (ring.parentNode) ring.remove();
    }, 1400);
  }

  /** 在乌萨奇位置触发（自动获取位置） */
  emitAtUsagi(usagiInstance, type) {
    if (!usagiInstance) return;
    const pos = usagiInstance.getPosition();
    this.emit(pos, type);
  }
}
