/**
 * Hazard — a mistake/risk the player must avoid.
 *
 * Represents hazard bindings (spills, unsafe shortcuts, warnings). Pulses to
 * signal danger and drifts along a small patrol path so it must be dodged.
 * Contact drains focus (with a cooldown so a single brush doesn't nuke it) and
 * surfaces the teaching "why this is a hazard" note.
 */
const PIXI = window.PIXI;

export class Hazard {
  constructor(ctx, spec, { x = 0, y = 0, patrol = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.damageRadius = 30;
    this.cooldown = 0;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this._homeX = x;
    this._homeY = y;
    this._patrol = patrol;

    this.sprite = new PIXI.Sprite(ctx.assets.get('hazard'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 36;
    this.sprite.height = 32;
    this.container.addChild(this.sprite);

    this._t = Math.random() * Math.PI * 2;
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  addTo(container) {
    container.addChild(this.container);
  }

  update(dt) {
    this._t += dt;
    const pulse = 1 + Math.sin(this._t * 6) * 0.12;
    this.sprite.scale.set((36 / this.sprite.texture.width) * pulse);
    if (this._patrol) {
      this.container.x = this._homeX + Math.sin(this._t * 1.1) * this._patrol;
    }
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /** Returns the hazard note once per contact (respects cooldown), else null. */
  touch(pos) {
    const hit = Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.damageRadius;
    if (hit && this.cooldown === 0) {
      this.cooldown = 1.2;
      return this.spec.description || this.spec.evidence || `Hazard: ${this.spec.label}`;
    }
    return null;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
