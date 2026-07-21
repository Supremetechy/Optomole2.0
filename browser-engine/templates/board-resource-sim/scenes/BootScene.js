/**
 * BootScene (board-resource-sim) — title card + rules shown before the board.
 *
 * Shows the title, the coach briefing (folded in from any NPC binding), and the
 * board rules, then waits for the first gesture (click / tap / E / Space), which
 * also unlocks audio.
 */
const PIXI = window.PIXI;

export class BootScene {
  constructor(ctx, { title, subtitle, briefing, onStart }) {
    this.ctx = ctx;
    this.onStart = onStart;
    this.container = new PIXI.Container();
    this._title = title || 'Optomole Board';
    this._subtitle = subtitle || 'Board · Resource Sim';
    this._briefing = briefing || 'Roll the die, lap the board, and collect every concept square while managing your energy and coins.';
    this._t = 0;
  }

  enter(ctx) {
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;

    const pw = Math.min(580, width - 48);
    const ph = 340;
    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, height / 2 - ph / 2, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.92 })
      .stroke({ width: 1, color: 0x67e8f9, alpha: 0.35 });
    this.container.addChild(panel);

    const kicker = text(this._subtitle.toUpperCase(), { fill: 0x67e8f9, fontSize: 12, fontWeight: '800', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, height / 2 - 118);
    this.container.addChild(kicker);

    const title = text(this._title, { fill: 0xffffff, fontSize: 30, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60 });
    title.anchor.set(0.5);
    title.position.set(cx, height / 2 - 74);
    this.container.addChild(title);

    const brief = text(this._briefing, { fill: 0x94a3b8, fontSize: 15, align: 'center', wordWrap: true, wordWrapWidth: pw - 72, lineHeight: 21 });
    brief.anchor.set(0.5);
    brief.position.set(cx, height / 2 - 18);
    this.container.addChild(brief);

    const rules = [
      [0x34d399, '◆ Concept — land or pass to collect Knowledge'],
      [0xfb7185, '⚠ Hazard — landing costs energy & coins'],
      [0x67e8f9, '★ START — each lap: +coins and refuel'],
    ];
    rules.forEach((r, i) => {
      const ry = height / 2 + 40 + i * 24;
      const dot = new PIXI.Graphics();
      dot.circle(cx - pw / 2 + 40, ry, 7).fill(r[0]);
      this.container.addChild(dot);
      const t = text(r[1], { fill: 0xcbd5e1, fontSize: 13, fontWeight: '600' });
      t.anchor.set(0, 0.5);
      t.position.set(cx - pw / 2 + 56, ry);
      this.container.addChild(t);
    });

    this.cta = text('▶  PRESS E / TAP TO START', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, height / 2 + ph / 2 - 30, 300, 44, 22).fill(0x67e8f9);
    this.container.addChild(ctaBg);
    this.container.addChild(this.cta);
    this.cta.position.set(cx, height / 2 + ph / 2 - 8);

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
