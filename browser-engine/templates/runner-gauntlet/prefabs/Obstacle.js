/**
 * Obstacle (runner-gauntlet) — a hazard from the source content, standing in the
 * lane as something to jump.
 *
 * Carries its own warning label so the player can read what they are jumping
 * before they reach it — the hazard text is the teaching moment, and it has to
 * arrive *before* the collision, not after.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '800',
  fill: 0xfb7185,
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 150,
};

export class Obstacle {
  constructor(ctx, spec, { x = 0, groundY = 0, height = 46 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.courseX = x;
    this.height = height;
    this.width = 46;
    this.cleared = false;
    this.struck = false;

    this.container = new PIXI.Container();
    this.container.y = groundY;

    this.sprite = new PIXI.Sprite(ctx.assets.get('spike'));
    this.sprite.anchor.set(0.5, 1);
    this.sprite.width = this.width;
    this.sprite.height = height;
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({ text: shorten(spec.label), style: LABEL_STYLE });
    this.label.anchor.set(0.5, 1);
    this.label.y = -height - 8;
    this.container.addChild(this.label);

    this._t = Math.random() * Math.PI * 2;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  /** Collision box in the runner's coordinate space, given the scroll offset. */
  boundsAt(scrollX) {
    const screenX = this.courseX - scrollX;
    return {
      left: screenX - this.width / 2 + 8,   // forgiving hitbox: 8px inset each side
      right: screenX + this.width / 2 - 8,
      top: this.container.y - this.height,
      bottom: this.container.y,
    };
  }

  markStruck() {
    if (this.struck) return false;
    this.struck = true;
    this.sprite.alpha = 0.4;
    this.label.style.fill = 0x7f1d1d;
    return true;
  }

  markCleared() {
    if (this.cleared || this.struck) return false;
    this.cleared = true;
    this.label.style.fill = 0x34d399;
    return true;
  }

  update(dt, scrollX) {
    this._t += dt;
    this.container.x = this.courseX - scrollX;
    if (!this.struck) this.sprite.rotation = Math.sin(this._t * 6) * 0.03;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 30) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
