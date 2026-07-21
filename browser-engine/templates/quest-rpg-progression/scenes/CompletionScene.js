/**
 * CompletionScene (quest-rpg-progression) — the campaign epilogue, or the
 * defeat screen.
 *
 * On a win it reports the run as a character sheet: level reached, facts logged,
 * threats defeated, skill ranks. On a loss it names what ran the player out of
 * focus and offers a retry. Either way the source content is the scoreboard.
 */
const PIXI = window.PIXI;

export class CompletionScene {
  constructor(ctx, { win, chapterCount, factCount, enemyCount, onReplay }) {
    this.ctx = ctx;
    this.win = win;
    this.chapterCount = chapterCount;
    this.factCount = factCount;
    this.enemyCount = enemyCount;
    this.onReplay = onReplay;
    this.container = new PIXI.Container();
    this._t = 0;
  }

  enter(ctx) {
    this.ctx.audio?.play(this.win ? 'reward' : 'failure');
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const accent = this.win ? 0x34d399 : 0xfb7185;

    const pw = Math.min(560, width - 48);
    const ph = 400;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.95 })
      .stroke({ width: 2, color: accent, alpha: 0.55 });
    this.container.addChild(panel);

    const kicker = text(this.win ? 'CAMPAIGN COMPLETE' : 'RUN ENDED', {
      fill: accent, fontSize: 12, fontWeight: '900', letterSpacing: 2,
    });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 32);
    this.container.addChild(kicker);

    const state = this.ctx.state.get();
    const headline = this.win
      ? `You finished all ${this.chapterCount} chapter${this.chapterCount === 1 ? '' : 's'}.`
      : 'Focus ran out before the campaign closed.';
    const title = text(headline, {
      fill: 0xffffff, fontSize: 22, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60, lineHeight: 28,
    });
    title.anchor.set(0.5, 0);
    title.position.set(cx, top + 54);
    this.container.addChild(title);

    // Character sheet.
    const rows = [
      ['Level reached', `${state.level}`],
      ['Total XP', `${state.xp}`],
      ['Facts logged', `${state.keys.length} / ${this.factCount}`],
      ['Threats defeated', `${(state.objectives || []).filter((o) => o.kind === 'battle' && o.done).length} / ${this.enemyCount}`],
      ['Chapters cleared', `${state.clearedRooms.length} / ${this.chapterCount}`],
    ];
    rows.forEach((r, i) => {
      const ry = top + 130 + i * 30;
      const k = text(r[0], { fill: 0x94a3b8, fontSize: 13 });
      k.position.set(cx - pw / 2 + 40, ry);
      this.container.addChild(k);
      const v = text(r[1], { fill: 0xe5f4ff, fontSize: 14, fontWeight: '900' });
      v.anchor.set(1, 0);
      v.position.set(cx + pw / 2 - 40, ry);
      this.container.addChild(v);
    });

    // Skill ranks earned.
    const skills = state.skills || {};
    const ranks = Object.entries(skills).filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${v}`).join('  ·  ');
    const skillLine = text(ranks ? `Skills: ${ranks}` : 'No skill points spent', {
      fill: 0xa78bfa, fontSize: 12, fontWeight: '700', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    skillLine.anchor.set(0.5, 0);
    skillLine.position.set(cx, top + 130 + rows.length * 30 + 10);
    this.container.addChild(skillLine);

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, top + ph - 56, 300, 44, 22).fill(accent);
    this.container.addChild(ctaBg);
    this.cta = text(this.win ? '▶  PLAY AGAIN' : '▶  RETRY CAMPAIGN', {
      fill: 0x03131d, fontSize: 15, fontWeight: '900',
    });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 34);
    this.container.addChild(this.cta);

    this.container.eventMode = 'static';
    this.container.hitArea = new PIXI.Rectangle(0, 0, width, height);
    this.container.on('pointertap', () => this._replay());
  }

  _replay() {
    if (this._replayed) return;
    this._replayed = true;
    this.onReplay?.();
  }

  update(dt) {
    this._t += dt;
    if (this.cta) this.cta.alpha = 0.65 + Math.sin(this._t * 4) * 0.35;
    if (this.ctx.input.consumeInteract()) this._replay();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}