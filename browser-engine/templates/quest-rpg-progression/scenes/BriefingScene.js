/**
 * BriefingScene — the quest-giver's chapter framing, pushed over the region.
 *
 * Shows the NPC portrait, their line (from the npc-dialogue binding), and the
 * chapter's objective list so the player knows what the region asks of them
 * before they start walking. Dismiss with interact/tap to drop back into play.
 */
const PIXI = window.PIXI;

export class BriefingScene {
  constructor(ctx, { giver, chapter, onClose }) {
    this.ctx = ctx;
    this.giver = giver;
    this.chapter = chapter;
    this.onClose = onClose;
    this.container = new PIXI.Container();
    this._t = 0;
    this._closed = false;
    // Ignore the very first frames so the interact press that opened this
    // overlay doesn't immediately dismiss it.
    this._armIn = 0.25;
  }

  enter(ctx) {
    this.ctx.audio?.play('talk');
    this._layout(ctx.runtime.size());
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    const cx = width / 2;

    const dim = new PIXI.Graphics();
    dim.rect(0, 0, width, height).fill({ color: 0x030712, alpha: 0.78 });
    dim.eventMode = 'static';
    dim.on('pointertap', () => this._close());
    this.container.addChild(dim);

    const pw = Math.min(600, width - 40);
    const objectives = this.chapter?.objectives || [];
    const ph = Math.min(430, height - 60);
    const top = height / 2 - ph / 2;

    const panel = new PIXI.Graphics();
    panel.roundRect(cx - pw / 2, top, pw, ph, 14)
      .fill({ color: 0x0b1220, alpha: 0.97 })
      .stroke({ width: 2, color: 0xfbbf24, alpha: 0.45 });
    this.container.addChild(panel);

    // Portrait
    const portrait = new PIXI.Sprite(this.ctx.assets.get('npc'));
    portrait.anchor.set(0.5);
    portrait.width = 54;
    portrait.height = 60;
    portrait.position.set(cx - pw / 2 + 54, top + 56);
    this.container.addChild(portrait);

    const name = text(this.giver?.label || 'Guide', { fill: 0xfbbf24, fontSize: 16, fontWeight: '900' });
    name.position.set(cx - pw / 2 + 96, top + 34);
    this.container.addChild(name);

    const role = text('QUESTLINE BRIEFING', { fill: 0x64748b, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 });
    role.position.set(cx - pw / 2 + 96, top + 56);
    this.container.addChild(role);

    const line = text(this.giver?.description || this.giver?.evidence || 'Take the region one fact at a time.', {
      fill: 0xe5f4ff, fontSize: 14, wordWrap: true, wordWrapWidth: pw - 80, lineHeight: 21,
    });
    line.position.set(cx - pw / 2 + 40, top + 96);
    this.container.addChild(line);

    const listTop = top + 106 + line.height;
    const listTitle = text(`THIS CHAPTER · ${objectives.length} objective${objectives.length === 1 ? '' : 's'}`, {
      fill: 0x67e8f9, fontSize: 10, fontWeight: '800', letterSpacing: 1.4,
    });
    listTitle.position.set(cx - pw / 2 + 40, listTop);
    this.container.addChild(listTitle);

    // Cap the visible list so a long chapter can't overflow the panel.
    const maxRows = Math.max(3, Math.floor((top + ph - 70 - (listTop + 22)) / 20));
    objectives.slice(0, maxRows).forEach((o, i) => {
      const row = text(`○  ${shorten(o.label, 58)}`, { fill: 0xcbd5e1, fontSize: 12 });
      row.position.set(cx - pw / 2 + 40, listTop + 22 + i * 20);
      this.container.addChild(row);
    });
    if (objectives.length > maxRows) {
      const more = text(`+ ${objectives.length - maxRows} more`, { fill: 0x475569, fontSize: 11, fontWeight: '700' });
      more.position.set(cx - pw / 2 + 40, listTop + 22 + maxRows * 20);
      this.container.addChild(more);
    }

    this.cta = text('PRESS E / TAP TO CONTINUE', { fill: 0x67e8f9, fontSize: 12, fontWeight: '900' });
    this.cta.anchor.set(0.5, 1);
    this.cta.position.set(cx, top + ph - 18);
    this.container.addChild(this.cta);
  }

  _close() {
    if (this._closed || this._armIn > 0) return;
    this._closed = true;
    this.onClose?.();
  }

  update(dt) {
    this._t += dt;
    if (this._armIn > 0) this._armIn = Math.max(0, this._armIn - dt);
    if (this.cta) this.cta.alpha = 0.55 + Math.sin(this._t * 4) * 0.45;
    if (this.ctx.input.consumeInteract()) this._close();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}

function shorten(str, max) {
  const t = String(str || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}