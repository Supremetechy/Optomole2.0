/**
 * ResultScene (runner-gauntlet) — the run card.
 *
 * Built for repetition: distance is the headline number, and the card names the
 * single thing to beat next time (facts missed, a broken combo, or the flawless
 * run). Personal best is tracked on the state store across replays in a session.
 */
const PIXI = window.PIXI;

export class ResultScene {
  constructor(ctx, { win, stats = {}, targetSpec = null, onReplay }) {
    this.ctx = ctx;
    this.win = win;
    this.stats = stats;
    this.targetSpec = targetSpec;
    this.onReplay = onReplay;
    this.container = new PIXI.Container();
    this._t = 0;
  }

  enter(ctx) {
    this.ctx.audio?.play(this.win ? 'reward' : 'failure');
    // Track a session personal best so the replay has a number to beat. A first
    // run sets the bar rather than announcing itself as a record.
    const previousBest = this.ctx.state.get('bestDistance') || 0;
    const distance = this.stats.distance || 0;
    this.isNewBest = previousBest > 0 && distance > previousBest;
    this.ctx.state.set({ bestDistance: Math.max(previousBest, distance) });
    this._layout(ctx.runtime.size());
  }

  /** The one thing worth chasing on the next run. */
  _nextGoal() {
    if (!this.win) return 'Reach the final checkpoint to finish the course.';
    if (this.stats.hits > 0) return 'Finish without a single setback for the flawless bonus.';
    if ((this.stats.tokens || 0) < (this.stats.tokenTotal || 0)) {
      return `Collect all ${this.stats.tokenTotal} facts — you missed ${this.stats.tokenTotal - this.stats.tokens}.`;
    }
    return 'Perfect run. Try it again for a faster time.';
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const accent = this.win ? 0x34d399 : 0xfb7185;

    const pw = Math.min(540, width - 48);
    const ph = 380;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.95 })
      .stroke({ width: 2, color: accent, alpha: 0.55 });
    this.container.addChild(panel);

    const kicker = text(this.win ? 'COURSE COMPLETE' : 'RUN ENDED', {
      fill: accent, fontSize: 12, fontWeight: '900', letterSpacing: 2,
    });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 28);
    this.container.addChild(kicker);

    // Distance is the headline — this genre lives on one comparable number.
    const dist = text(`${this.stats.distance || 0} m`, { fill: 0xffffff, fontSize: 42, fontWeight: '900' });
    dist.anchor.set(0.5);
    dist.position.set(cx, top + 72);
    this.container.addChild(dist);

    if (this.isNewBest) {
      const pb = text('★ NEW PERSONAL BEST', { fill: 0xfbbf24, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 });
      pb.anchor.set(0.5);
      pb.position.set(cx, top + 102);
      this.container.addChild(pb);
    }

    const state = this.ctx.state.get();
    const rows = [
      ['Facts collected', `${this.stats.tokens || 0} / ${this.stats.tokenTotal || 0}`],
      ['Checkpoints reached', `${this.stats.checkpoints || 0} / ${this.stats.checkpointTotal || 0}`],
      ['Best combo', `×${this.stats.bestCombo || 0}`],
      ['Setbacks taken', `${this.stats.hits || 0}`],
      ['Score', `${state.xp}`],
      ['Session best', `${state.bestDistance || 0} m`],
    ];
    rows.forEach((r, i) => {
      const ry = top + 126 + i * 27;
      const k = text(r[0], { fill: 0x94a3b8, fontSize: 13 });
      k.position.set(cx - pw / 2 + 40, ry);
      this.container.addChild(k);
      const v = text(r[1], { fill: 0xe5f4ff, fontSize: 14, fontWeight: '900' });
      v.anchor.set(1, 0);
      v.position.set(cx + pw / 2 - 40, ry);
      this.container.addChild(v);
    });

    const goal = text(`Next run: ${this._nextGoal()}`, {
      fill: 0x67e8f9, fontSize: 12, fontWeight: '700', align: 'center', wordWrap: true, wordWrapWidth: pw - 70, lineHeight: 16,
    });
    goal.anchor.set(0.5, 0);
    goal.position.set(cx, top + 126 + rows.length * 27 + 8);
    this.container.addChild(goal);

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 140, top + ph - 50, 280, 40, 20).fill(accent);
    this.container.addChild(ctaBg);
    this.cta = text('▶  RUN AGAIN', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 30);
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
