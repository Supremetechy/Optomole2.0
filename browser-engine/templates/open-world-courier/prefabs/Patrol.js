/**
 * Patrol (open-world-courier) — a blocker from the source content, driving a
 * beat through the city.
 *
 * Each patrol paces its road axis until the player's vehicle enters its
 * detection cone, then gives chase for a few seconds. Contact raises heat and
 * explains the underlying blocker — the content's own warning text is the
 * consequence, which is the point of the mapping.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 10,
  fontWeight: '800',
  fill: 0xfb7185,
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 130,
};

export class Patrol {
  constructor(ctx, spec, { x = 0, y = 0, axis = 'x', range = 280, speed = 80 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.axis = axis;
    this.range = range;
    this.speed = speed;
    this.home = { x, y };
    this.contactRadius = 34;
    this.detectRadius = 190;
    this.chaseFor = 0;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.cone = new PIXI.Graphics();
    this.container.addChild(this.cone);

    this.sprite = new PIXI.Sprite(ctx.assets.get('patrol'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 30;
    this.sprite.height = 42;
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({ text: shorten(spec.label), style: LABEL_STYLE });
    this.label.anchor.set(0.5, 0);
    this.label.y = 26;
    this.container.addChild(this.label);

    this._t = Math.random() * Math.PI * 2;
    this._dir = 1;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  touches(pos) {
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.contactRadius;
  }

  update(dt, playerPos) {
    this._t += dt;

    const dist = playerPos
      ? Math.hypot(playerPos.x - this.container.x, playerPos.y - this.container.y)
      : Infinity;

    if (dist < this.detectRadius) this.chaseFor = 2.5;
    if (this.chaseFor > 0) this.chaseFor = Math.max(0, this.chaseFor - dt);

    if (this.chaseFor > 0 && playerPos) {
      // Chase: drive straight at the courier, a little slower than the car's top
      // speed so evasion is always possible.
      const dx = playerPos.x - this.container.x;
      const dy = playerPos.y - this.container.y;
      const len = Math.hypot(dx, dy) || 1;
      this.container.x += (dx / len) * this.speed * 1.25 * dt;
      this.container.y += (dy / len) * this.speed * 1.25 * dt;
      this.sprite.rotation = Math.atan2(dy, dx) + Math.PI / 2;
    } else {
      // Beat: pace the axis, reversing at the ends of the range.
      const key = this.axis;
      const home = this.home[key];
      this.container[key] += this._dir * this.speed * dt;
      if (Math.abs(this.container[key] - home) > this.range) {
        this._dir *= -1;
        this.container[key] = home + Math.sign(this.container[key] - home) * this.range;
      }
      this.sprite.rotation = this.axis === 'x'
        ? (this._dir > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (this._dir > 0 ? Math.PI : 0);
    }

    // Alert cone brightens when the patrol has the player.
    const alerted = this.chaseFor > 0;
    this.cone.clear();
    this.cone.circle(0, 0, this.detectRadius)
      .fill({ color: 0xfb7185, alpha: alerted ? 0.1 : 0.04 });
    this.sprite.alpha = alerted ? 0.75 + Math.sin(this._t * 18) * 0.25 : 1;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 24) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
