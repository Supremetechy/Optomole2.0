/**
 * Player — the avatar the user drives.
 *
 * A PixiJS sprite backed by a dynamic Matter body so it collides with walls and
 * locked doors. Movement is velocity-based, set each physics step from the input
 * axis. A subtle idle bob + facing flip stands in for a full animation state
 * machine (idle/walk), which richer sprite sheets can replace later.
 */
const PIXI = window.PIXI;
const Matter = window.Matter;

export const PLAYER_RADIUS = 15;
export const PLAYER_SPEED = 4.6; // pixels per fixed physics step

export class Player {
  constructor(ctx, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.sprite = new PIXI.Sprite(ctx.assets.get('player'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = PLAYER_RADIUS * 2.4;
    this.sprite.height = PLAYER_RADIUS * 2.4;

    this.body = Matter.Bodies.circle(x, y, PLAYER_RADIUS, {
      frictionAir: 0.4,
      label: 'player',
      restitution: 0,
    });
    this.body.plugin = { prefab: this };
    this._t = 0;
    this._moving = false;
  }

  addTo(container, world) {
    container.addChild(this.sprite);
    Matter.Composite.add(world, this.body);
  }

  get position() {
    return this.body.position;
  }

  /** Called inside the fixed physics step with the current input axis. */
  drive(axis) {
    Matter.Body.setVelocity(this.body, { x: axis.x * PLAYER_SPEED, y: axis.y * PLAYER_SPEED });
    this._moving = Math.abs(axis.x) + Math.abs(axis.y) > 0.05;
    if (axis.x > 0.1) this.sprite.scale.x = Math.abs(this.sprite.scale.x);
    if (axis.x < -0.1) this.sprite.scale.x = -Math.abs(this.sprite.scale.x);
  }

  /** Per-frame visual sync (dt seconds). */
  sync(dt) {
    this.sprite.x = this.body.position.x;
    this.sprite.y = this.body.position.y;
    this._t += dt;
    const bob = this._moving ? Math.sin(this._t * 14) * 1.5 : Math.sin(this._t * 3) * 0.8;
    this.sprite.y += bob;
    this.sprite.rotation = this._moving ? Math.sin(this._t * 14) * 0.06 : 0;
  }

  destroy(world) {
    Matter.Composite.remove(world, this.body);
    this.sprite.destroy();
  }
}