/**
 * BootScene (quest-rpg-progression) — the campaign title card.
 *
 * Frames the source content as a campaign: title, the author/mentor's line
 * (folded in from an npc-dialogue binding), chapter count, and the three skill
 * branches the player will grow. Waits for the first gesture, which also unlocks
 * audio.
 */
const PIXI = window.PIXI;

export class BootScene {
  constructor(ctx, { title, subtitle, briefing, chapterCount, skillBranches, onStart }) {
    this.ctx = ctx;
    this.onStart = onStart;
    this.container = new PIXI.Container();
    this._title = title || 'Optomole Campaign';
    this._subtitle = subtitle || 'Quest RPG · Progression';
    this._briefing = briefing || 'Take the questline, log every fact in the region, and face what stands in the way.';
    this._chapterCount = chapterCount || 1;
    this._branches = skillBranches || [];
    this._t = 0;
  }

  enter(ctx) {
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const pw = Math.min(600, width - 48);
    const ph = 380;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.94 })
      .stroke({ width: 1, color: 0xa78bfa, alpha: 0.4 });
    this.container.addChild(panel);

    const kicker = text(this._subtitle.toUpperCase(), { fill: 0xa78bfa, fontSize: 12, fontWeight: '800', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 34);
    this.container.addChild(kicker);

    const title = text(this._title, {
      fill: 0xffffff, fontSize: 30, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    title.anchor.set(0.5);
    title.position.set(cx, top + 76);
    this.container.addChild(title);

    const chapters = text(`${this._chapterCount} chapter${this._chapterCount === 1 ? '' : 's'} · level up as you go`, {
      fill: 0x67e8f9, fontSize: 12, fontWeight: '700',
    });
    chapters.anchor.set(0.5);
    chapters.position.set(cx, top + 108);
    this.container.addChild(chapters);

    const brief = text(this._briefing, {
      fill: 0x94a3b8, fontSize: 14, align: 'center', wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 20,
    });
    brief.anchor.set(0.5, 0);
    brief.position.set(cx, top + 132);
    this.container.addChild(brief);

    // Skill branch preview — sets the expectation that XP buys something.
    this._branches.slice(0, 3).forEach((b, i) => {
      const bw = (pw - 80) / 3;
      const bx = cx - pw / 2 + 40 + i * bw;
      const by = top + 232;
      const card = new PIXI.Graphics();
      card.roundRect(bx + 4, by, bw - 8, 68, 8)
        .fill({ color: 0x0b1220, alpha: 0.9 })
        .stroke({ width: 1, color: 0x334155 });
      this.container.addChild(card);

      const icon = text(b.icon || '◆', { fill: 0xa78bfa, fontSize: 16, fontWeight: '900' });
      icon.anchor.set(0.5);
      icon.position.set(bx + bw / 2, by + 16);
      this.container.addChild(icon);

      const label = text(b.label, { fill: 0xe5f4ff, fontSize: 13, fontWeight: '800' });
      label.anchor.set(0.5);
      label.position.set(bx + bw / 2, by + 36);
      this.container.addChild(label);

      const blurb = text(b.blurb, {
        fill: 0x64748b, fontSize: 10, align: 'center', wordWrap: true, wordWrapWidth: bw - 24, lineHeight: 13,
      });
      blurb.anchor.set(0.5, 0);
      blurb.position.set(bx + bw / 2, by + 48);
      this.container.addChild(blurb);
    });

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, top + ph - 54, 300, 44, 22).fill(0xa78bfa);
    this.container.addChild(ctaBg);
    this.cta = text('▶  PRESS E / TAP TO BEGIN', { fill: 0x1e1035, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 32);
    this.container.addChild(this.cta);

    this.container.eventMode = 'static';
    this.container.hitArea = new PIXI.Rectangle(0, 0, width, height);
    this.container.on('pointertap', () => this._start());
  }

  _start() {
    if (this._started) return;
    this._started = true;
    this.ctx.audio?.unlock();
    this.onStart?.();
  }

  update(dt) {
    this._t += dt;
    if (this.cta) this.cta.alpha = 0.6 + Math.sin(this._t * 4) * 0.4;
    if (this.ctx.input.consumeInteract()) this._start();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}