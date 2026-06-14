/**
 * 粒子背景模块 — 阳光生命力风格流体光斑
 * 使用 Canvas 2D API，轻量高性能
 */

export class ParticleBackground {
  constructor(canvasId = 'particle-canvas') {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.mouseX = 0;
    this.mouseY = 0;
    this.maxParticles = 28;

    // 光斑颜色池（阳光生命力调色板）
    this.colors = [
      { r: 255, g: 245, b: 230, a: 0.6 },   // 奶油白
      { r: 255, g: 228, b: 200, a: 0.5 },   // 暖杏色
      { r: 255, g: 220, b: 210, a: 0.45 },  // 樱花粉
      { r: 255, g: 240, b: 180, a: 0.4 },   // 淡金色
      { r: 200, g: 230, b: 255, a: 0.3 },   // 天空蓝
      { r: 255, g: 215, b: 180, a: 0.35 },  // 蜜桃色
    ];

    this.init();
    this.bindEvents();
    this.animate();
  }

  init() {
    this.resize();
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push(this.createParticle());
    }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.scale(dpr, dpr);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
  }

  createParticle() {
    const colorData = this.colors[Math.floor(Math.random() * this.colors.length)];
    return {
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      baseRadius: 20 + Math.random() * 60, // 20~80px
      radius: 0,                          // 由呼吸动画控制
      color: colorData,
      vx: (Math.random() - 0.5) * 0.4,   // 极慢漂移
      vy: (Math.random() - 0.5) * 0.4,
      phase: Math.random() * Math.PI * 2, // 呼吸相位偏移
      breathSpeed: 0.008 + Math.random() * 0.012, // 呼吸频率
    };
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.resize();
    });

    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  update(particle) {
    // 位置漂移
    particle.x += particle.vx;
    particle.y += particle.vy;

    // 边界环绕
    if (particle.x < -100) particle.x = this.w + 100;
    if (particle.x > this.w + 100) particle.x = -100;
    if (particle.y < -100) particle.y = this.h + 100;
    if (particle.y > this.h + 100) particle.y = -100;

    // 呼吸效果：半径正弦变化
    particle.phase += particle.breathSpeed;
    const breathFactor = 0.6 + 0.4 * Math.sin(particle.phase);
    particle.radius = particle.baseRadius * breathFactor;

    // 鼠标交互：光斑轻微躲避/吸引
    const dx = particle.x - this.mouseX;
    const dy = particle.y - this.mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 180 && dist > 0) {
      const force = (180 - dist) / 180 * 0.3;
      particle.vx += (dx / dist) * force * 0.02;
      particle.vy += (dy / dist) * force * 0.02;
      // 速度衰减，避免飞走
      particle.vx *= 0.98;
      particle.vy *= 0.98;
    }
  }

  draw(particle) {
    const { ctx } = this;
    const { x, y, radius, color } = particle;

    // 径向渐变光斑
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`);
    gradient.addColorStop(0.4, `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a * 0.4})`);
    gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  animate() {
    const { ctx, w, h } = this;

    ctx.clearRect(0, 0, w, h);

    for (const p of this.particles) {
      this.update(p);
      this.draw(p);
    }

    requestAnimationFrame(() => this.animate());
  }

  /** 销毁实例 */
  destroy() {
    // 停止动画循环（简单实现：清空粒子）
    this.particles = [];
    this.ctx.clearRect(0, 0, this.w, this.h);
  }
}
