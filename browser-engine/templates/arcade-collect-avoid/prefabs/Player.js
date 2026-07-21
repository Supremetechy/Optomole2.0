/**
 * Player (arcade-collect-avoid) — the avatar the user drives around the arena.
 *
 * A PixiJS sprite backed by a dynamic Matter body so it collides with the arena
 * walls. Movement is velocity-based, set each physics step from the input axis.
 * A shield ring renders when a power-up grants temporary invulnerability, and a
 * short hit-flash plays when a decoy is touched. Kept intentionally close to the
 * key-lock Player so the two genres share a movement feel.
 */
const PIXI = window.PIXI;
const Matter = window.Matter;

export const PLAYER_RADIUS = 16;
export const PLAYER_SPEED = 5.2; // pixels per fixed physics step (a touch snappier than key-lock)

export class Player {
  constructor(ctx, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.shield = new PIXI.Graphics();
    this.shield.circle(0, 0, PLAYER_RADIUS + 8).stroke({ width: 3, color: 0xa78bfa, alpha: 0.9 });
    this.shield.visible = false;
    this.container.addChild(this.shield);

    this.sprite = new PIXI.Sprite(ctx.assets.get('player'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = PLAYER_RADIUS * 2.4;
    this.sprite.height = PLAYER_RADIUS * 2.4;
    this.container.addChild(this.sprite);

    this.body = Matter.Bodies.circle(x, y, PLAYER_RADIUS, {
      frictionAir: 0.32,
      label: 'player',
      restitution: 0,
    });
    this.body.plugin = { prefab: this };

    this._t = 0;
    this._moving = false;
    this._flash = 0;
    this._shieldT = 0;
  }

  addTo(container, world) {
    container.addChild(this.container);
    Matter.Composite.add(world, this.body);
  }

  get position() {
    return this.body.position;
  }

  get shielded() {
    return this._shieldT > 0;
  }

  grantShield(seconds = 5) {
    this._shieldT = Math.max(this._shieldT, seconds);
    this.shield.visible = true;
  }

  flash() {
    this._flash = 0.25;
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
    this.container.x = this.body.position.x;
    this.container.y = this.body.position.y;
    this._t += dt;

    const bob = this._moving ? Math.sin(this._t * 15) * 1.5 : Math.sin(this._t * 3) * 0.8;
    this.sprite.y = bob;
    this.sprite.rotation = this._moving ? Math.sin(this._t * 15) * 0.06 : 0;

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt);
      this.sprite.tint = 0xfb7185;
    } else {
      this.sprite.tint = 0xffffff;
    }

    if (this._shieldT > 0) {
      this._shieldT = Math.max(0, this._shieldT - dt);
      this.shield.visible = this._shieldT > 0;
      // Pulse the ring, and blink it out in its final second as a warning.
      const blink = this._shieldT < 1 ? (Math.sin(this._t * 30) > 0 ? 1 : 0.25) : 1;
      this.shield.alpha = (0.55 + Math.sin(this._t * 8) * 0.35) * blink;
      this.shield.scale.set(1 + Math.sin(this._t * 8) * 0.05);
    }
  }

  destroy(world) {
    if (world) Matter.Composite.remove(world, this.body);
    this.container.destroy({ children: true });
  }
}
