/**
 * RewardScene — the completion / victory screen.
 *
 * Shown after the final gate is unlocked. Fires a celebratory particle burst,
 * summarizes the run (XP, keys, rooms cleared, focus, completion %), and offers
 * a replay. This is the "quest-complete animation / reward burst" the runtime
 * was missing, plus the completion scene in the scene flow.
 */
const PIXI = window.PIXI;

export class RewardScene {
  constructor(ctx, { onReplay, roomCount }) {
    this.ctx = ctx;
    this.onReplay = onReplay;
    this.roomCount = roomCount;
    this.container = new PIXI.Container();
    this.particles = [];
    this._t = 0;
  }

  enter(ctx) {
    ctx.audio?.play('reward');
    this._layout(ctx.runtime.size());
    this._spawnBurst(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.ui?.destroy({ children: true });
    this.ui = new PIXI.Container();
    this.container.addChild(this.ui);
    const cx = width / 2;
    const s = this.ctx.state.get();
    const pct = this.roomCount ? Math.round((s.clearedRooms.length / this.roomCount) * 100) : 100;

    const panel = new PIXI.Graphics();
    const pw = Math.min(520, width - 48);
    const ph = 340;
    panel.roundRect(cx - pw / 2, height / 2 - ph / 2, pw, ph, 16)
      .fill({ color: 0x050c18, alpha: 0.94 })
      .stroke({ width: 1, color: 0x34d399, alpha: 0.5 });
    this.ui.addChild(panel);

    const kicker = text('EXPERIENCE COMPLETE', { fill: 0x34d399, fontSize: 13, fontWeight: '800', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, height / 2 - 118);
    this.ui.addChild(kicker);

    const title = text('Mission Accomplished', { fill: 0xffffff, fontSize: 28, fontWeight: '900' });
    title.anchor.set(0.5);
    title.position.set(cx, height / 2 - 84);
    this.ui.addChild(title);

    const stats = [
      ['XP Earned', s.xp],
      ['Currency', s.currency],
      ['Keys Collected', s.keys.length],
      ['Rooms Cleared', `${s.clearedRooms.length}/${this.roomCount}`],
      ['Focus Remaining', `${s.focus}%`],
      ['Completion', `${pct}%`],
    ];
    stats.forEach((row, i) => {
      const col = i % 2;
      const rowIdx = Math.floor(i / 2);
      const bx = cx - pw / 2 + 28 + col * ((pw - 56) / 2);
      const by = height / 2 - 44 + rowIdx * 56;
      const cell = new PIXI.Graphics();
      cell.roundRect(bx, by, (pw - 56) / 2 - 10, 46, 8).fill({ color: 0xffffff, alpha: 0.05 });
      this.ui.addChild(cell);
      const lab = text(row[0].toUpperCase(), { fill: 0x94a3b8, fontSize: 10, fontWeight: '700' });
      lab.position.set(bx + 12, by + 8);
      const val = text(String(row[1]), { fill: 0xffffff, fontSize: 19, fontWeight: '900' });
      val.position.set(bx + 12, by + 21);
      this.ui.addChild(lab);
      this.ui.addChild(val);
    });

    const btnBg = new PIXI.Graphics();
    btnBg.roundRect(cx - 130, height / 2 + 118, 260, 44, 22).fill(0x34d399);
    this.ui.addChild(btnBg);
    const btn = text('↻  PLAY AGAIN  (E)', { fill: 0x03131d, fontSize: 15, fontWeight: '900' });
    btn.anchor.set(0.5);
    btn.position.set(cx, height / 2 + 140);
    this.ui.addChild(btn);

    btnBg.eventMode = 'static';
    btnBg.cursor = 'pointer';
    btnBg.on('pointertap', () => this.onReplay?.());
  }

  _spawnBurst({ width, height }) {
    const colors = [0x34d399, 0x67e8f9, 0xa78bfa, 0xfbbf24, 0xfb7185];
    for (let i = 0; i < 90; i++) {
      const p = new PIXI.Sprite(this.ctx.assets.get('particle'));
      p.anchor.set(0.5);
      p.tint = colors[i % colors.length];
      p.x = width / 2;
      p.y = height / 2 - 40;
      const ang = Math.random() * Math.PI * 2;
      const spd = 120 + Math.random() * 260;
      p._vx = Math.cos(ang) * spd;
      p._vy = Math.sin(ang) * spd - 120;
      p._life = 1.4 + Math.random() * 0.8;
      p._max = p._life;
      p.scale.set(0.4 + Math.random() * 0.8);
      this.container.addChildAt(p, 0);
      this.particles.push(p);
    }
  }

  update(dt) {
    this._t += dt;
    for (const p of this.particles) {
      p._life -= dt;
      p._vy += 320 * dt; // gravity
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      p.rotation += dt * 4;
      p.alpha = Math.max(0, p._life / p._max);
    }
    this.particles = this.particles.filter((p) => {
      if (p._life <= 0) {
        p.destroy();
        return false;
      }
      return true;
    });
    if (this.ctx.input.consumeInteract()) this.onReplay?.();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}
