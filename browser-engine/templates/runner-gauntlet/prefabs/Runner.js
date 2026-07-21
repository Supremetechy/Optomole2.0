/**
 * Runner (runner-gauntlet) — the auto-running avatar.
 *
 * Hand-rolled physics: the runner is always moving right at the course pace, and
 * the only input is jump. Gravity is constant, a second jump is allowed while
 * airborne, and holding the jump input slightly extends the rise (variable jump
 * height) — the small detail that makes a runner feel controllable rather than
 * scripted.
 *
 * The runner's x stays fixed on screen; the world scrolls past it, so `x` here
 * is screen-space and `distance` is the real course position.
 */
import { GRAVITY, JUMP_VELOCITY } from '../entity-factory.js';

const PIXI = window.PIXI;

export const RUNNER_W = 30;
export const RUNNER_H = 40;
const CUT_GRAVITY = 3.1; // extra gravity applied when jump is released early

export class Runner {
  constructor(ctx, { x = 160, groundY = 0 } = {}) {
    this.ctx = ctx;
    this.x = x;
    this.groundY = groundY;
    this.y = groundY;
    this.vy = 0;
    this.grounded = true;
    this.jumpsUsed = 0;
    this.dead = false;
    this.invuln = 0;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = groundY;

    this.trail = new PIXI.Graphics();
    this.container.addChild(this.trail);

    this.sprite = new PIXI.Sprite(ctx.assets.get('runner'));
    this.sprite.anchor.set(0.5, 1);
    this.sprite.width = RUNNER_W;
    this.sprite.height = RUNNER_H;
    this.container.addChild(this.sprite);

    this._t = 0;
    this._flash = 0;
    this._squash = 0;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  /** Axis-aligned box in world-ish space (x is screen-fixed). */
  get bounds() {
    return {
      left: this.x - RUNNER_W / 2,
      right: this.x + RUNNER_W / 2,
      top: this.y - RUNNER_H,
      bottom: this.y,
    };
  }

  jump() {
    if (this.dead) return false;
    // Ground jump, or one mid-air jump. Coyote-free: readable and consistent.
    if (this.grounded) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
      this.jumpsUsed = 1;
      this._squash = 0.18;
      this.ctx.audio?.play('pickup');
      return true;
    }
    if (this.jumpsUsed < 2) {
      this.vy = JUMP_VELOCITY * 0.86;
      this.jumpsUsed = 2;
      this._squash = 0.14;
      this.ctx.audio?.play('pickup');
      return true;
    }
    return false;
  }

  hit() {
    if (this.invuln > 0 || this.dead) return false;
    this.invuln = 1.1;
    this._flash = 0.4;
    this.ctx.audio?.play('failure');
    return true;
  }

  update(dt, { jumpHeld = false } = {}) {
    this._t += dt;

    // Variable jump height: releasing early cuts the rise short.
    const g = (!this.grounded && this.vy < 0 && !jumpHeld) ? GRAVITY * CUT_GRAVITY : GRAVITY;
    this.vy += g * dt;
    this.y += this.vy * dt;

    if (this.y >= this.groundY) {
      if (!this.grounded) this._squash = 0.16;
      this.y = this.groundY;
      this.vy = 0;
      this.grounded = true;
      this.jumpsUsed = 0;
    }

    this.container.y = this.y;

    // Run cycle: bob on the ground, tilt in the air.
    if (this.grounded) {
      this.sprite.y = Math.sin(this._t * 22) * 2;
      this.sprite.rotation = Math.sin(this._t * 22) * 0.05;
    } else {
      this.sprite.y = 0;
      this.sprite.rotation = clamp(this.vy / 1800, -0.3, 0.4);
    }

    // Squash-and-stretch on takeoff and landing.
    if (this._squash > 0) {
      this._squash = Math.max(0, this._squash - dt);
      const s = this._squash / 0.18;
      this.sprite.width = RUNNER_W * (1 + s * 0.25);
      this.sprite.height = RUNNER_H * (1 - s * 0.2);
    } else {
      this.sprite.width = RUNNER_W;
      this.sprite.height = RUNNER_H;
    }

    if (this.invuln > 0) {
      this.invuln = Math.max(0, this.invuln - dt);
      // Blink while invulnerable so the state is legible.
      this.sprite.alpha = Math.sin(this._t * 30) > 0 ? 1 : 0.35;
    } else {
      this.sprite.alpha = 1;
    }

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt);
      this.sprite.tint = 0xfb7185;
    } else {
      this.sprite.tint = 0xffffff;
    }

    // Speed trail when airborne — cheap motion cue.
    this.trail.clear();
    if (!this.grounded) {
      this.trail.moveTo(-RUNNER_W / 2 - 6, -RUNNER_H * 0.6)
        .lineTo(-RUNNER_W / 2 - 22, -RUNNER_H * 0.6)
        .stroke({ width: 2, color: 0x67e8f9, alpha: 0.35 });
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
