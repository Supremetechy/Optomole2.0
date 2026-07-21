/**
 * Collectible — a key item or objective the player walks over to pick up.
 *
 * Represents evidence/procedure-step bindings. Floats and spins to read as
 * interactable; on pickup it plays a burst of particles and reports its reward
 * so the QuestEngine can grant XP and (for keys) unlock the room's gate.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = { fill: 0xcbd5e1, fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: '600' };

export class Collectible {
  constructor(ctx, spec, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.isKey = spec.entityType === 'key-item';
    this.pickupRadius = 34;
    this.collected = false;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    const texKey = this.isKey ? 'key' : 'objective';
    this.sprite = new PIXI.Sprite(ctx.assets.get(texKey));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 34;
    this.sprite.height = 34;
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({ text: shorten(spec.label), style: LABEL_STYLE });
    this.label.anchor.set(0.5, 0);
    this.label.y = 22;
    this.container.addChild(this.label);

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
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.pickupRadius;
  }

  collect() {
    if (this.collected) return this.spec.reward || {};
    this.collected = true;
    this.sprite.visible = false;
    this.label.visible = false;
    this._burst();
    this.ctx.audio?.play('pickup');
    return this.spec.reward || {};
  }

  _burst() {
    for (let i = 0; i < 10; i++) {
      const p = new PIXI.Sprite(this.ctx.assets.get('particle'));
      p.anchor.set(0.5);
      const s = 0.4 + Math.random() * 0.7;
      p.scale.set(s);
      p.tint = this.isKey ? 0x34d399 : 0xa78bfa;
      const ang = (i / 10) * Math.PI * 2;
      p._vx = Math.cos(ang) * (40 + Math.random() * 60);
      p._vy = Math.sin(ang) * (40 + Math.random() * 60);
      p._life = 0.6;
      this.container.addChild(p);
      this._particles.push(p);
    }
  }

  update(dt) {
    if (!this.collected) {
      this._t += dt;
      this.sprite.y = Math.sin(this._t * 3) * 4;
      this.sprite.rotation = Math.sin(this._t * 1.5) * 0.3;
    }
    for (const p of this._particles) {
      p._life -= dt;
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      p.alpha = Math.max(0, p._life / 0.6);
      p.scale.x = p.scale.y = Math.max(0.05, p.scale.x - dt);
    }
    this._particles = this._particles.filter((p) => {
      if (p._life <= 0) {
        p.destroy();
        return false;
      }
      return true;
    });
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
