/**
 * Token (runner-gauntlet) — a fact from the source content, floating on the
 * course as something to grab in passing.
 *
 * Tokens are the reward line: they sit just past obstacles and at jump apex, so
 * collecting the whole set requires jumping well rather than merely surviving.
 * The fact's label rides with the token and flashes on pickup.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 10,
  fontWeight: '700',
  fill: 0xfbbf24,
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 130,
};

export class Token {
  constructor(ctx, spec, { x = 0, y = -60, groundY = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.courseX = x;
    this.offsetY = y;
    this.radius = 16;
    this.collected = false;

    this.container = new PIXI.Container();
    this.container.y = groundY + y;

    this.sprite = new PIXI.Sprite(ctx.assets.get('coin'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = this.radius * 2;
    this.sprite.height = this.radius * 2;
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({ text: shorten(spec.label), style: LABEL_STYLE });
    this.label.anchor.set(0.5, 0);
    this.label.y = this.radius + 4;
    this.container.addChild(this.label);

    this._t = Math.random() * Math.PI * 2;
    this._particles = [];
  }

  addTo(container) {
    container.addChild(this.container);
  }

  boundsAt(scrollX) {
    const screenX = this.courseX - scrollX;
    return {
      left: screenX - this.radius,
      right: screenX + this.radius,
      top: this.container.y - this.radius,
      bottom: this.container.y + this.radius,
    };
  }

  collect() {
    if (this.collected) return this.spec.reward || {};
    this.collected = true;
    this.sprite.visible = false;
    this.label.style.fill = 0x34d399;
    this.label.text = `✓ ${shorten(this.spec.label)}`;
    this._burst();
    this.ctx.audio?.play('pickup');
    return this.spec.reward || {};
  }

  _burst() {
    for (let i = 0; i < 8; i++) {
      const p = new PIXI.Sprite(this.ctx.assets.get('particle'));
      p.anchor.set(0.5);
      p.scale.set(0.25 + Math.random() * 0.4);
      p.tint = 0xfbbf24;
      const ang = (i / 8) * Math.PI * 2;
      p._vx = Math.cos(ang) * (50 + Math.random() * 50);
      p._vy = Math.sin(ang) * (50 + Math.random() * 50);
      p._life = 0.45;
      this.container.addChild(p);
      this._particles.push(p);
    }
  }

  update(dt, scrollX) {
    this._t += dt;
    this.container.x = this.courseX - scrollX;

    if (!this.collected) {
      this.sprite.y = Math.sin(this._t * 3) * 5;
      // Spin the coin by squashing its width — cheap 2.5D shimmer.
      this.sprite.scale.x = (this.radius * 2 / this.sprite.texture.width) * Math.cos(this._t * 3);
    }

    for (const p of this._particles) {
      p._life -= dt;
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      p.alpha = Math.max(0, p._life / 0.45);
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

function shorten(text, max = 24) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
