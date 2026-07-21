/**
 * DialogueScene — an overlay conversation pushed on top of the RoomScene.
 *
 * Renders the current dialogue node (speaker portrait, text, choices) from the
 * shared DialogueEngine. Choices are clickable and also selectable with number
 * keys 1-3. When the tree ends, the scene pops itself and returns control to the
 * room. This is the "dialogue scene" in the boot/gameplay/dialogue/reward flow.
 */
const PIXI = window.PIXI;

export class DialogueScene {
  constructor(ctx, { tree, onClose }) {
    this.ctx = ctx;
    this.tree = tree;
    this.onClose = onClose;
    this.container = new PIXI.Container();
    this._choiceHitboxes = [];
  }

  enter(ctx) {
    this.node = ctx.dialogue.start(this.tree, () => this._close());
    this._layout(ctx.runtime.size());
    this._bindKeys();
  }

  _bindKeys() {
    this._keyHandler = (e) => {
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1) this._choose(n - 1);
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _layout({ width, height }) {
    this.container.removeChildren();
    this._choiceHitboxes = [];
    if (!this.node) return;

    const panelH = Math.min(260, height * 0.42);
    const py = height - panelH - 16;
    const pw = Math.min(720, width - 32);
    const px = (width - pw) / 2;

    const scrim = new PIXI.Graphics();
    scrim.rect(0, 0, width, height).fill({ color: 0x030712, alpha: 0.35 });
    this.container.addChild(scrim);

    const panel = new PIXI.Graphics();
    panel.roundRect(px, py, pw, panelH, 14)
      .fill({ color: 0x050c18, alpha: 0.97 })
      .stroke({ width: 1, color: 0x67e8f9, alpha: 0.4 });
    this.container.addChild(panel);

    // Portrait
    const portrait = new PIXI.Sprite(this.ctx.assets.get(this.node.portrait || 'npc'));
    portrait.anchor.set(0.5);
    portrait.width = 56;
    portrait.height = 60;
    portrait.position.set(px + 46, py + 52);
    this.container.addChild(portrait);

    const speaker = text(this.node.speaker, { fill: 0xfbbf24, fontSize: 14, fontWeight: '800' });
    speaker.position.set(px + 84, py + 18);
    this.container.addChild(speaker);

    const body = text(this.node.text, {
      fill: 0xe5f4ff, fontSize: 16, wordWrap: true, wordWrapWidth: pw - 108, lineHeight: 23,
    });
    body.position.set(px + 84, py + 42);
    this.container.addChild(body);

    // Choices
    const choices = this.node.choices || [];
    let cy = py + panelH - choices.length * 40 - 12;
    choices.forEach((choice, i) => {
      const bg = new PIXI.Graphics();
      bg.roundRect(px + 20, cy, pw - 40, 34, 8)
        .fill({ color: 0xffffff, alpha: 0.06 })
        .stroke({ width: 1, color: 0x67e8f9, alpha: 0.25 });
      const label = text(`${i + 1}.  ${choice.label}`, { fill: 0xdbeafe, fontSize: 14, fontWeight: '600' });
      label.position.set(px + 34, cy + 8);
      bg.eventMode = 'static';
      bg.cursor = 'pointer';
      bg.on('pointertap', () => this._choose(i));
      this.container.addChild(bg);
      this.container.addChild(label);
      this._choiceHitboxes.push(bg);
      cy += 40;
    });

    if (choices.length === 0) {
      const hint = text('(tap to continue)', { fill: 0x94a3b8, fontSize: 13 });
      hint.position.set(px + 84, py + panelH - 30);
      this.container.addChild(hint);
      this.container.eventMode = 'static';
      this.container.hitArea = new PIXI.Rectangle(0, 0, width, height);
      this.container.once('pointertap', () => this._close());
    }
  }

  _choose(index) {
    if (!this.node) return;
    if (index < 0 || index >= (this.node.choices?.length || 0)) return;
    this.node = this.ctx.dialogue.choose(index);
    if (this.node) this._layout(this.ctx.runtime.size());
    // else: engine's onEnd already called _close()
  }

  update() {
    // Absorb the interact press so it doesn't also hit the room beneath.
    this.ctx.input.consumeInteract();
  }

  _close() {
    if (this._closed) return;
    this._closed = true;
    this.onClose?.();
  }

  resize(w, h) {
    this._layout({ width: w, height: h });
  }

  exit() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
  }
}

function text(str, style) {
  return new PIXI.Text({ text: str, style: { fontFamily: 'Inter, system-ui, sans-serif', ...style } });
}
