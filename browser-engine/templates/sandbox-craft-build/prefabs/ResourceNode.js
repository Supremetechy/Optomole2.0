/**
 * ResourceNode (sandbox-craft-build) — a fact from the source content, standing
 * in the world as a minable block.
 *
 * Mining is deliberately not instant: holding interact inside the node's radius
 * fills a progress ring over ~1.2s per hit, and each hit chips a visible corner
 * off the block. That dwell time is the point — the fact's text is displayed
 * while the player mines, so the content is read rather than skipped.
 *
 * Depleted nodes leave a faded stump so the player can see what they have
 * already worked.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 140,
};

export const MINE_TIME = 1.2; // seconds per hit

export class ResourceNode {
  constructor(ctx, spec, { x = 0, y = 0, material, yield: units = 2, hits = 3 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.material = material;
    this.unitsPerHit = units;
    this.maxHits = hits;
    this.hits = hits;
    this.depleted = false;
    this.radius = 26;
    this.reachRadius = 52;
    this.progress = 0;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.sprite = new PIXI.Sprite(ctx.assets.get(material?.texture || 'node-ore'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = this.radius * 2;
    this.sprite.height = this.radius * 2;
    this.container.addChild(this.sprite);

    this.ring = new PIXI.Graphics();
    this.container.addChild(this.ring);

    this.label = new PIXI.Text({
      text: shorten(spec.label),
      style: { ...LABEL_STYLE, fill: material?.color || 0x94a3b8 },
    });
    this.label.anchor.set(0.5, 0);
    this.label.y = this.radius + 6;
    this.container.addChild(this.label);

    this._t = Math.random() * Math.PI * 2;
    this._particles = [];
  }

  addTo(container) {
    container.addChild(this.container);
  }

  get position() {
    return { x: this.container.x, y: this.container.y };
  }

  inReach(pos) {
    if (this.depleted) return false;
    return Math.hypot(pos.x - this.container.x, pos.y - this.container.y) <= this.reachRadius;
  }

  /**
   * Advance mining while the player holds interact in reach.
   * Returns a yield object on each completed hit, otherwise null.
   */
  mine(dt) {
    if (this.depleted) return null;
    this.progress += dt / MINE_TIME;
    if (this.progress < 1) return null;

    this.progress = 0;
    this.hits--;
    this._chip();
    this.ctx.audio?.play('pickup');

    if (this.hits <= 0) {
      this.depleted = true;
      this.sprite.alpha = 0.22;
      this.ring.clear();
      this.label.style.fill = 0x475569;
      this.label.text = `mined: ${shorten(this.spec.label)}`;
    } else {
      // Each hit shrinks the block — visible feedback that it is being worked.
      const scale = 0.6 + (this.hits / this.maxHits) * 0.4;
      this.sprite.width = this.radius * 2 * scale;
      this.sprite.height = this.radius * 2 * scale;
    }

    return {
      material: this.material.id,
      units: this.unitsPerHit,
      depleted: this.depleted,
      spec: this.spec,
    };
  }

  /** Cancel partial progress when the player walks away or lets go. */
  resetProgress() {
    this.progress = 0;
  }

  _chip() {
    for (let i = 0; i < 8; i++) {
      const p = new PIXI.Sprite(this.ctx.assets.get('particle'));
      p.anchor.set(0.5);
      p.scale.set(0.3 + Math.random() * 0.4);
      p.tint = this.material?.color || 0x94a3b8;
      const ang = Math.random() * Math.PI * 2;
      p._vx = Math.cos(ang) * (50 + Math.random() * 60);
      p._vy = Math.sin(ang) * (50 + Math.random() * 60);
      p._life = 0.5;
      this.container.addChild(p);
      this._particles.push(p);
    }
  }

  update(dt) {
    this._t += dt;

    if (!this.depleted) {
      this.sprite.rotation = Math.sin(this._t * 1.2) * 0.04;

      // Mining progress ring.
      this.ring.clear();
      if (this.progress > 0) {
        this.ring.circle(0, 0, this.radius + 8)
          .stroke({ width: 3, color: 0x1e293b, alpha: 0.8 });
        this.ring.arc(0, 0, this.radius + 8, -Math.PI / 2, -Math.PI / 2 + this.progress * Math.PI * 2)
          .stroke({ width: 3, color: this.material?.color || 0x67e8f9 });
      }
    }

    for (const p of this._particles) {
      p._life -= dt;
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      p.alpha = Math.max(0, p._life / 0.5);
    }
    this._particles = this._particles.filter((p) => {
      if (p._life <= 0) { p.destroy(); return false; }
      return true;
    });
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 28) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
