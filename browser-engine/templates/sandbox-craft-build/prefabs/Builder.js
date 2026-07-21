/**
 * Builder (sandbox-craft-build) — the player avatar.
 *
 * Movement matches the other top-down genres (velocity from the input axis on a
 * Matter body), plus the two things this genre needs: a mining beam drawn to the
 * node currently being worked, and a carry indicator so the player can see their
 * haul without opening the crafting panel.
 */
const PIXI = window.PIXI;
const Matter = window.Matter;

export const BUILDER_RADIUS = 16;
export const BUILDER_SPEED = 4.6;

export class Builder {
  constructor(ctx, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.beam = new PIXI.Graphics();
    this.container.addChild(this.beam);

    this.sprite = new PIXI.Sprite(ctx.assets.get('player'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = BUILDER_RADIUS * 2.3;
    this.sprite.height = BUILDER_RADIUS * 2.3;
    this.container.addChild(this.sprite);

    this.body = Matter.Bodies.circle(x, y, BUILDER_RADIUS, {
      frictionAir: 0.3,
      label: 'builder',
      restitution: 0,
    });
    this.body.plugin = { prefab: this };

    this._t = 0;
    this._moving = false;
    this._flash = 0;
  }

  addTo(container, world) {
    container.addChild(this.container);
    Matter.Composite.add(world, this.body);
  }

  get position() {
    return this.body.position;
  }

  flash() {
    this._flash = 0.3;
  }

  drive(axis) {
    Matter.Body.setVelocity(this.body, { x: axis.x * BUILDER_SPEED, y: axis.y * BUILDER_SPEED });
    this._moving = Math.abs(axis.x) + Math.abs(axis.y) > 0.05;
    if (axis.x > 0.1) this.sprite.scale.x = Math.abs(this.sprite.scale.x);
    if (axis.x < -0.1) this.sprite.scale.x = -Math.abs(this.sprite.scale.x);
  }

  /**
   * Draw the mining beam. `target` is a world position (or null to clear).
   * Coordinates are converted to local space since the beam lives on the
   * builder's own container.
   */
  aimBeam(target, color = 0x67e8f9) {
    this.beam.clear();
    if (!target) return;
    const lx = target.x - this.container.x;
    const ly = target.y - this.container.y;
    const jitter = Math.sin(this._t * 40) * 2;
    this.beam.moveTo(0, 0).lineTo(lx + jitter, ly).stroke({ width: 3, color, alpha: 0.7 });
    this.beam.circle(lx, ly, 5 + Math.sin(this._t * 20) * 2).fill({ color, alpha: 0.5 });
  }

  sync(dt) {
    this.container.x = this.body.position.x;
    this.container.y = this.body.position.y;
    this._t += dt;

    this.sprite.y = this._moving ? Math.sin(this._t * 15) * 1.6 : Math.sin(this._t * 3) * 0.8;

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt);
      this.sprite.tint = 0xfb7185;
    } else {
      this.sprite.tint = 0xffffff;
    }
  }

  halt() {
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    this._moving = false;
  }

  destroy(world) {
    if (world) Matter.Composite.remove(world, this.body);
    this.container.destroy({ children: true });
  }
}
