/**
 * ResultScene (fps-target-gallery) — the qualification card.
 *
 * Reports the range the way a real qualification does: accuracy, rounds fired,
 * threats confirmed, and — the one that matters for this drill — whether the
 * player held fire on routine activity. A marksmanship badge is awarded from
 * combined accuracy and discipline.
 */
const PIXI = window.PIXI;

const BADGES = [
  { min: 0.95, label: 'EXPERT', color: 0xa78bfa },
  { min: 0.85, label: 'SHARPSHOOTER', color: 0x34d399 },
  { min: 0.7, label: 'MARKSMAN', color: 0x67e8f9 },
  { min: 0, label: 'UNQUALIFIED', color: 0xfb7185 },
];

export class ResultScene {
  constructor(ctx, { win, roundCount, stats = {}, onReplay }) {
    this.ctx = ctx;
    this.win = win;
    this.roundCount = roundCount;
    this.stats = stats;
    this.onReplay = onReplay;
    this.container = new PIXI.Container();
    this._t = 0;
  }

  enter(ctx) {
    this.ctx.audio?.play(this.win ? 'reward' : 'failure');
    this._layout(ctx.runtime.size());
  }

  _badge() {
    const acc = this.stats.accuracy ?? 0;
    const disciplineOk = (this.stats.wrongful || 0) === 0;
    // Wrongful engagement caps you out no matter how good the accuracy was.
    const score = disciplineOk ? acc : Math.min(acc, 0.6);
    return BADGES.find((b) => score >= b.min) || BADGES[BADGES.length - 1];
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const badge = this.win ? this._badge() : BADGES[BADGES.length - 1];
    const accent = this.win ? badge.color : 0xfb7185;

    const pw = Math.min(560, width - 48);
    const ph = 384;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.95 })
      .stroke({ width: 2, color: accent, alpha: 0.55 });
    this.container.addChild(panel);

    const kicker = text(this.win ? 'RANGE COMPLETE' : 'RANGE FAILED', {
      fill: accent, fontSize: 12, fontWeight: '900', letterSpacing: 2,
    });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 30);
    this.container.addChild(kicker);

    if (this.win) {
      const badgeText = text(badge.label, { fill: badge.color, fontSize: 32, fontWeight: '900', letterSpacing: 3 });
      badgeText.anchor.set(0.5);
      badgeText.position.set(cx, top + 70);
      this.container.addChild(badgeText);
    } else {
      const headline = text('Integrity or time ran out downrange.', {
        fill: 0xffffff, fontSize: 19, fontWeight: '800', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
      });
      headline.anchor.set(0.5);
      headline.position.set(cx, top + 70);
      this.container.addChild(headline);
    }

    const state = this.ctx.state.get();
    const accPct = Math.round((this.stats.accuracy ?? 0) * 100);
    const rows = [
      ['Accuracy', `${accPct}%`],
      ['Rounds fired', `${this.stats.shotsFired ?? 0}`],
      ['Threats confirmed', `${state.keys.length}`],
      ['Held correctly', `${this.stats.held ?? 0}`],
      ['Wrongful engagements', `${this.stats.wrongful ?? 0}`],
      ['Rounds cleared', `${state.clearedRooms.length} / ${this.roundCount}`],
      ['Score', `${state.xp}`],
    ];
    rows.forEach((r, i) => {
      const ry = top + 118 + i * 28;
      const k = text(r[0], { fill: 0x94a3b8, fontSize: 13 });
      k.position.set(cx - pw / 2 + 40, ry);
      this.container.addChild(k);
      const highlight = r[0] === 'Wrongful engagements' && (this.stats.wrongful ?? 0) > 0;
      const v = text(r[1], { fill: highlight ? 0xfb7185 : 0xe5f4ff, fontSize: 14, fontWeight: '900' });
      v.anchor.set(1, 0);
      v.position.set(cx + pw / 2 - 40, ry);
      this.container.addChild(v);
    });

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, top + ph - 54, 300, 42, 21).fill(accent);
    this.container.addChild(ctaBg);
    this.cta = text(this.win ? '▶  RUN IT AGAIN' : '▶  RETRY RANGE', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 33);
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
