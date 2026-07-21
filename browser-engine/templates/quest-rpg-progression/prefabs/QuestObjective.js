/**
 * QuestObjective (quest-rpg-progression) — one fact from the source content,
 * standing in the world as something to walk over and log.
 *
 * Proximity pickup (no Matter body — objectives should never block movement),
 * a floating label so the player can read the fact before taking it, and a
 * pickup burst. Collecting it completes the matching QuestEngine objective.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = {
  fill: 0xcbd5e1,
  fontSize: 11,
  fontFamily: 'Inter, system-ui, sans-serif',
  fontWeight: '600',
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 130,
};

export class QuestObjective {
  constructor(ctx, spec, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.collected = false;
    this.radius = 18;
    this.pickupRadius = 34;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.halo = new PIXI.Graphics();
    this.halo.circle(0, 0, this.radius + 10).fill({ color: 0xa78bfa, alpha: 0.12 });
    this.container.addChild(this.halo);

    this.sprite = new PIXI.Sprite(ctx.assets.get('objective'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = this.radius * 2;
    this.sprite.height = this.radius * 2;
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({ text: shorten(spec.label), style: LABEL_STYLE });
    this.label.anchor.set(0.5, 0);
    this.label.y = this.radius + 6;
    this.container.addChild(this.label);

    this._t = Math.random() * Math.PI * 2;
    this._particles = [];
  }

  addTo(container) {
    container.addChild(this.container);
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  isNear(pos) {
    if (this.collected) return false;
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.pickupRadius;
  }

  collect() {
    if (this.collected) return this.spec.reward || {};
    this.collected = true;
    this.sprite.visible = false;
    this.halo.visible = false;
    this.label.style.fill = 0x34d399;
    this.label.text = `✓ ${shorten(this.spec.label)}`;
    this._burst();
    this.ctx.audio?.play('pickup');
    return this.spec.reward || {};
  }

  _burst() {
    for (let i = 0; i < 10; i++) {
      const p = new PIXI.Sprite(this.ctx.assets.get('particle'));
      p.anchor.set(0.5);
      p.scale.set(0.35 + Math.random() * 0.6);
      p.tint = 0xa78bfa;
      const ang = (i / 10) * Math.PI * 2;
      p._vx = Math.cos(ang) * (50 + Math.random() * 70);
      p._vy = Math.sin(ang) * (50 + Math.random() * 70);
      p._life = 0.6;
      this.container.addChild(p);
      this._particles.push(p);
    }
  }

  update(dt) {
    if (!this.collected) {
      this._t += dt;
      this.sprite.y = Math.sin(this._t * 2.5) * 3;
      this.sprite.rotation = Math.sin(this._t * 1.4) * 0.25;
      this.halo.alpha = 0.7 + Math.sin(this._t * 3) * 0.3;
    }

    for (const p of this._particles) {
      p._life -= dt;
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      p.alpha = Math.max(0, p._life / 0.6);
    }
    this._particles = this._particles.filter((p) => {
      if (p._life <= 0) { p.destroy(); return false; }
      return true;
    });
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 30) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}