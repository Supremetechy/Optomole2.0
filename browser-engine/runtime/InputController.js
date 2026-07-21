/**
 * InputController — unified keyboard + touch input.
 *
 * Exposes a normalized movement axis (-1..1 on x/y) and a debounced "interact"
 * signal, sourced from whichever input the player uses:
 *   - Desktop: WASD / arrow keys to move, E or Space to interact.
 *   - Touch: a virtual joystick (drag anywhere on the left of the screen) to
 *     move, plus a floating INTERACT button; a quick tap also interacts.
 *
 * A small DOM knob gives mobile touch feedback. Rendering-agnostic: scenes just
 * read getAxis() / consumeInteract() each frame.
 */
export class InputController {
  constructor(mount) {
    this.mount = mount || document.body;
    this.keys = new Set();
    this.axis = { x: 0, y: 0 };
    this._interactQueued = false;
    this._interactHandlers = new Set();

    this.touch = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this._buildTouchUi();
    this._bind();
  }

  onInteract(fn) {
    this._interactHandlers.add(fn);
    return () => this._interactHandlers.delete(fn);
  }

  /** Returns a normalized {x,y} movement vector (length clamped to 1). */
  getAxis() {
    let x = 0;
    let y = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;

    if (this.touch.active) {
      x += this.touch.dx;
      y += this.touch.dy;
    }

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.axis.x = x;
    this.axis.y = y;
    return this.axis;
  }

  /** True once per interact press; clears the flag. */
  consumeInteract() {
    if (this._interactQueued) {
      this._interactQueued = false;
      return true;
    }
    return false;
  }

  _fireInteract() {
    this._interactQueued = true;
    for (const fn of this._interactHandlers) {
      try {
        fn();
      } catch (err) {
        console.error('[InputController] interact handler error', err);
      }
    }
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'e' || k === ' ' || k === 'enter') {
        e.preventDefault();
        this._fireInteract();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    const el = this.mount;
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this._onPointerMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this._onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this._onPointerUp(e));
  }

  _onPointerDown(e) {
    // Right ~30% of the screen or the interact button = interact; else joystick.
    if (this._overInteractButton(e.target)) {
      this._fireInteract();
      return;
    }
    if (e.clientX > window.innerWidth * 0.7) {
      this._fireInteract();
      return;
    }
    this.touch.active = true;
    this.touch.id = e.pointerId;
    this.touch.ox = e.clientX;
    this.touch.oy = e.clientY;
    this.touch.dx = 0;
    this.touch.dy = 0;
    this._showKnob(e.clientX, e.clientY);
  }

  _onPointerMove(e) {
    if (!this.touch.active || e.pointerId !== this.touch.id) return;
    const maxR = 56;
    let dx = e.clientX - this.touch.ox;
    let dy = e.clientY - this.touch.oy;
    const len = Math.hypot(dx, dy);
    if (len > maxR) {
      dx = (dx / len) * maxR;
      dy = (dy / len) * maxR;
    }
    this.touch.dx = dx / maxR;
    this.touch.dy = dy / maxR;
    this._moveKnob(dx, dy);
  }

  _onPointerUp(e) {
    if (e.pointerId !== this.touch.id) return;
    this.touch.active = false;
    this.touch.dx = 0;
    this.touch.dy = 0;
    this._hideKnob();
  }

  _overInteractButton(target) {
    return target === this._btn || (target && target.closest && target.closest('#oe-interact'));
  }

  // ---- Touch DOM feedback ---------------------------------------------------

  _buildTouchUi() {
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;
    const base = document.createElement('div');
    base.id = 'oe-joystick';
    base.style.cssText =
      'position:fixed;z-index:40;width:96px;height:96px;border-radius:50%;border:2px solid rgba(103,232,249,.4);background:rgba(5,12,24,.4);pointer-events:none;display:none;transform:translate(-50%,-50%);';
    const knob = document.createElement('div');
    knob.style.cssText =
      'position:absolute;left:50%;top:50%;width:44px;height:44px;border-radius:50%;background:rgba(103,232,249,.55);transform:translate(-50%,-50%);';
    base.appendChild(knob);
    document.body.appendChild(base);
    this._joystick = base;
    this._knob = knob;

    const btn = document.createElement('button');
    btn.id = 'oe-interact';
    btn.textContent = 'INTERACT';
    btn.style.cssText =
      'position:fixed;z-index:41;right:20px;bottom:28px;padding:16px 20px;border:0;border-radius:999px;font-weight:900;background:#67e8f9;color:#03131d;box-shadow:0 12px 40px rgba(0,0,0,.4);';
    document.body.appendChild(btn);
    this._btn = btn;
  }

  _showKnob(x, y) {
    if (!this._joystick) return;
    this._joystick.style.left = `${x}px`;
    this._joystick.style.top = `${y}px`;
    this._joystick.style.display = 'block';
    this._moveKnob(0, 0);
  }

  _moveKnob(dx, dy) {
    if (!this._knob) return;
    this._knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _hideKnob() {
    if (this._joystick) this._joystick.style.display = 'none';
  }
}