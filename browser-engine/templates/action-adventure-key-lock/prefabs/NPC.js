/**
 * NPC — a non-player character the guide/quest-giver.
 *
 * Static sprite with a name plate, an idle bob, and a "!" bubble that appears
 * when the player is inside the interaction radius. Talking opens the
 * DialogueScene. This turns the JSON character definitions into an actual
 * on-screen, interactable presence.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = { fill: 0xe5f4ff, fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: '700' };

export class NPC {
  constructor(ctx, spec, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.interactionRadius = 74;
    this.talkedTo = false;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.sprite = new PIXI.Sprite(ctx.assets.get('npc'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 40;
    this.sprite.height = 44;
    this.container.addChild(this.sprite);

    this.plate = new PIXI.Text({ text: spec.label || 'Guide', style: LABEL_STYLE });
    this.plate.anchor.set(0.5, 1);
    this.plate.y = -30;
    this.container.addChild(this.plate);

    this.bubble = new PIXI.Text({ text: '!', style: { fill: 0xfbbf24, fontSize: 26, fontWeight: '900', fontFamily: 'system-ui' } });
    this.bubble.anchor.set(0.5, 1);
    this.bubble.y = -46;
    this.bubble.visible = false;
    this.container.addChild(this.bubble);

    this._t = 0;
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  addTo(container) {
    container.addChild(this.container);
  }

  isNear(pos) {
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.interactionRadius;
  }

  update(dt, playerPos) {
    this._t += dt;
    this.sprite.y = Math.sin(this._t * 2.4) * 2;
    const near = playerPos ? this.isNear(playerPos) : false;
    this.bubble.visible = near && !this.talkedTo;
    if (near) {
      this.bubble.y = -46 + Math.sin(this._t * 6) * 3;
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
