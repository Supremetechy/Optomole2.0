/**
 * Door — the locked gate that gates room progression.
 *
 * Represents lock / exit-gate bindings. While locked it has a static Matter
 * body that physically blocks the player. Once the room's required keys are
 * collected (and objectives cleared), interacting unlocks it: the blocking body
 * is removed, the sprite swaps to "open", and stepping through advances to the
 * next room (or the reward scene if it's the final gate).
 */
const PIXI = window.PIXI;
const Matter = window.Matter;

const LABEL_STYLE = { fill: 0xe5f4ff, fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: '700' };

export class Door {
  constructor(ctx, spec, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.requiredKeys = spec.requiredKeys || [];
    this.isFinal = !!spec.isFinal;
    this.interactionRadius = 66;
    this.locked = true;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.sprite = new PIXI.Sprite(ctx.assets.get('door'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 44;
    this.sprite.height = 62;
    this.container.addChild(this.sprite);

    this.plate = new PIXI.Text({ text: this.isFinal ? 'FINAL GATE' : 'LOCKED', style: LABEL_STYLE });
    this.plate.anchor.set(0.5, 1);
    this.plate.y = -38;
    this.container.addChild(this.plate);

    this.body = Matter.Bodies.rectangle(x, y, 46, 64, { isStatic: true, label: 'door' });
    this.body.plugin = { prefab: this };
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  addTo(container, world) {
    container.addChild(this.container);
    Matter.Composite.add(world, this.body);
  }

  isNear(pos) {
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.interactionRadius;
  }

  /** Are the requirements met? Extra room-clear check comes from the scene. */
  requirementsMet(state) {
    return this.requiredKeys.every((k) => state.hasKey(k));
  }

  missingSummary(state) {
    const missing = this.requiredKeys.filter((k) => !state.hasKey(k));
    return missing.length;
  }

  unlock(world) {
    if (!this.locked) return;
    this.locked = false;
    Matter.Composite.remove(world, this.body);
    this.sprite.texture = this.ctx.assets.get('door-open');
    this.plate.text = this.isFinal ? 'ESCAPE ▸' : 'OPEN ▸';
    this.plate.style.fill = 0x34d399;
    this.ctx.audio?.play('unlock');
  }

  update(dt) {
    if (!this.locked) {
      this._t = (this._t || 0) + dt;
      this.plate.y = -38 + Math.sin(this._t * 4) * 2;
    }
  }

  destroy(world) {
    if (this.locked) Matter.Composite.remove(world, this.body);
    this.container.destroy({ children: true });
  }
}
