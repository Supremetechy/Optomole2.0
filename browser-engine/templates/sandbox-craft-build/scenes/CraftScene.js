/**
 * CraftScene — the crafting panel, pushed over the world.
 *
 * Lists every recipe derived from the content's procedure steps with its
 * material cost. Affordable recipes are lit and tappable; unaffordable ones show
 * exactly which material is short, which turns "go mine more" into a specific,
 * actionable goal rather than a vague grind.
 *
 * Crafting here calls back into WorldScene, which spends the materials and
 * raises the structure at the player's position.
 */
const PIXI = window.PIXI;

export class CraftScene {
  constructor(ctx, { model, onCraft, onClose }) {
    this.ctx = ctx;
    this.model = model;
    this.onCraft = onCraft;
    this.onClose = onClose;
    this.container = new PIXI.Container();
    this._t = 0;
    this._scroll = 0;
    this._armIn = 0.2; // swallow the keypress that opened the panel
  }

  enter(ctx) {
    this._layout(ctx.runtime.size());
  }

  _inventory() {
    return this.ctx.state.get('materials') || {};
  }

  _canAfford(recipe) {
    const inv = this._inventory();
    return Object.entries(recipe.cost).every(([m, n]) => (inv[m] || 0) >= n);
  }

  _shortfall(recipe) {
    const inv = this._inventory();
    return Object.entries(recipe.cost)
      .filter(([m, n]) => (inv[m] || 0) < n)
      .map(([m, n]) => {
        const mat = this.model.materials.find((x) => x.id === m);
        return `${n - (inv[m] || 0)} more ${mat ? mat.label : m}`;
      })
      .join(', ');
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;

    const dim = new PIXI.Graphics();
    dim.rect(0, 0, width, height).fill({ color: 0x030712, alpha: 0.86 });
    dim.eventMode = 'static';
    this.container.addChild(dim);

    const pw = Math.min(640, width - 32);
    const ph = Math.min(520, height - 40);
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x0b1220, alpha: 0.97 })
      .stroke({ width: 2, color: 0xa78bfa, alpha: 0.5 });
    this.container.addChild(panel);

    const kicker = text('CRAFTING', { fill: 0xa78bfa, fontSize: 12, fontWeight: '900', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 26);
    this.container.addChild(kicker);

    // Material bar across the top so cost math is always visible.
    const inv = this._inventory();
    const matW = (pw - 80) / this.model.materials.length;
    this.model.materials.forEach((mat, i) => {
      const mx = cx - pw / 2 + 40 + i * matW;
      const chip = new PIXI.Graphics();
      chip.roundRect(mx, top + 44, matW - 10, 30, 8)
        .fill({ color: 0x111c30, alpha: 0.95 })
        .stroke({ width: 1, color: 0x334155 });
      chip.rect(mx + 10, top + 54, 11, 11).fill(mat.color);
      this.container.addChild(chip);

      const t = text(`${inv[mat.id] || 0}  ${mat.label}`, { fill: 0xe5f4ff, fontSize: 12, fontWeight: '800' });
      t.anchor.set(0, 0.5);
      t.position.set(mx + 28, top + 59);
      this.container.addChild(t);
    });

    // Recipe rows.
    const listTop = top + 90;
    const rowH = 62;
    const visible = Math.max(1, Math.floor((ph - 150) / rowH));
    const pending = this.model.recipes.filter((r) => !r.crafted);
    const rows = pending.slice(this._scroll, this._scroll + visible);

    if (!pending.length) {
      const done = text('Every structure is built. Head out and finish the claim.', {
        fill: 0x34d399, fontSize: 14, fontWeight: '700', align: 'center', wordWrap: true, wordWrapWidth: pw - 80,
      });
      done.anchor.set(0.5, 0);
      done.position.set(cx, listTop + 40);
      this.container.addChild(done);
    }

    rows.forEach((recipe, i) => {
      const ry = listTop + i * rowH;
      const affordable = this._canAfford(recipe);

      const node = new PIXI.Container();
      node.position.set(cx - (pw - 80) / 2, ry);

      const bg = new PIXI.Graphics();
      bg.roundRect(0, 0, pw - 80, rowH - 8, 9)
        .fill({ color: affordable ? 0x14243f : 0x111c30, alpha: 0.95 })
        .stroke({ width: affordable ? 2 : 1, color: affordable ? 0x34d399 : 0x334155 });
      node.addChild(bg);

      const label = text(recipe.spec.label, {
        fill: affordable ? 0xe5f4ff : 0x94a3b8, fontSize: 13, fontWeight: '800',
        wordWrap: true, wordWrapWidth: pw - 260, lineHeight: 16,
      });
      label.position.set(14, 10);
      node.addChild(label);

      // Cost chips.
      const costParts = Object.entries(recipe.cost).map(([m, n]) => {
        const mat = this.model.materials.find((x) => x.id === m);
        const have = inv[m] || 0;
        return { text: `${n} ${mat ? mat.label.split(' ')[0] : m}`, ok: have >= n, color: mat?.color || 0x94a3b8 };
      });
      costParts.forEach((cp, ci) => {
        const chip = text(cp.text, { fill: cp.ok ? cp.color : 0xfb7185, fontSize: 11, fontWeight: '800' });
        chip.position.set(14 + ci * 108, rowH - 26);
        node.addChild(chip);
      });

      const status = text(
        affordable ? 'CRAFT ▸' : this._shortfall(recipe),
        {
          fill: affordable ? 0x34d399 : 0xfb7185, fontSize: 11, fontWeight: '900',
          align: 'right', wordWrap: true, wordWrapWidth: 150,
        },
      );
      status.anchor.set(1, 0.5);
      status.position.set(pw - 96, (rowH - 8) / 2);
      node.addChild(status);

      if (affordable) {
        node.eventMode = 'static';
        node.cursor = 'pointer';
        node.on('pointertap', () => this._craft(recipe));
      }

      this.container.addChild(node);
    });

    // Scroll controls when the recipe list overflows.
    if (pending.length > visible) {
      const more = text(`▲ / ▼ to scroll  ·  showing ${this._scroll + 1}–${Math.min(pending.length, this._scroll + visible)} of ${pending.length}`, {
        fill: 0x475569, fontSize: 11, fontWeight: '700',
      });
      more.anchor.set(0.5);
      more.position.set(cx, top + ph - 52);
      this.container.addChild(more);
      this._maxScroll = pending.length - visible;
    } else {
      this._maxScroll = 0;
    }

    this.cta = text('PRESS C / ESC / TAP OUTSIDE TO CLOSE', { fill: 0x67e8f9, fontSize: 11, fontWeight: '900' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 26);
    this.container.addChild(this.cta);

    dim.on('pointertap', () => this._close());
  }

  _craft(recipe) {
    if (!this._canAfford(recipe)) return;
    const inv = { ...this._inventory() };
    for (const [m, n] of Object.entries(recipe.cost)) inv[m] = Math.max(0, (inv[m] || 0) - n);
    this.ctx.state.set({ materials: inv });
    this.ctx.audio?.play('unlock');
    this.onCraft?.(recipe);
    this._layout(this.ctx.runtime.size());
  }

  _close() {
    if (this._closed || this._armIn > 0) return;
    this._closed = true;
    this.onClose?.();
  }

  update(dt) {
    this._t += dt;
    if (this._armIn > 0) this._armIn = Math.max(0, this._armIn - dt);
    if (this.cta) this.cta.alpha = 0.5 + Math.sin(this._t * 3) * 0.4;

    const keys = this.ctx.input.keys;
    if (keys.has('c') || keys.has('escape')) {
      keys.delete('c');
      keys.delete('escape');
      this._close();
    }
    if (keys.has('arrowdown') && this._scroll < this._maxScroll) {
      keys.delete('arrowdown');
      this._scroll++;
      this._layout(this.ctx.runtime.size());
    }
    if (keys.has('arrowup') && this._scroll > 0) {
      keys.delete('arrowup');
      this._scroll--;
      this._layout(this.ctx.runtime.size());
    }
    // Don't let a stray interact leak into the world scene underneath.
    this.ctx.input.consumeInteract();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}
