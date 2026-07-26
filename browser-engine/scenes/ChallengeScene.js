/**
 * ChallengeScene — the analyst challenge, played as a capstone.
 *
 * A multi-select recall check over the person's own material: read the briefing,
 * pick the snippets that support it, reject the ones that don't, then submit.
 * Genre-agnostic on purpose — it is pure UI over a `challenges` component entry,
 * so any template can play it without a physics world or its own prefabs. It
 * lives outside templates/ for that reason.
 *
 *   ChallengeBook.first() -> ChallengeScene -> onDone({ passed, score })
 *
 * Scoring is symmetric: a correct pick and a correctly-rejected distractor each
 * count, so "select everything" scores no better than chance.
 */
const PIXI = window.PIXI;

const COLORS = {
  panel: 0x0b1220,
  accent: 0x67e8f9,
  correct: 0x34d399,
  wrong: 0xf87171,
  idle: 0x111c30,
  stroke: 0x334155,
  muted: 0x94a3b8,
};

export class ChallengeScene {
  constructor(ctx, { challenge, onDone }) {
    this.ctx = ctx;
    this.challenge = challenge;
    this.onDone = onDone;
    this.container = new PIXI.Container();
    this.selected = new Set();
    this.submitted = false;
    this._t = 0;
    this._rows = [];
  }

  enter(ctx) {
    this.ctx.audio?.play('reward');
    this.ctx.state.set({ hint: 'Click the supporting snippets (or press 1-6), then press E to submit.' });
    this.ctx.state.logEvent('Analyst challenge — verify the briefing');
    this._layout(ctx.runtime.size());
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    this._rows = [];
    const cx = width / 2;

    const dim = new PIXI.Graphics();
    dim.rect(0, 0, width, height).fill({ color: 0x030712, alpha: 0.88 });
    dim.eventMode = 'static';
    this.container.addChild(dim);

    const options = this.challenge.options;
    const rowH = 46;
    const pw = Math.min(680, width - 32);
    const ph = Math.min(height - 40, 250 + options.length * rowH);
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: COLORS.panel, alpha: 0.97 })
      .stroke({ width: 2, color: COLORS.accent, alpha: 0.55 });
    this.container.addChild(panel);

    const kicker = text('ANALYST CHALLENGE', { fill: COLORS.accent, fontSize: 12, fontWeight: '900', letterSpacing: 2 });
    kicker.anchor.set(0.5);
    kicker.position.set(cx, top + 26);
    this.container.addChild(kicker);

    const instructions = text(this.challenge.instructions, {
      fill: 0xffffff, fontSize: 14, fontWeight: '700', wordWrap: true, wordWrapWidth: pw - 60, align: 'center',
    });
    instructions.anchor.set(0.5, 0);
    instructions.position.set(cx, top + 44);
    this.container.addChild(instructions);

    // The summary under test.
    const briefing = text(clip(this.challenge.prompt, 240), {
      fill: COLORS.muted, fontSize: 12, fontStyle: 'italic', wordWrap: true, wordWrapWidth: pw - 70, align: 'center',
    });
    briefing.anchor.set(0.5, 0);
    briefing.position.set(cx, top + 44 + instructions.height + 10);
    this.container.addChild(briefing);

    const listTop = top + 44 + instructions.height + briefing.height + 24;
    options.forEach((option, i) => {
      const row = new PIXI.Container();
      row.position.set(cx - pw / 2 + 24, listTop + i * rowH);

      const bg = new PIXI.Graphics();
      bg.roundRect(0, 0, pw - 48, rowH - 8, 8)
        .fill({ color: COLORS.idle, alpha: 0.95 })
        .stroke({ width: 1, color: COLORS.stroke });
      row.addChild(bg);

      const key = text(String(i + 1), { fill: COLORS.accent, fontSize: 12, fontWeight: '900' });
      key.anchor.set(0.5);
      key.position.set(20, (rowH - 8) / 2);
      row.addChild(key);

      const label = text(clip(option.label, 78), { fill: 0xe2e8f0, fontSize: 13, fontWeight: '600' });
      label.anchor.set(0, 0.5);
      label.position.set(40, (rowH - 8) / 2);
      row.addChild(label);

      const mark = text('', { fill: 0xffffff, fontSize: 15, fontWeight: '900' });
      mark.anchor.set(1, 0.5);
      mark.position.set(pw - 66, (rowH - 8) / 2);
      row.addChild(mark);

      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointertap', () => this._toggle(i));

      this.container.addChild(row);
      this._rows.push({ option, bg, mark, row, width: pw - 48, height: rowH - 8 });
    });

    this.cta = text('Press E to submit', { fill: COLORS.accent, fontSize: 13, fontWeight: '800' });
    this.cta.anchor.set(0.5);
    this.cta.position.set(cx, top + ph - 26);
    this.container.addChild(this.cta);

    this._paint();
  }

  _toggle(index) {
    if (this.submitted) return;
    if (this.selected.has(index)) this.selected.delete(index);
    else this.selected.add(index);
    this.ctx.audio?.play('pickup');
    this._paint();
  }

  /** Repaint row states. After submit, rows also reveal correctness. */
  _paint() {
    this._rows.forEach((row, i) => {
      const chosen = this.selected.has(i);
      let color = COLORS.stroke;
      let fill = COLORS.idle;
      let mark = chosen ? '◉' : '○';

      if (this.submitted) {
        const right = row.option.correct === chosen;
        color = right ? COLORS.correct : COLORS.wrong;
        fill = right ? 0x0f2a22 : 0x2a1216;
        mark = row.option.correct ? '✓' : '✕';
      } else if (chosen) {
        color = COLORS.accent;
        fill = 0x14263c;
      }

      row.bg.clear();
      row.bg.roundRect(0, 0, row.width, row.height, 8).fill({ color: fill, alpha: 0.95 }).stroke({ width: chosen || this.submitted ? 2 : 1, color });
      row.mark.text = mark;
      row.mark.style.fill = this.submitted ? color : (chosen ? COLORS.accent : COLORS.muted);
    });

    if (this.cta && !this.submitted) {
      this.cta.text = this.selected.size
        ? `${this.selected.size} selected — press E to submit`
        : 'Select the supporting snippets, then press E';
    }
  }

  _submit() {
    if (this.submitted) return;
    this.submitted = true;

    // Symmetric scoring: rejecting a distractor counts as much as picking
    // evidence, so blanket-selecting everything gains nothing.
    let score = 0;
    this._rows.forEach((row, i) => {
      if (row.option.correct === this.selected.has(i)) score++;
      row.row.eventMode = 'none';
    });
    const total = this._rows.length;
    const passed = score >= Math.ceil(total * 0.7);

    this._paint();
    this.ctx.audio?.play(passed ? 'success' : 'failure');
    this.ctx.state.logEvent(`Analyst challenge: ${score}/${total} ${passed ? '— verified' : '— review the source'}`);
    if (passed) this.ctx.state.addXp(80);
    else this.ctx.state.damageFocus(10);

    if (this.cta) {
      this.cta.text = `${score}/${total} correct — press E to continue`;
      this.cta.style.fill = passed ? COLORS.correct : COLORS.wrong;
    }
    this._result = { passed, score, total };
  }

  update(dt) {
    this._t += dt;
    if (this.cta) this.cta.alpha = 0.55 + Math.sin(this._t * 4) * 0.45;

    const keys = this.ctx.input.keys;
    for (let i = 0; i < this._rows.length; i++) {
      if (keys.has(String(i + 1))) {
        keys.delete(String(i + 1));
        this._toggle(i);
      }
    }
    if (keys.has('e')) {
      keys.delete('e');
      if (this.submitted) this.onDone?.(this._result);
      else this._submit();
    }
  }

  exit() {
    this.container.removeChildren();
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}

function clip(value, max) {
  const t = String(value || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
