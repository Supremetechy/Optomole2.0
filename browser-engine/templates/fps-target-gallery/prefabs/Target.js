/**
 * Target (fps-target-gallery) — a content item standing downrange as a
 * depth-projected billboard.
 *
 * Three kinds, all sharing one prefab:
 *   - 'hostile'   a real threat/term → shoot it for score and streak
 *   - 'bystander' a decoy → shooting it costs accuracy; leaving it standing pays
 *   - 'bonus'     supporting evidence → shoot it for a score multiplier
 *
 * The prefab owns its world position (x, z on the ground plane) and its label;
 * the scene owns the camera and calls `place()` each frame with the projected
 * screen position. Hit testing is a screen-space radius check against the
 * crosshair, so aiming feels the same at every distance while distant targets
 * are genuinely smaller and harder.
 */
import { TARGET_WORLD_HEIGHT } from '../entity-factory.js';

const PIXI = window.PIXI;

const TEX = { hostile: 'target-good', bystander: 'target-bad', bonus: 'target-good' };
const ACCENT = { hostile: 0x34d399, bystander: 0xfbbf24, bonus: 0xa78bfa };

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 13,
  fontWeight: '700',
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 210,
};

export class Target {
  constructor(ctx, spec, { x = 0, z = 12, kind = 'hostile', strafeSpeed = 0 } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.kind = kind;
    this.world = { x, z, homeX: x };
    this.strafeSpeed = strafeSpeed;
    this.resolved = false; // shot, or the round ended with it correctly left alone
    this.hit = false;
    this.baseSize = kind === 'bonus' ? 1.15 : 1;

    this.container = new PIXI.Container();

    this.sprite = new PIXI.Sprite(ctx.assets.get(TEX[kind] || 'target-good'));
    this.sprite.anchor.set(0.5, 1); // stand on the ground line
    this.container.addChild(this.sprite);

    this.label = new PIXI.Text({
      text: shorten(spec.label),
      style: { ...LABEL_STYLE, fill: ACCENT[kind] || 0xe5f4ff },
    });
    this.label.anchor.set(0.5, 1);
    this.container.addChild(this.label);

    // Bonus targets get a small tag so their ×2 payoff is legible at range.
    if (kind === 'bonus') {
      this.tag = new PIXI.Text({
        text: '×2 EVIDENCE',
        style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 10, fontWeight: '900', fill: 0xa78bfa },
      });
      this.tag.anchor.set(0.5, 0);
      this.container.addChild(this.tag);
    }

    this._t = Math.random() * Math.PI * 2;
    this._flash = 0;
    this.screen = null; // last projection, set by place()
  }

  addTo(container) {
    container.addChild(this.container);
  }

  /** Strafe across the lane; called before projection each frame. */
  advance(dt) {
    this._t += dt;
    if (this.strafeSpeed && !this.hit) {
      this.world.x = this.world.homeX + Math.sin(this._t * this.strafeSpeed * 0.6) * 2.6;
    }
    if (this._flash > 0) this._flash = Math.max(0, this._flash - dt);
  }

  /**
   * Apply a projection result from the scene's camera.
   * `proj` is null when the target is behind the camera — we simply hide it.
   */
  place(proj) {
    this.screen = proj;
    if (!proj) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    // `proj.scale` is screen pixels per world unit at this depth, so a target's
    // on-screen size is simply its world height times that. Clamped at the low
    // end so a far target stays visible rather than collapsing to a dot.
    const px = Math.max(18, proj.scale * TARGET_WORLD_HEIGHT * this.baseSize);
    this._px = px;
    this.sprite.width = px;
    this.sprite.height = px;
    this.container.x = proj.screenX;
    this.container.y = proj.screenY;

    // Bob slightly so a lineup of targets doesn't read as a static image.
    this.sprite.y = Math.sin(this._t * 1.8) * (px * 0.02);

    this.label.style.fontSize = Math.max(9, Math.min(15, px * 0.13));
    this.label.style.wordWrapWidth = Math.max(90, px * 2.4);
    this.label.y = -px - 8;

    if (this.tag) {
      this.tag.style.fontSize = Math.max(8, Math.min(11, px * 0.1));
      this.tag.y = 6;
    }

    // Depth cues: further targets are dimmer and cooler.
    const fog = Math.max(0.35, Math.min(1, 1.35 - proj.depth / 26));
    this.container.alpha = this.hit ? this.container.alpha : fog;

    this.sprite.tint = this._flash > 0 ? 0xffffff : 0xffffff;
    this.container.zIndex = -proj.depth; // nearer targets draw on top
  }

  /**
   * Screen-space hit test against the crosshair (always at screen center on the
   * horizon line). The sprite is anchored at its feet, so its body spans from
   * `container.y - px` up to `container.y`.
   */
  isUnderCrosshair(view) {
    if (!this.screen || this.hit) return false;
    const px = this._px || Math.max(18, this.screen.scale * 1.8 * this.baseSize);
    const centreY = this.container.y - px / 2;
    const dx = this.container.x - view.cx;
    const dy = centreY - view.horizon;
    return Math.abs(dx) <= px * 0.45 && Math.abs(dy) <= px * 0.55;
  }

  /** Register a shot. Returns the outcome for the scene to score. */
  shoot() {
    if (this.hit) return { already: true };
    this.hit = true;
    this.resolved = true;
    this._flash = 0.25;
    this._burst();

    if (this.kind === 'bystander') {
      this.label.style.fill = 0xfb7185;
      this.label.text = `✗ ${shorten(this.spec.label)}`;
      this.sprite.tint = 0xfb7185;
      this.ctx.audio?.play('failure');
      return { correct: false, kind: this.kind };
    }

    this.label.style.fill = 0x34d399;
    this.label.text = `✓ ${shorten(this.spec.label)}`;
    this.sprite.alpha = 0.35;
    this.ctx.audio?.play('success');
    return { correct: true, kind: this.kind, reward: this.spec.reward || {} };
  }

  /** Called at round end for bystanders the player correctly never fired on. */
  markHeld() {
    if (this.hit) return false;
    this.resolved = true;
    this.label.style.fill = 0x34d399;
    this.label.text = `✓ held: ${shorten(this.spec.label)}`;
    return true;
  }

  _burst() {
    const tint = this.kind === 'bystander' ? 0xfb7185 : 0x34d399;
    this._particles = this._particles || [];
    for (let i = 0; i < 10; i++) {
      const p = new PIXI.Sprite(this.ctx.assets.get('particle'));
      p.anchor.set(0.5);
      p.scale.set(0.3 + Math.random() * 0.5);
      p.tint = tint;
      const ang = (i / 10) * Math.PI * 2;
      p._vx = Math.cos(ang) * (40 + Math.random() * 50);
      p._vy = Math.sin(ang) * (40 + Math.random() * 50) - 20;
      p._life = 0.5;
      p.y = -20;
      this.container.addChild(p);
      this._particles.push(p);
    }
  }

  updateParticles(dt) {
    if (!this._particles?.length) return;
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

function shorten(text, max = 34) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
