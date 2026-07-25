/**
 * SkillScene — spend a skill point between chapters.
 *
 * Shown whenever the hero banks unspent points (one per level gained). Three
 * branches, each with a mechanical effect the player will feel in the next
 * region: Insight pre-eliminates a wrong answer in encounters, Resolve softens
 * damage and raises max focus, Momentum speeds travel and XP gain.
 *
 * Points are written back to `state.skills`, which RegionScene and
 * EncounterScene read.
 */
import { SKILL_BRANCHES } from '../entity-factory.js';

const PIXI = window.PIXI;

export class SkillScene {
  constructor(ctx, { points = 1, branches, onDone }) {
    this.ctx = ctx;
    this.points = points;
    // Campaign-supplied branches carry the manifest's own skillTree names;
    // the generic SKILL_BRANCHES only back-stop a manifest without one.
    this.branches = Array.isArray(branches) && branches.length ? branches : SKILL_BRANCHES;
    this.onDone = onDone;
    this.container = new PIXI.Container();
    this._t = 0;
    this._spent = 0;
  }

  enter(ctx) {
    this.ctx.audio?.play('reward');
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;

    const dim = new PIXI.Graphics();
    dim.rect(0, 0, width, height).fill({ color: 0x030712, alpha: 0.86 });
    dim.eventMode = 'static';
    this.container.addChild(dim);

    const pw = Math.min(620, width - 40);
    const ph = 340;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x0b1220, alpha: 0.97 })
      .stroke({ width: 2, color: 0xa78bfa, alpha: 0.55 });
    this.container.addChild(panel);

    const kicker = text('LEVEL UP', { fill: 0xa78bfa, fontSize: 12, fontWeight: '900', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 28);
    this.container.addChild(kicker);

    const level = this.ctx.state.get('level');
    const title = text(`Level ${level}`, { fill: 0xffffff, fontSize: 28, fontWeight: '900' });
    title.anchor.set(0.5);
    title.position.set(cx, top + 58);
    this.container.addChild(title);

    this.remaining = text('', { fill: 0x67e8f9, fontSize: 12, fontWeight: '800' });
    this.remaining.anchor.set(0.5);
    this.remaining.position.set(cx, top + 86);
    this.container.addChild(this.remaining);

    const skills = this.ctx.state.get('skills') || {};
    const cardW = (pw - 80) / 3;
    this.branches.forEach((b, i) => {
      const bx = cx - pw / 2 + 40 + i * cardW;
      const by = top + 110;
      const node = new PIXI.Container();
      node.position.set(bx + 5, by);

      const bg = new PIXI.Graphics();
      bg.roundRect(0, 0, cardW - 10, 150, 10)
        .fill({ color: 0x111c30, alpha: 0.95 })
        .stroke({ width: 1, color: 0x334155 });
      node.addChild(bg);

      const icon = text(b.icon, { fill: 0xa78bfa, fontSize: 22, fontWeight: '900' });
      icon.anchor.set(0.5);
      icon.position.set((cardW - 10) / 2, 28);
      node.addChild(icon);

      const label = text(b.label, { fill: 0xe5f4ff, fontSize: 15, fontWeight: '900' });
      label.anchor.set(0.5);
      label.position.set((cardW - 10) / 2, 56);
      node.addChild(label);

      const blurb = text(b.blurb, {
        fill: 0x94a3b8, fontSize: 11, align: 'center', wordWrap: true, wordWrapWidth: cardW - 34, lineHeight: 15,
      });
      blurb.anchor.set(0.5, 0);
      blurb.position.set((cardW - 10) / 2, 74);
      node.addChild(blurb);

      const rank = text(`Rank ${skills[b.id] || 0}`, { fill: 0x64748b, fontSize: 11, fontWeight: '800' });
      rank.anchor.set(0.5);
      rank.position.set((cardW - 10) / 2, 124);
      node.addChild(rank);

      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.on('pointertap', () => this._spend(b, rank, bg, cardW));

      this.container.addChild(node);
    });

    const hint = text('Tap a branch (or press 1 / 2 / 3) to spend a point', { fill: 0x475569, fontSize: 11, fontWeight: '700' });
    hint.anchor.set(0.5);
    hint.position.set(cx, top + ph - 34);
    this.container.addChild(hint);

    this.cta = text('PRESS E TO CONTINUE', { fill: 0x67e8f9, fontSize: 12, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 14);
    this.container.addChild(this.cta);

    this._updateRemaining();
  }

  _updateRemaining() {
    const left = this.points - this._spent;
    if (this.remaining) {
      this.remaining.text = left > 0
        ? `${left} skill point${left === 1 ? '' : 's'} to spend`
        : 'All points spent — press E to continue';
    }
  }

  _spend(branch, rankText, bg, cardW) {
    if (this._spent >= this.points) return;
    this._spent++;
    const skills = { ...(this.ctx.state.get('skills') || {}) };
    skills[branch.id] = (skills[branch.id] || 0) + 1;
    this.ctx.state.set({ skills });

    // Resolve also raises the focus ceiling, so refill some focus on rank-up.
    if (branch.id === 'resolve') {
      this.ctx.state.set({ focus: Math.min(100, this.ctx.state.get('focus') + 15) });
    }

    rankText.text = `Rank ${skills[branch.id]}`;
    bg.clear();
    bg.roundRect(0, 0, cardW - 10, 150, 10)
      .fill({ color: 0x1a2542, alpha: 0.95 })
      .stroke({ width: 2, color: 0xa78bfa });
    this.ctx.audio?.play('unlock');
    this.ctx.state.logEvent(`★ ${branch.label} rank ${skills[branch.id]}`);
    this._updateRemaining();
  }

  update(dt) {
    this._t += dt;
    if (this.cta) this.cta.alpha = 0.5 + Math.sin(this._t * 4) * 0.5;

    const keys = this.ctx.input.keys;
    for (let i = 0; i < this.branches.length; i++) {
      if (keys.has(String(i + 1))) {
        keys.delete(String(i + 1));
        // Re-layout is the simplest way to reflect a keyboard spend.
        const branch = this.branches[i];
        if (this._spent < this.points) {
          const skills = { ...(this.ctx.state.get('skills') || {}) };
          skills[branch.id] = (skills[branch.id] || 0) + 1;
          this._spent++;
          this.ctx.state.set({ skills });
          this.ctx.audio?.play('unlock');
          this.ctx.state.logEvent(`★ ${branch.label} rank ${skills[branch.id]}`);
          this._layout(this.ctx.runtime.size());
        }
        break;
      }
    }

    if (this.ctx.input.consumeInteract()) this.onDone?.();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}