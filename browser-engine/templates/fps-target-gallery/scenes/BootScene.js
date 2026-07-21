/**
 * BootScene (fps-target-gallery) — the range officer's safety brief.
 *
 * States the rules of engagement before the first round, because the drill is
 * only meaningful if the player knows that holding fire scores. Waits for the
 * first gesture, which also unlocks audio.
 */
const PIXI = window.PIXI;

export class BootScene {
  constructor(ctx, { title, subtitle, briefing, roundCount, onStart }) {
    this.ctx = ctx;
    this.onStart = onStart;
    this.container = new PIXI.Container();
    this._title = title || 'Optomole Range';
    this._subtitle = subtitle || 'FPS · Target Gallery';
    this._briefing = briefing || 'Identify every threat downrange and engage it. Routine activity is not a target — hold fire and you score for it.';
    this._roundCount = roundCount || 1;
    this._t = 0;
  }

  enter(ctx) {
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const pw = Math.min(600, width - 48);
    const ph = 372;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.94 })
      .stroke({ width: 1, color: 0x34d399, alpha: 0.4 });
    this.container.addChild(panel);

    const kicker = text(this._subtitle.toUpperCase(), { fill: 0x34d399, fontSize: 12, fontWeight: '800', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 32);
    this.container.addChild(kicker);

    const title = text(this._title, {
      fill: 0xffffff, fontSize: 29, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    title.anchor.set(0.5);
    title.position.set(cx, top + 72);
    this.container.addChild(title);

    const rounds = text(`${this._roundCount} round${this._roundCount === 1 ? '' : 's'} · scored on accuracy and fire discipline`, {
      fill: 0x67e8f9, fontSize: 12, fontWeight: '700',
    });
    rounds.anchor.set(0.5);
    rounds.position.set(cx, top + 102);
    this.container.addChild(rounds);

    const brief = text(this._briefing, {
      fill: 0x94a3b8, fontSize: 14, align: 'center', wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 20,
    });
    brief.anchor.set(0.5, 0);
    brief.position.set(cx, top + 124);
    this.container.addChild(brief);

    const rules = [
      [0x34d399, 'Green targets are threats — engage them'],
      [0xfbbf24, 'Amber targets are routine — HOLD FIRE'],
      [0xa78bfa, 'Evidence targets pay double'],
      [0xfb7185, 'Stray and wrongful shots cost integrity'],
    ];
    rules.forEach((r, i) => {
      const ry = top + 196 + i * 24;
      const dot = new PIXI.Graphics();
      dot.circle(cx - pw / 2 + 44, ry, 6).fill(r[0]);
      this.container.addChild(dot);
      const t = text(r[1], { fill: 0xcbd5e1, fontSize: 13, fontWeight: '600' });
      t.anchor.set(0, 0.5);
      t.position.set(cx - pw / 2 + 60, ry);
      this.container.addChild(t);
    });

    const controls = text('Look: A/D or drag  ·  Move: W/S  ·  Fire: E / Space / tap right', {
      fill: 0x475569, fontSize: 11, fontWeight: '700',
    });
    controls.anchor.set(0.5);
    controls.position.set(cx, top + ph - 66);
    this.container.addChild(controls);

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, top + ph - 52, 300, 42, 21).fill(0x34d399);
    this.container.addChild(ctaBg);
    this.cta = text('▶  PRESS E / TAP TO GO HOT', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 31);
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
