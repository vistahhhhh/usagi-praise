import gsap from 'gsap';

export class PraiseBubble {
  constructor(containerId, onShow) {
    this.containerId = containerId || 'praise-container';
    this.container = document.getElementById(this.containerId);
    this.onShow = onShow;
    this._currentBubble = null;
  }

  /**
   * 显示气泡
   * @param {string} customText — 直接显示的文本（API已返回的情况）
   * @returns {{ text: string, type: string }} 本次的夸夸信息
   */
  show(customText) {
    var text = customText || '';
    var type = 'gentle';

    this.clear();

    var bubble = document.createElement('div');
    bubble.className = 'praise-bubble ' + type;
    this.container.appendChild(bubble);
    this._currentBubble = bubble;

    if (text) {
      // 有文本，直接打字显示
      gsap.fromTo(bubble,
        { opacity: 0, scale: 0.5, y: 30 },
        {
          opacity: 1, scale: 1, y: 0,
          duration: 0.7,
          ease: 'elastic.out(1, 0.5)',
          onComplete: function() {
            this.typeWriter(bubble, text);
            if (this.onShow) this.onShow(type);
          }.bind(this)
        }
      );
    }

    return { text: text, type: type, bubble: bubble };
  }

  /**
   * 先显示"思考中"气泡，等API返回后再替换为真实文本
   * @param {Promise<string>} replyPromise — 异步获取的回复文本
   * @returns {{ bubble: HTMLElement, type: string }}
   */
  showAsync(replyPromise) {
    this.clear();

    var bubble = document.createElement('div');
    bubble.className = 'praise-bubble gentle';
    this.container.appendChild(bubble);
    this._currentBubble = bubble;

    var self = this;

    // 先弹出气泡，显示"噗噜噜…"思考中
    gsap.fromTo(bubble,
      { opacity: 0, scale: 0.5, y: 30 },
      {
        opacity: 1, scale: 1, y: 0,
        duration: 0.7,
        ease: 'elastic.out(1, 0.5)',
        onComplete: function() {
          // 显示思考中动画
          self._showThinking(bubble);
          if (self.onShow) self.onShow('gentle');
        }
      }
    );

    // API 返回后替换文本
    replyPromise.then(function(replyText) {
      if (self._currentBubble !== bubble) return; // 气泡已被清除
      self._stopThinking(bubble);
      self.typeWriter(bubble, replyText);
    }).catch(function(err) {
      console.error('[PraiseBubble] Async reply failed:', err);
      if (self._currentBubble !== bubble) return;
      self._stopThinking(bubble);
      self.typeWriter(bubble, '噗噜噜…乌萨奇吃掉了烦恼！呀哈！你超棒的！');
    });

    return { bubble: bubble, type: 'gentle' };
  }

  /** 显示"噗噜噜…"思考动画 */
  _showThinking(element) {
    element.classList.add('typing-cursor');
    element._thinkingInterval = setInterval(function() {
      var dots = element.textContent;
      if (dots.length >= 9) {
        element.textContent = '噗噜噜';
      } else {
        element.textContent = dots + '…';
      }
    }, 400);
    element.textContent = '噗噜噜';
  }

  /** 停止思考动画 */
  _stopThinking(element) {
    if (element._thinkingInterval) {
      clearInterval(element._thinkingInterval);
      element._thinkingInterval = null;
    }
    element.classList.remove('typing-cursor');
  }

  typeWriter(element, fullText) {
    element.classList.add('typing-cursor');
    var charIndex = 0;
    var self = this;

    var typeInterval = setInterval(function() {
      if (charIndex < fullText.length) {
        element.textContent = fullText.slice(0, charIndex + 1);
        charIndex++;
      } else {
        clearInterval(typeInterval);
        element.classList.remove('typing-cursor');
        // ★ 打字完成后3秒自动消散
        self._autoDismiss(element);
      }
    }, 55);

    // 安全超时：8秒还没打完就强制完成并消散（AI回复可能较长）
    setTimeout(function() {
      clearInterval(typeInterval);
      element.textContent = fullText;
      element.classList.remove('typing-cursor');
      if (self._currentBubble === element) {
        self._autoDismiss(element);
      }
    }, 8000);
  }

  /** ★ 打字完成后延迟3秒自动消散 */
  _autoDismiss(element) {
    var self = this;
    setTimeout(function() {
      if (element && element.parentNode) {
        gsap.to(element, {
          opacity: 0,
          y: -20,
          scale: 0.85,
          duration: 0.6,
          ease: 'power2.in',
          onComplete: function() {
            if (element.parentNode) element.remove();
            if (self._currentBubble === element) self._currentBubble = null;
          }
        });
      }
    }, 3000);
  }

  clear() {
    if (!this.container || !this.container.lastChild) return;
    var oldBubble = this.container.lastChild;
    if (oldBubble._thinkingInterval) {
      clearInterval(oldBubble._thinkingInterval);
    }
    gsap.to(oldBubble, {
      opacity: 0,
      y: -15,
      scale: 0.9,
      duration: 0.3,
      onComplete: function() { oldBubble.remove(); }
    });
  }
}
