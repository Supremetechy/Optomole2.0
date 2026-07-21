/**
 * CompletionScene (sandbox-craft-build) — the build report.
 *
 * Reports what the player actually assembled: structures raised, blueprints
 * completed, materials mined, and time on the claim. On an energy-out it shows
 * how far the build got, which is the number to beat on the retry.
 */
const PIXI = window.PIXI;

export class CompletionScene {
  constructor(ctx, { win, model, stats = {}, onReplay }) {
    this.ctx = ctx;
    this.win = win;
    this.model = model;
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

    const pw = Math.min(560, width - 48);
    const ph = 366;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.95 })
      .stroke({ width: 2, color: accent, alpha: 0.55 });
    this.container.addChild(panel);

    const kicker = text(this.win ? 'BUILD COMPLETE' : 'OUT OF ENERGY', {
      fill: accent, fontSize: 12, fontWeight: '900', letterSpacing: 2,
    });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 30);
    this.container.addChild(kicker);

    const headline = this.win
      ? 'Every blueprint is standing on the claim.'
      : 'The day ran out before the build did.';
    const title = text(headline, {
      fill: 0xffffff, fontSize: 20, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60, lineHeight: 25,
    });
    title.anchor.set(0.5, 0);
    title.position.set(cx, top + 52);
    this.container.addChild(title);

    const state = this.ctx.state.get();
    const inv = state.materials || {};
    const totalMined = Object.values(inv).reduce((n, v) => n + v, 0);
    const blueprintsDone = this.model.blueprints.filter((b) => b.complete).length;
    const mins = Math.floor((this.stats.elapsed || 0) / 60);
    const secs = Math.round((this.stats.elapsed || 0) % 60);

    const rows = [
      ['Structures built', `${this.stats.built || 0} / ${this.model.recipes.length}`],
      ['Blueprints complete', `${blueprintsDone} / ${this.model.blueprints.length}`],
      ['Nodes mined out', `${state.keys.length} / ${this.model.nodes.length}`],
      ['Materials in hand', `${totalMined}`],
      ['Time on the claim', `${mins}m ${String(secs).padStart(2, '0')}s`],
      ['XP', `${state.xp}`],
    ];
    rows.forEach((r, i) => {
      const ry = top + 116 + i * 29;
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
    this.cta = text(this.win ? '▶  NEW CLAIM' : '▶  TRY AGAIN', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
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
