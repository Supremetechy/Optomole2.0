/**
 * BootScene (runner-gauntlet) — the start line.
 *
 * Short by design: this genre is a two-minute loop, so the card states the
 * course length, the controls, and the coach's line, then gets out of the way.
 */
const PIXI = window.PIXI;

export class BootScene {
  constructor(ctx, { title, subtitle, briefing, stageCount, tokenCount, onStart }) {
    this.ctx = ctx;
    this.onStart = onStart;
    this.container = new PIXI.Container();
    this._title = title || 'Optomole Gauntlet';
    this._subtitle = subtitle || 'Arcade · Runner Gauntlet';
    this._briefing = briefing || 'Jump the setbacks, grab the facts, and reach every checkpoint before your integrity runs out.';
    this._stageCount = stageCount || 1;
    this._tokenCount = tokenCount || 0;
    this._t = 0;
  }

  enter(ctx) {
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const pw = Math.min(560, width - 48);
    const ph = 336;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.94 })
      .stroke({ width: 1, color: 0xfbbf24, alpha: 0.42 });
    this.container.addChild(panel);

    const kicker = text(this._subtitle.toUpperCase(), { fill: 0xfbbf24, fontSize: 12, fontWeight: '800', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 30);
    this.container.addChild(kicker);

    const title = text(this._title, {
      fill: 0xffffff, fontSize: 28, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    title.anchor.set(0.5);
    title.position.set(cx, top + 68);
    this.container.addChild(title);

    const scale = text(`${this._stageCount} checkpoint${this._stageCount === 1 ? '' : 's'} · ${this._tokenCount} fact${this._tokenCount === 1 ? '' : 's'} on the course`, {
      fill: 0x67e8f9, fontSize: 12, fontWeight: '700',
    });
    scale.anchor.set(0.5);
    scale.position.set(cx, top + 98);
    this.container.addChild(scale);

    const brief = text(this._briefing, {
      fill: 0x94a3b8, fontSize: 14, align: 'center', wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 20,
    });
    brief.anchor.set(0.5, 0);
    brief.position.set(cx, top + 120);
    this.container.addChild(brief);

    const rules = [
      [0xfbbf24, 'Gold tokens are facts — grab them for combo'],
      [0xfb7185, 'Red spikes are setbacks — jump them'],
      [0x67e8f9, 'Checkpoints bank your run: a hit resumes there'],
    ];
    rules.forEach((r, i) => {
      const ry = top + 194 + i * 23;
      const dot = new PIXI.Graphics();
      dot.circle(cx - pw / 2 + 44, ry, 6).fill(r[0]);
      this.container.addChild(dot);
      const t = text(r[1], { fill: 0xcbd5e1, fontSize: 12.5, fontWeight: '600' });
      t.anchor.set(0, 0.5);
      t.position.set(cx - pw / 2 + 60, ry);
      this.container.addChild(t);
    });

    const controls = text('Jump: E / Space / W / ↑ / tap  ·  press again mid-air to double-jump', {
      fill: 0x475569, fontSize: 11, fontWeight: '700', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    controls.anchor.set(0.5);
    controls.position.set(cx, top + ph - 62);
    this.container.addChild(controls);

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 140, top + ph - 48, 280, 40, 20).fill(0xfbbf24);
    this.container.addChild(ctaBg);
    this.cta = text('▶  TAP TO RUN', { fill: 0x2a1a03, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 28);
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
