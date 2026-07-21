/**
 * BootScene (sandbox-craft-build) — the foreman's claim brief.
 *
 * Explains the three-beat loop (mine → craft → build) and what the blueprints
 * ask for, then waits for the first gesture, which also unlocks audio.
 */
const PIXI = window.PIXI;

export class BootScene {
  constructor(ctx, { title, subtitle, briefing, nodeCount, recipeCount, materials, onStart }) {
    this.ctx = ctx;
    this.onStart = onStart;
    this.container = new PIXI.Container();
    this._title = title || 'Optomole Claim';
    this._subtitle = subtitle || 'Sandbox · Craft & Build';
    this._briefing = briefing || 'Mine the blocks for materials, craft each step of the build, and raise it on the claim.';
    this._nodeCount = nodeCount || 0;
    this._recipeCount = recipeCount || 0;
    this._materials = materials || [];
    this._t = 0;
  }

  enter(ctx) {
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;
    const pw = Math.min(600, width - 48);
    const ph = 390;
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x050c18, alpha: 0.94 })
      .stroke({ width: 1, color: 0x34d399, alpha: 0.4 });
    this.container.addChild(panel);

    const kicker = text(this._subtitle.toUpperCase(), { fill: 0x34d399, fontSize: 12, fontWeight: '800', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 30);
    this.container.addChild(kicker);

    const title = text(this._title, {
      fill: 0xffffff, fontSize: 29, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    title.anchor.set(0.5);
    title.position.set(cx, top + 70);
    this.container.addChild(title);

    const scale = text(`${this._nodeCount} resource node${this._nodeCount === 1 ? '' : 's'} · ${this._recipeCount} structure${this._recipeCount === 1 ? '' : 's'} to build`, {
      fill: 0x67e8f9, fontSize: 12, fontWeight: '700',
    });
    scale.anchor.set(0.5);
    scale.position.set(cx, top + 100);
    this.container.addChild(scale);

    const brief = text(this._briefing, {
      fill: 0x94a3b8, fontSize: 14, align: 'center', wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 20,
    });
    brief.anchor.set(0.5, 0);
    brief.position.set(cx, top + 122);
    this.container.addChild(brief);

    // Material legend — the three things the world is made of.
    const matW = (pw - 80) / Math.max(1, this._materials.length);
    this._materials.forEach((mat, i) => {
      const mx = cx - pw / 2 + 40 + i * matW;
      const my = top + 200;
      const swatch = new PIXI.Graphics();
      swatch.roundRect(mx, my, matW - 10, 44, 8)
        .fill({ color: 0x0b1220, alpha: 0.9 })
        .stroke({ width: 1, color: 0x334155 });
      swatch.rect(mx + 12, my + 16, 12, 12).fill(mat.color);
      this.container.addChild(swatch);
      const t = text(mat.label, { fill: 0xcbd5e1, fontSize: 11, fontWeight: '800' });
      t.anchor.set(0, 0.5);
      t.position.set(mx + 32, my + 22);
      this.container.addChild(t);
    });

    const steps = [
      '1.  Walk to a block and HOLD E to mine it',
      '2.  Press C to open crafting and spend materials',
      '3.  Each craft raises a structure where you stand',
    ];
    steps.forEach((s, i) => {
      const t = text(s, { fill: 0xcbd5e1, fontSize: 12.5, fontWeight: '600' });
      t.anchor.set(0, 0.5);
      t.position.set(cx - pw / 2 + 44, top + 268 + i * 22);
      this.container.addChild(t);
    });

    const ctaBg = new PIXI.Graphics();
    ctaBg.roundRect(cx - 150, top + ph - 52, 300, 42, 21).fill(0x34d399);
    this.container.addChild(ctaBg);
    this.cta = text('▶  PRESS E / TAP TO STAKE THE CLAIM', { fill: 0x03131d, fontSize: 14, fontWeight: '900' });
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
