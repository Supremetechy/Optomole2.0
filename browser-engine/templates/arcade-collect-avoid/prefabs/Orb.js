/**
 * Orb — a drifting concept the player either collects or dodges.
 *
 * One prefab, three variants keyed by `kind`:
 *   - 'good'    a correct concept → collect it (auto-pickup on proximity) for score
 *   - 'bad'     a decoy / wrong concept → touching it costs integrity
 *   - 'power'   a power-up → collect for a short shield + score multiplier
 *
 * Orbs move themselves with a velocity and reflect off the arena bounds (no
 * Matter body needed — proximity pickup and reflection are cheaper and let dozens
 * of orbs share the field). `bad` orbs may gently home toward the player to make
 * "avoid" an active skill rather than a static obstacle.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = { fill: 0xcbd5e1, fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: '600' };

const TEX = { good: 'orb-good', bad: 'orb-bad', power: 'powerup' };
const TINT = { good: 0x34d399, bad: 0xfb7185, power: 0xa78bfa };

export class Orb {
  constructor(ctx, spec, { x = 0, y = 0, kind = 'good', speed = 60, homing = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.kind = kind;
    this.radius = kind === 'power' ? 22 : 20;
    this.pickupRadius = kind === 'power' ? 30 : 30;
    this.collected = false;
    this.homing = homing; // 0..1 fraction of velocity steered toward the player (bad orbs)

    const ang = Math.random() * Math.PI * 2;
    this.vx = Math.cos(ang) * speed;
    this.vy = Math.sin(ang) * speed;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.sprite = new PIXI.Sprite(ctx.assets.get(TEX[kind] || 'orb-good'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = this.radius * 2.2;
    this.sprite.height = this.radius * 2.2;
    this.container.addChild(this.sprite);

    // Only good/power orbs are labelled — decoys stay unlabelled so telling
    // "correct" from "wrong" is part of the play, matching the concept fields.
    if (kind !== 'bad') {
      this.label = new PIXI.Text({ text: shorten(spec.label), style: LABEL_STYLE });
      this.label.anchor.set(0.5, 0);
      this.label.y = this.radius + 4;
      this.container.addChild(this.label);
    }

    this._t = Math.random() * Math.PI * 2;
    this._particles = [];
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  addTo(container) {
    container.addChild(this.container);
  }

  isNear(pos) {
    if (this.collected) return false;
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.pickupRadius + 12;
  }

  collect() {
    if (this.collected) return this.spec.reward || {};
    this.collected = true;
    this.sprite.visible = false;
    if (this.label) this.label.visible = false;
    this._burst();
    this.ctx.audio?.play(this.kind === 'power' ? 'unlock' : 'pickup');
    return this.spec.reward || {};
  }

  _burst() {
    const tint = TINT[this.kind] || 0x34d399;
    for (let i = 0; i < 12; i++) {
      const p = new PIXI.Sprite(this.ctx.assets.get('particle'));
      p.anchor.set(0.5);
      p.scale.set(0.4 + Math.random() * 0.7);
      p.tint = tint;
      const ang = (i / 12) * Math.PI * 2;
      p._vx = Math.cos(ang) * (60 + Math.random() * 80);
      p._vy = Math.sin(ang) * (60 + Math.random() * 80);
      p._life = 0.6;
      this.container.addChild(p);
      this._particles.push(p);
    }
  }

  /** Advance motion within `bounds` {x,y,w,h}; steer toward `ppos` if homing. */
  update(dt, bounds, ppos) {
    if (!this.collected) {
      this._t += dt;

      if (this.homing && ppos) {
        const dx = ppos.x - this.container.x;
        const dy = ppos.y - this.container.y;
        const len = Math.hypot(dx, dy) || 1;
        const target = 70; // homing pull speed
        this.vx += ((dx / len) * target - this.vx) * this.homing * dt;
        this.vy += ((dy / len) * target - this.vy) * this.homing * dt;
      }

      this.container.x += this.vx * dt;
      this.container.y += this.vy * dt;

      // Reflect off the arena bounds.
      if (bounds) {
        const r = this.radius;
        if (this.container.x < bounds.x + r) { this.container.x = bounds.x + r; this.vx = Math.abs(this.vx); }
        if (this.container.x > bounds.x + bounds.w - r) { this.container.x = bounds.x + bounds.w - r; this.vx = -Math.abs(this.vx); }
        if (this.container.y < bounds.y + r) { this.container.y = bounds.y + r; this.vy = Math.abs(this.vy); }
        if (this.container.y > bounds.y + bounds.h - r) { this.container.y = bounds.y + bounds.h - r; this.vy = -Math.abs(this.vy); }
      }

      // Idle animation: goods gently pulse, decoys wobble/rotate as a "danger" tell.
      if (this.kind === 'bad') {
        this.sprite.rotation += dt * 3;
        this.sprite.scale.set((this.radius * 2.2 / this.sprite.texture.width) * (1 + Math.sin(this._t * 8) * 0.1));
      } else {
        this.sprite.scale.set((this.radius * 2.2 / this.sprite.texture.width) * (1 + Math.sin(this._t * 4) * 0.08));
      }
    }

    for (const p of this._particles) {
      p._life -= dt;
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      p.alpha = Math.max(0, p._life / 0.6);
      p.scale.x = p.scale.y = Math.max(0.05, p.scale.x - dt);
    }
    this._particles = this._particles.filter((p) => {
      if (p._life <= 0) { p.destroy(); return false; }
      return true;
    });
  }

  /** Bad-orb contact test; respects nothing here (cooldown lives on the scene). */
  touches(pos) {
    if (this.collected) return false;
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.pickupRadius;
  }

  get done() {
    return this.collected && this._particles.length === 0;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 22) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
