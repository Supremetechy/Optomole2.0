/**
 * EncounterScene — the "combat" layer, pushed over the region.
 *
 * The fight is a recall check drawn from the user's own content: the enemy is a
 * hazard from the source, and the answer options are sibling facts. Pick the
 * right one and the enemy loses a pip; pick wrong and it lands a hit (focus
 * damage) and the wrong option is struck through. The encounter ends when the
 * enemy is defeated or the player retreats.
 *
 * The Insight skill reveals one wrong option up front, which is what makes
 * spending skill points feel like it changes the game rather than a number.
 */
const PIXI = window.PIXI;

export class EncounterScene {
  constructor(ctx, { enemy, quiz, insight = 0, onResolve }) {
    this.ctx = ctx;
    this.enemy = enemy;
    this.quiz = quiz || { question: enemy.spec.description || enemy.spec.label, options: [] };
    this.insight = insight;
    this.onResolve = onResolve;

    this.container = new PIXI.Container();
    this._t = 0;
    this._hits = 0;
    this._misses = 0;
    this._resolved = false;
    this._eliminated = new Set(); // option ids removed by Insight or wrong picks
    this._optionNodes = [];
  }

  enter(ctx) {
    // Insight pre-eliminates wrong options, one per point, never all of them.
    const wrong = this.quiz.options.filter((o) => !o.correct);
    for (let i = 0; i < Math.min(this.insight, Math.max(0, wrong.length - 1)); i++) {
      this._eliminated.add(wrong[i].id);
    }
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    this._optionNodes = [];
    const cx = width / 2;

    // Dim the region behind the encounter.
    const dim = new PIXI.Graphics();
    dim.rect(0, 0, width, height).fill({ color: 0x030712, alpha: 0.82 });
    dim.eventMode = 'static';
    this.container.addChild(dim);

    const pw = Math.min(620, width - 40);
    const ph = Math.min(470, height - 60);
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x0b1220, alpha: 0.97 })
      .stroke({ width: 2, color: 0xfb7185, alpha: 0.5 });
    this.container.addChild(panel);

    const kicker = text('ENCOUNTER', { fill: 0xfb7185, fontSize: 12, fontWeight: '900', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 26);
    this.container.addChild(kicker);

    const name = text(this.enemy.spec.label, {
      fill: 0xffffff, fontSize: 20, fontWeight: '900', align: 'center', wordWrap: true, wordWrapWidth: pw - 60,
    });
    name.anchor.set(0.5, 0);
    name.position.set(cx, top + 42);
    this.container.addChild(name);

    // Enemy HP pips.
    this.pips = new PIXI.Graphics();
    this.pips.position.set(cx, top + 84);
    this.container.addChild(this.pips);
    this._drawPips();

    const question = text(this.quiz.question, {
      fill: 0xcbd5e1, fontSize: 14, align: 'center', wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 20,
    });
    question.anchor.set(0.5, 0);
    question.position.set(cx, top + 106);
    this.container.addChild(question);

    const prompt = text('Choose the fact that answers it:', { fill: 0x64748b, fontSize: 11, fontWeight: '700' });
    prompt.anchor.set(0.5, 0);
    prompt.position.set(cx, top + 106 + question.height + 10);
    this.container.addChild(prompt);

    // Answer buttons — number keys 1..N also select, for desktop players.
    const optTop = top + 106 + question.height + 32;
    const optH = 46;
    this.quiz.options.forEach((opt, i) => {
      const oy = optTop + i * (optH + 8);
      const node = new PIXI.Container();
      node.position.set(cx - (pw - 80) / 2, oy);

      const bg = new PIXI.Graphics();
      bg.roundRect(0, 0, pw - 80, optH, 8)
        .fill({ color: 0x111c30, alpha: 0.95 })
        .stroke({ width: 1, color: 0x334155 });
      node.addChild(bg);

      const num = text(`${i + 1}`, { fill: 0x67e8f9, fontSize: 12, fontWeight: '900' });
      num.anchor.set(0.5);
      num.position.set(22, optH / 2);
      node.addChild(num);

      const label = text(opt.label, {
        fill: 0xe5f4ff, fontSize: 13, fontWeight: '600', wordWrap: true, wordWrapWidth: pw - 140, lineHeight: 17,
      });
      label.anchor.set(0, 0.5);
      label.position.set(42, optH / 2);
      node.addChild(label);

      const strike = new PIXI.Graphics();
      node.addChild(strike);

      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.on('pointertap', () => this._pick(opt));

      this.container.addChild(node);
      this._optionNodes.push({ opt, node, bg, label, strike, w: pw - 80, h: optH });
    });

    this.feedback = text('', {
      fill: 0xfbbf24, fontSize: 12, align: 'center', wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 16,
    });
    this.feedback.anchor.set(0.5, 1);
    this.feedback.position.set(cx, top + ph - 36);
    this.container.addChild(this.feedback);

    const retreat = text('Press ESC to retreat', { fill: 0x475569, fontSize: 10, fontWeight: '700' });
    retreat.anchor.set(0.5, 1);
    retreat.position.set(cx, top + ph - 14);
    this.container.addChild(retreat);

    this._refreshOptions();
  }

  _drawPips() {
    if (!this.pips) return;
    this.pips.clear();
    const w = 16;
    const gap = 5;
    const total = this.enemy.maxHp * w + (this.enemy.maxHp - 1) * gap;
    for (let i = 0; i < this.enemy.maxHp; i++) {
      const x = -total / 2 + i * (w + gap);
      this.pips.roundRect(x, 0, w, 6, 3).fill(i < this.enemy.hp ? 0xfb7185 : 0x334155);
    }
  }

  _refreshOptions() {
    for (const o of this._optionNodes) {
      const dead = this._eliminated.has(o.opt.id);
      o.node.alpha = dead ? 0.35 : 1;
      o.node.eventMode = dead ? 'none' : 'static';
      if (dead) {
        o.strike.clear();
        o.strike.moveTo(42, o.h / 2).lineTo(o.w - 16, o.h / 2).stroke({ width: 2, color: 0x7f1d1d });
      }
    }
  }

  _pick(opt) {
    if (this._resolved || this._eliminated.has(opt.id)) return;

    if (opt.correct) {
      this._hits++;
      const defeated = this.enemy.damage(1);
      this._drawPips();
      this.ctx.audio?.play('success');
      this.feedback.style.fill = 0x34d399;
      this.feedback.text = `✓ Correct. ${opt.detail || ''}`.trim();
      if (defeated) {
        this._resolve({ defeated: true, damage: this._misses * 6, hits: this._hits });
      } else {
        // Enemy survives: it strikes back lightly, and the round continues.
        this.feedback.text += `  The threat reels — ${this.enemy.hp} pip${this.enemy.hp === 1 ? '' : 's'} left.`;
      }
    } else {
      this._misses++;
      this._eliminated.add(opt.id);
      this._refreshOptions();
      this.ctx.audio?.play('failure');
      this.feedback.style.fill = 0xfb7185;
      this.feedback.text = `✗ Not that one. ${this.enemy.spec.description || ''}`.trim();

      // Running out of options means the encounter is lost for now.
      const alive = this.quiz.options.filter((o) => !this._eliminated.has(o.id));
      if (alive.length === 0) {
        this._resolve({ defeated: false, damage: 14 + this._misses * 4, hits: this._hits });
      }
    }
  }

  _resolve(result) {
    if (this._resolved) return;
    this._resolved = true;
    this.onResolve?.(result);
  }

  update(dt) {
    this._t += dt;
    // Number-key selection, and ESC to retreat with a small focus cost.
    const keys = this.ctx.input.keys;
    for (let i = 0; i < this._optionNodes.length; i++) {
      if (keys.has(String(i + 1))) {
        keys.delete(String(i + 1));
        this._pick(this._optionNodes[i].opt);
        break;
      }
    }
    if (keys.has('escape')) {
      keys.delete('escape');
      this._resolve({ defeated: false, damage: 8, retreated: true, hits: this._hits });
    }
    // Swallow a stray interact press so it doesn't leak into the region below.
    this.ctx.input.consumeInteract();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}