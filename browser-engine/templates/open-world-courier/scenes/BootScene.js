/**
 * BootScene (open-world-courier) — the dispatcher's shift brief.
 *
 * Sets up the run: how many contracts are on the board, what heat means, and
 * that the route is the player's own choice. Waits for the first gesture, which
 * also unlocks audio.
 */
const PIXI = window.PIXI;

export class BootScene {
  constructor(ctx, { title, subtitle, briefing, contractCount, districtCount, onStart }) {
    this.ctx = ctx;
    this.onStart = onStart;
    this.container = new PIXI.Container();
    this._title = title || 'Optomole Courier';
    this._subtitle = subtitle || 'Open World · Courier';
    this._briefing = briefing || 'The board is yours. Pick up each job, run it across town, and keep the heat down.';
    this._contractCount = contractCount || 0;
    this._districtCount = districtCount || 1;
    this._t = 0;
  }

  enter(ctx) {
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const pw = Math.min(600, width - 48);
    const ph = 366;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.94 })
      .stroke({ width: 1, color: 0x67e8f9, alpha: 0.4 });
    this.container.addChild(panel);

    const kicker = text(this._subtitle.toUpperCase(), { fill: 0x67e8f9, fontSize: 12, fontWeight: '800', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 32);
    this.container.addChild(kicker);

    const title = text(this._title, {
      fill: 0xffffff, fontSize: 29, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    title.anchor.set(0.5);
    title.position.set(cx, top + 72);
    this.container.addChild(title);

    const board = text(`${this._contractCount} contract${this._contractCount === 1 ? '' : 's'} across ${this._districtCount} district${this._districtCount === 1 ? '' : 's'}`, {
      fill: 0x34d399, fontSize: 12, fontWeight: '700',
    });
    board.anchor.set(0.5);
    board.position.set(cx, top + 102);
    this.container.addChild(board);

    const brief = text(this._briefing, {
      fill: 0x94a3b8, fontSize: 14, align: 'center', wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 20,
    });
    brief.anchor.set(0.5, 0);
    brief.position.set(cx, top + 124);
    this.container.addChild(brief);

    const rules = [
      [0x34d399, 'Green ring = pickup. Drive into it to load.'],
      [0xa78bfa, 'Purple ring = drop-off. Deliver for the fare.'],
      [0xfb7185, 'Red patrols chase on sight — contact raises heat.'],
      [0x67e8f9, 'Heat maxed = busted. Deliveries cool it down.'],
    ];
    rules.forEach((r, i) => {
      const ry = top + 198 + i * 23;
      const dot = new PIXI.Graphics();
      dot.circle(cx - pw / 2 + 44, ry, 6).fill(r[0]);
      this.container.addChild(dot);
      const t = text(r[1], { fill: 0xcbd5e1, fontSize: 12.5, fontWeight: '600' });
      t.anchor.set(0, 0.5);
      t.position.set(cx - pw / 2 + 60, ry);
      this.container.addChild(t);
    });

    const controls = text('W/S throttle & brake  ·  A/D steer  ·  joystick on touch', {
      fill: 0x475569, fontSize: 11, fontWeight: '700',
    });
    controls.anchor.set(0.5);
    controls.position.set(cx, top + ph - 64);
    this.container.addChild(controls);

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, top + ph - 50, 300, 42, 21).fill(0x67e8f9);
    this.container.addChild(ctaBg);
    this.cta = text('▶  PRESS E / TAP TO ROLL OUT', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 29);
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
