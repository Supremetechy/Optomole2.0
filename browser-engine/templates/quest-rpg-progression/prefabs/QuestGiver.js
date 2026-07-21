/**
 * QuestGiver (quest-rpg-progression) — the NPC who frames a chapter.
 *
 * Stands at the region entrance with a floating "!" marker while it still has a
 * briefing to give, then switches to a quiet idle. Walk into its talk radius and
 * press interact to open the briefing overlay. The marker is what makes the
 * overworld legible: it tells the player where the chapter starts.
 */
const PIXI = window.PIXI;

const NAME_STYLE = {
  fill: 0xfbbf24,
  fontSize: 12,
  fontFamily: 'Inter, system-ui, sans-serif',
  fontWeight: '800',
};

export class QuestGiver {
  constructor(ctx, spec, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.talked = false;
    this.talkRadius = 62;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.sprite = new PIXI.Sprite(ctx.assets.get('npc'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 40;
    this.sprite.height = 44;
    this.container.addChild(this.sprite);

    this.marker = new PIXI.Sprite(ctx.assets.get('quest-marker'));
    this.marker.anchor.set(0.5, 1);
    this.marker.width = 20;
    this.marker.height = 26;
    this.marker.y = -30;
    this.container.addChild(this.marker);

    this.name = new PIXI.Text({ text: shorten(spec?.label || 'Guide'), style: NAME_STYLE });
    this.name.anchor.set(0.5, 0);
    this.name.y = 26;
    this.container.addChild(this.name);

    this._t = Math.random() * Math.PI * 2;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  isNear(pos) {
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.talkRadius;
  }

  markTalked() {
    this.talked = true;
    this.marker.visible = false;
  }

  update(dt) {
    this._t += dt;
    this.sprite.y = Math.sin(this._t * 2) * 1.6;
    if (this.marker.visible) {
      this.marker.y = -30 + Math.sin(this._t * 4) * 5;
      this.marker.alpha = 0.75 + Math.sin(this._t * 6) * 0.25;
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 22) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}