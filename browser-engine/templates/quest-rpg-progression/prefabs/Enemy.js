/**
 * Enemy (quest-rpg-progression) — a hazard from the source content, patrolling
 * the region as something you must actually face.
 *
 * It paces a short patrol loop around its anchor and shows an HP pip track.
 * Touching it (or interacting inside its engage radius) hands control to the
 * EncounterScene, where the "fight" is a recall check: the enemy loses HP on a
 * correct answer and lands a hit on a wrong one. Defeated enemies fade out and
 * stop blocking the region.
 */
const PIXI = window.PIXI;

const NAME_STYLE = {
  fill: 0xfb7185,
  fontSize: 11,
  fontFamily: 'Inter, system-ui, sans-serif',
  fontWeight: '800',
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 120,
};

export class Enemy {
  constructor(ctx, spec, { x = 0, y = 0, hp = 2, patrolRadius = 46 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.maxHp = hp;
    this.hp = hp;
    this.defeated = false;
    this.engageRadius = 52;

    this.anchor = { x, y };
    this.patrolRadius = patrolRadius;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.sprite = new PIXI.Sprite(ctx.assets.get('enemy'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = 42;
    this.sprite.height = 42;
    this.container.addChild(this.sprite);

    this.name = new PIXI.Text({ text: shorten(spec.label), style: NAME_STYLE });
    this.name.anchor.set(0.5, 0);
    this.name.y = 26;
    this.container.addChild(this.name);

    this.pips = new PIXI.Graphics();
    this.pips.y = -30;
    this.container.addChild(this.pips);
    this._drawPips();

    this._t = Math.random() * Math.PI * 2;
    this._flash = 0;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  isNear(pos) {
    if (this.defeated) return false;
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.engageRadius;
  }

  _drawPips() {
    this.pips.clear();
    const w = 12;
    const gap = 4;
    const total = this.maxHp * w + (this.maxHp - 1) * gap;
    for (let i = 0; i < this.maxHp; i++) {
      const x = -total / 2 + i * (w + gap);
      this.pips.roundRect(x, 0, w, 5, 2).fill(i < this.hp ? 0xfb7185 : 0x334155);
    }
  }

  /** Land a hit from a correct answer. Returns true when the enemy is defeated. */
  damage(amount = 1) {
    if (this.defeated) return true;
    this.hp = Math.max(0, this.hp - amount);
    this._flash = 0.3;
    this._drawPips();
    this.ctx.audio?.play('failure');
    if (this.hp === 0) {
      this.defeated = true;
      this.name.style.fill = 0x64748b;
      this.name.text = `defeated: ${shorten(this.spec.label)}`;
      this.pips.visible = false;
      this.ctx.audio?.play('reward');
    }
    return this.defeated;
  }

  update(dt) {
    this._t += dt;

    if (!this.defeated) {
      // Lazy figure-eight patrol so the region feels alive without pursuing.
      this.container.x = this.anchor.x + Math.sin(this._t * 0.8) * this.patrolRadius;
      this.container.y = this.anchor.y + Math.sin(this._t * 1.6) * (this.patrolRadius * 0.4);
      this.sprite.rotation = Math.sin(this._t * 4) * 0.08;
    } else {
      this.sprite.alpha = Math.max(0.18, this.sprite.alpha - dt * 0.9);
    }

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt);
      this.sprite.tint = 0xffffff;
    } else {
      this.sprite.tint = 0xffffff;
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 26) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}