/**
 * Hero (quest-rpg-progression) — the player character on the overworld.
 *
 * A PixiJS sprite backed by a dynamic Matter body (so region walls and gates are
 * solid), driven by the shared InputController axis. Carries the RPG-flavoured
 * extras the arcade Player has no use for: a level pip above the head and a
 * travel-speed bonus fed by the Momentum skill branch.
 */
const PIXI = window.PIXI;
const Matter = window.Matter;

export const HERO_RADIUS = 17;
export const HERO_BASE_SPEED = 4.4;

export class Hero {
  constructor(ctx, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.speedBonus = 0; // raised by the Momentum skill

    this.sprite = new PIXI.Sprite(ctx.assets.get('hero'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = HERO_RADIUS * 2.4;
    this.sprite.height = HERO_RADIUS * 2.4;
    this.container.addChild(this.sprite);

    this.levelPip = new PIXI.Text({
      text: 'Lv 1',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0x67e8f9, fontSize: 11, fontWeight: '900' },
    });
    this.levelPip.anchor.set(0.5, 1);
    this.levelPip.y = -HERO_RADIUS - 6;
    this.container.addChild(this.levelPip);

    this.body = Matter.Bodies.circle(x, y, HERO_RADIUS, {
      frictionAir: 0.3,
      label: 'hero',
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

  setLevel(level) {
    this.levelPip.text = `Lv ${level}`;
  }

  flash() {
    this._flash = 0.3;
  }

  drive(axis) {
    const speed = HERO_BASE_SPEED + this.speedBonus;
    Matter.Body.setVelocity(this.body, { x: axis.x * speed, y: axis.y * speed });
    this._moving = Math.abs(axis.x) + Math.abs(axis.y) > 0.05;
    if (axis.x > 0.1) this.sprite.scale.x = Math.abs(this.sprite.scale.x);
    if (axis.x < -0.1) this.sprite.scale.x = -Math.abs(this.sprite.scale.x);
  }

  sync(dt) {
    this.container.x = this.body.position.x;
    this.container.y = this.body.position.y;
    this._t += dt;

    // Walk bob; a slower idle breath when standing still.
    this.sprite.y = this._moving ? Math.sin(this._t * 14) * 1.8 : Math.sin(this._t * 3) * 0.9;
    this.sprite.rotation = this._moving ? Math.sin(this._t * 14) * 0.05 : 0;

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt);
      this.sprite.tint = 0xfb7185;
    } else {
      this.sprite.tint = 0xffffff;
    }
  }

  /** Freeze the hero while an encounter/dialogue overlay is open. */
  halt() {
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    this._moving = false;
  }

  destroy(world) {
    if (world) Matter.Composite.remove(world, this.body);
    this.container.destroy({ children: true });
  }
}