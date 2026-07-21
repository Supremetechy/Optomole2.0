/**
 * Token (board-resource-sim) — the player's board piece.
 *
 * A PixiJS sprite that hops from space to space. The BoardScene issues one
 * `hopTo(target)` per step of a dice roll; the token arcs to the target over a
 * short duration and reports arrival via `arrived` so the scene can resolve the
 * space and start the next hop. A gentle idle bob plays while it waits.
 */
const PIXI = window.PIXI;

const HOP_DUR = 0.18; // seconds per single-space hop

export class Token {
  constructor(ctx, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.shadow = new PIXI.Graphics();
    this.shadow.ellipse(0, 16, 13, 5).fill({ color: 0x000000, alpha: 0.35 });
    this.container.addChild(this.shadow);

    this.sprite = new PIXI.Sprite(ctx.assets.get('player'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 34;
    this.sprite.height = 34;
    this.container.addChild(this.sprite);

    this._t = 0;
    this._hop = null; // { fromX, fromY, toX, toY, t }
    this.arrived = false;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  get moving() {
    return !!this._hop;
  }

  setSpace({ x, y }) {
    this.container.x = x;
    this.container.y = y;
  }

  /** Begin a single-space hop toward {x,y}. Arrival is flagged in update(). */
  hopTo({ x, y }) {
    this._hop = { fromX: this.container.x, fromY: this.container.y, toX: x, toY: y, t: 0 };
    this.arrived = false;
    this.ctx.audio?.play('step');
  }

  update(dt) {
    this._t += dt;
    if (this._hop) {
      this._hop.t += dt;
      const k = Math.min(1, this._hop.t / HOP_DUR);
      const ease = k * k * (3 - 2 * k); // smoothstep
      this.container.x = this._hop.fromX + (this._hop.toX - this._hop.fromX) * ease;
      this.container.y = this._hop.fromY + (this._hop.toY - this._hop.fromY) * ease;
      // Vertical arc for the hop.
      this.sprite.y = -Math.sin(k * Math.PI) * 18;
      this.shadow.scale.set(1 - Math.sin(k * Math.PI) * 0.3);
      if (k >= 1) {
        this._hop = null;
        this.arrived = true;
        this.sprite.y = 0;
        this.shadow.scale.set(1);
      }
    } else {
      // Idle bob.
      this.sprite.y = Math.sin(this._t * 3) * 1.5;
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
