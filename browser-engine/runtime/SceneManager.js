/**
 * SceneManager — a scene stack with fade transitions.
 *
 * Scenes are plain objects/instances exposing:
 *   container : PIXI.Container   (its display root)
 *   enter(ctx)                   (called when it becomes active)
 *   exit()                       (called when removed)
 *   update(dt)                   (per-frame, dt in seconds)
 *   resize(w, h)                 (optional)
 *
 * replace() swaps the active scene with a fade (boot -> room -> reward).
 * push()/pop() overlay a scene without destroying the one beneath (room ->
 * dialogue -> back to room). This gives the runtime the boot / gameplay /
 * dialogue / reward scene flow the engine was missing.
 */
const PIXI = window.PIXI;

export class SceneManager {
  constructor(ctx) {
    this.ctx = ctx; // shared services { state, assets, audio, input, scenes, runtime }
    this.root = new PIXI.Container();
    this.stack = [];

    this.overlay = new PIXI.Graphics();
    this.overlay.eventMode = 'none';
    this._fade = { active: false, dir: 0, t: 0, dur: 0.28, onMid: null };
    this._pending = null;
  }

  get current() {
    return this.stack[this.stack.length - 1] || null;
  }

  _drawOverlay(w, h, alpha) {
    this.overlay.clear();
    this.overlay.rect(0, 0, w, h).fill({ color: 0x030712, alpha });
  }

  /** Fade out, swap the whole stack for `scene`, fade in. */
  replace(scene) {
    this._transition(() => {
      this._teardownAll();
      this._activate(scene);
    });
  }

  /** Overlay a scene on top of the current one (no teardown). */
  push(scene) {
    this._transition(() => this._activate(scene, true));
  }

  /** Remove the top scene, revealing the one beneath. */
  pop() {
    if (this.stack.length <= 1) return;
    this._transition(() => {
      const top = this.stack.pop();
      this._teardown(top);
      const below = this.current;
      if (below?.container) below.container.visible = true;
    });
  }

  _activate(scene, keepBelow = false) {
    if (keepBelow && this.current?.container) {
      this.current.container.visible = false;
    }
    this.stack.push(scene);
    if (scene.container) this.root.addChild(scene.container);
    const size = this.ctx.runtime.size();
    scene.enter?.(this.ctx);
    scene.resize?.(size.width, size.height);
  }

  _teardown(scene) {
    if (!scene) return;
    try {
      scene.exit?.();
    } catch (err) {
      console.error('[SceneManager] scene exit error', err);
    }
    if (scene.container) {
      this.root.removeChild(scene.container);
      scene.container.destroy({ children: true });
    }
  }

  _teardownAll() {
    while (this.stack.length) this._teardown(this.stack.pop());
  }

  _transition(midpointFn) {
    // Keep overlay on top of everything.
    this.root.addChild(this.overlay);
    this._fade = { active: true, dir: 1, t: 0, dur: 0.28, onMid: midpointFn };
  }

  update(dt) {
    if (this._fade.active) {
      this._fade.t += dt;
      const half = this._fade.dur;
      const size = this.ctx.runtime.size();
      if (this._fade.dir === 1) {
        const a = Math.min(1, this._fade.t / half);
        this._drawOverlay(size.width, size.height, a);
        if (a >= 1) {
          this._fade.onMid?.();
          this._fade.dir = -1;
          this._fade.t = 0;
        }
      } else {
        const a = Math.max(0, 1 - this._fade.t / half);
        this._drawOverlay(size.width, size.height, a);
        if (a <= 0) {
          this._fade.active = false;
          this.root.removeChild(this.overlay);
        }
      }
    }
    this.current?.update?.(dt);
  }

  resize(w, h) {
    if (this._fade.active) this._drawOverlay(w, h, this._fade.dir === 1 ? 1 : 0);
    for (const scene of this.stack) scene.resize?.(w, h);
  }
}