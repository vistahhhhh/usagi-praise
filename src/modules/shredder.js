/**
 * 烦恼粉碎机 — 核心交互模块
 * 输入文字 → 文字飞向乌萨奇 → 碎裂粒子 → 触发夸夸
 */

import gsap from 'gsap';

export class Shredder {
  constructor({ usagi, onShredded }) {
    this.inputEl = document.getElementById('worry-input');
    this.btnEl = document.getElementById('shred-btn');
    this.charCountEl = document.getElementById('char-count-num');
    this.flyingLayer = document.getElementById('flying-text-layer');
    this.usagi = usagi;
    this.onShredded = onShredded; // 粉碎完成回调，用于触发夸夸
    this.isProcessing = false;

    if (!this.inputEl || !this.btnEl) return;
    this.bindEvents();
  }

  bindEvents() {
    // 输入监听：字数统计 + 按钮状态
    this.inputEl.addEventListener('input', () => {
      const len = this.inputEl.value.length;
      this.charCountEl.textContent = len;

      if (len > 0 && !this.isProcessing) {
        this.btnEl.disabled = false;
        this.btnEl.classList.add('ready');
      } else {
        this.btnEl.disabled = true;
        this.btnEl.classList.remove('ready');
      }
    });

    // 粉碎按钮
    this.btnEl.addEventListener('click', () => this.execute());

    // 回车提交（Ctrl+Enter 或 Cmd+Enter）
    this.inputEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (!this.btnEl.disabled) this.execute();
      }
    });
  }

  /** 执行粉碎流程 */
  async execute() {
    const text = this.inputEl.value.trim();
    if (!text || this.isProcessing) return;

    this.isProcessing = true;
    this.btnEl.disabled = true;
    this.btnEl.classList.remove('ready');

    // Step 1: 创建飞行文字
    const flyingEl = this.createFlyingText(text);

    // Step 2: 获取乌萨奇目标位置
    const targetPos = this.usagi.getPosition();

    // Step 3: GSAP飞行动画
    await this.animateFlyToUsagi(flyingEl, targetPos);

    // Step 4: 文字碎裂粒子效果
    this.shatterIntoParticles(flyingEl, targetPos);

    // Step 5: 乌萨奇吃掉动画
    setTimeout(() => {
      this.usagi.playEat();
    }, 200);

    // Step 6: 清理输入框 + 触发夸夸
    setTimeout(() => {
      this.inputEl.value = '';
      this.charCountEl.textContent = '0';
      this.isProcessing = false;
      if (this.onShredded) this.onShredded(text);
    }, 1000);
  }

  /** 创建飞行文字元素 */
  createFlyingText(text) {
    const el = document.createElement('div');
    el.className = 'flying-text';
    el.textContent = text.length > 30 ? text.slice(0, 30) + '...' : text;
    
    // 获取输入框位置作为起点
    const inputRect = this.inputEl.getBoundingClientRect();

    Object.assign(el.style, {
      position: 'fixed',
      left: inputRect.left + 'px',
      top: inputRect.top + 'px',
      padding: '10px 18px',
      fontFamily: 'var(--font-main)',
      fontSize: '1rem',
      fontWeight: '600',
      color: '#fff',
      background: 'linear-gradient(135deg, #FF7B54, #FF9F43)',
      borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(255,123,84,0.4)',
      zIndex: '20',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      maxWidth: '280px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });

    this.flyingLayer.appendChild(el);
    return el;
  }

  /**
   * GSAP飞行轨迹动画 — 抛物线飞向乌萨奇
   */
  animateFlyToUsagi(el, targetPos) {
    return new Promise((resolve) => {
      const startX = parseFloat(el.style.left);
      const startY = parseFloat(el.style.top);

      gsap.to(el, {
        duration: 0.8,
        x: targetPos.x - startX - 40,
        y: targetPos.y - startY - 60,
        rotation: Math.random() > 0.5 ? 15 : -15,
        scale: 0.45,
        opacity: 0.8,
        ease: 'power2.in',
        onComplete: resolve,
      });
    });
  }

  /**
   * 文字碎裂成彩色粒子效果
   */
  shatterIntoParticles(el, targetPos) {
    // 移除原元素
    el.remove();

    // 在目标位置创建碎裂粒子
    const particleCount = 14;
    const colors = ['#FFD700', '#FF9F43', '#FF6B81', '#6DD5FA', '#FFB6C1', '#98D8C8', '#FFE0E9'];

    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      const size = 4 + Math.random() * 10;
      const angle = (Math.PI * 2 / particleCount) * i + Math.random() * 0.5;
      const velocity = 50 + Math.random() * 120;
      const color = colors[Math.floor(Math.random() * colors.length)];

      Object.assign(particle.style, {
        position: 'fixed',
        left: targetPos.x + 'px',
        top: targetPos.y + 'px',
        width: size + 'px',
        height: size + 'px',
        borderRadius: Math.random() > 0.3 ? '50%' : '3px',
        background: color,
        zIndex: '25',
        pointerEvents: 'none',
        opacity: '1',
        boxShadow: `0 0 ${size}px ${color}`,
      });

      this.flyingLayer.appendChild(particle);

      // GSAP粒子爆炸
      gsap.to(particle, {
        duration: 0.6 + Math.random() * 0.5,
        x: Math.cos(angle) * velocity,
        y: Math.sin(angle) * velocity + 40, // 轻微重力下坠
        rotation: Math.random() * 360,
        scale: 0,
        opacity: 0,
        ease: 'power2.out',
        onComplete: () => particle.remove(),
      });
    }
  }
}
