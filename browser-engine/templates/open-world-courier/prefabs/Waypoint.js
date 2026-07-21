/**
 * Waypoint (open-world-courier) — a pickup or drop-off marker on a road tile.
 *
 * Renders as a pulsing ground ring with the contract's label, plus a vertical
 * light column so it can be spotted from a block away. Only the waypoints
 * relevant to the player's current state are shown active: available pickups
 * when hands are empty, the matching drop-off while carrying cargo.
 */
const PIXI = window.PIXI;

const ACCENT = { pickup: 0x34d399, dropoff: 0xa78bfa };

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 150,
};

export class Waypoint {
  constructor(ctx, spec, { x = 0, y = 0, kind = 'pickup', label } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.kind = kind;
    this.radius = 34;
    this.active = true;
    this.consumed = false;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.column = new PIXI.Graphics();
    this.column.rect(-4, -170, 8, 170).fill({ color: ACCENT[kind], alpha: 0.16 });
    this.container.addChild(this.column);

    this.sprite = new PIXI.Sprite(ctx.assets.get(kind === 'pickup' ? 'waypoint-pickup' : 'waypoint-dropoff'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = this.radius * 2;
    this.sprite.height = this.radius * 2;
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({
      text: label || shorten(spec?.label || ''),
      style: { ...LABEL_STYLE, fill: ACCENT[kind] },
    });
    this.label.anchor.set(0.5, 0);
    this.label.y = this.radius + 6;
    this.container.addChild(this.label);

    this._t = Math.random() * Math.PI * 2;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  /** Only active waypoints are drawn and testable — keeps the city readable. */
  setActive(on) {
    this.active = on && !this.consumed;
    this.container.visible = this.active;
  }

  isInside(pos) {
    if (!this.active || this.consumed) return false;
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.radius + 6;
  }

  consume() {
    this.consumed = true;
    this.active = false;
    this.container.visible = false;
  }

  update(dt) {
    if (!this.active) return;
    this._t += dt;
    const pulse = 1 + Math.sin(this._t * 3) * 0.1;
    this.sprite.scale.set((this.radius * 2 / this.sprite.texture.width) * pulse);
    this.sprite.rotation += dt * 0.6;
    this.column.alpha = 0.55 + Math.sin(this._t * 3) * 0.45;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 26) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
