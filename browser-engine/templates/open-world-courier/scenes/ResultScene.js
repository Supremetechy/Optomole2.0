/**
 * ResultScene (open-world-courier) — the shift summary.
 *
 * Reports the run as a payslip: contracts delivered, fares earned, shift time,
 * and final heat. On a bust it names how far the player got before the heat
 * caught up, so the retry has a target to beat.
 */
const PIXI = window.PIXI;

export class ResultScene {
  constructor(ctx, { win, contractCount, stats = {}, onReplay }) {
    this.ctx = ctx;
    this.win = win;
    this.contractCount = contractCount;
    this.stats = stats;
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

    const pw = Math.min(540, width - 48);
    const ph = 348;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.95 })
      .stroke({ width: 2, color: accent, alpha: 0.55 });
    this.container.addChild(panel);

    const kicker = text(this.win ? 'SHIFT COMPLETE' : 'BUSTED', {
      fill: accent, fontSize: 12, fontWeight: '900', letterSpacing: 2,
    });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 30);
    this.container.addChild(kicker);

    const headline = this.win
      ? 'Every contract delivered.'
      : `Heat maxed out after ${this.stats.delivered || 0} delivery${(this.stats.delivered || 0) === 1 ? '' : 's'}.`;
    const title = text(headline, {
      fill: 0xffffff, fontSize: 21, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60, lineHeight: 26,
    });
    title.anchor.set(0.5, 0);
    title.position.set(cx, top + 52);
    this.container.addChild(title);

    const state = this.ctx.state.get();
    const mins = Math.floor((this.stats.elapsed || 0) / 60);
    const secs = Math.round((this.stats.elapsed || 0) % 60);
    const rows = [
      ['Contracts delivered', `${this.stats.delivered || 0} / ${this.contractCount}`],
      ['Fares earned', `${state.xp}`],
      ['Cash', `${state.currency}`],
      ['Shift time', `${mins}m ${String(secs).padStart(2, '0')}s`],
      ['Final heat', `${Math.round(this.stats.heat || 0)}%`],
    ];
    rows.forEach((r, i) => {
      const ry = top + 122 + i * 30;
      const k = text(r[0], { fill: 0x94a3b8, fontSize: 13 });
      k.position.set(cx - pw / 2 + 40, ry);
      this.container.addChild(k);
      const v = text(r[1], { fill: 0xe5f4ff, fontSize: 14, fontWeight: '900' });
      v.anchor.set(1, 0);
      v.position.set(cx + pw / 2 - 40, ry);
      this.container.addChild(v);
    });

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, top + ph - 52, 300, 42, 21).fill(accent);
    this.container.addChild(ctaBg);
    this.cta = text(this.win ? '▶  NEW SHIFT' : '▶  RETRY SHIFT', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 31);
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
