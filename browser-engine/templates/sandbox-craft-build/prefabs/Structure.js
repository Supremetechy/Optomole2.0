/**
 * Structure (sandbox-craft-build) — a crafted procedure step, standing on the
 * map as something the player built.
 *
 * It rises out of the ground on placement (a short grow animation) and keeps its
 * label permanently visible. The standing skyline of structures is the run's
 * progress bar: the player can see, at a glance, how much of the procedure they
 * have actually assembled.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '800',
  fill: 0x34d399,
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 150,
};

export class Structure {
  constructor(ctx, spec, { x = 0, y = 0, tier = 1 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.tier = tier;
    this.size = 44 + tier * 6;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.glow = new PIXI.Graphics();
    this.glow.circle(0, 0, this.size).fill({ color: 0x34d399, alpha: 0.1 });
    this.container.addChild(this.glow);

    this.sprite = new PIXI.Sprite(ctx.assets.get('structure'));
    this.sprite.anchor.set(0.5, 0.9);
    this.sprite.width = this.size;
    this.sprite.height = this.size;
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({ text: shorten(spec.label), style: LABEL_STYLE });
    this.label.anchor.set(0.5, 0);
    this.label.y = this.size * 0.2 + 6;
    this.container.addChild(this.label);

    this._t = 0;
    this._grow = 0; // 0..1 placement animation
    this.ctx.audio?.play('unlock');
  }

  addTo(container) {
    container.addChild(this.container);
  }

  update(dt) {
    this._t += dt;
    if (this._grow < 1) {
      this._grow = Math.min(1, this._grow + dt * 2.2);
      // Ease-out so it lands rather than snapping into place.
      const e = 1 - Math.pow(1 - this._grow, 3);
      this.sprite.scale.set((this.size / this.sprite.texture.width) * e);
      this.container.alpha = e;
    }
    this.glow.alpha = 0.6 + Math.sin(this._t * 2) * 0.4;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 30) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
