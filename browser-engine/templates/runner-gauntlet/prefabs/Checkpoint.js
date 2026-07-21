/**
 * Checkpoint (runner-gauntlet) — a milestone from the source content, standing
 * on the course as a banked save point.
 *
 * Passing one banks the run: a later collision restarts here rather than at the
 * beginning, which is what makes a long piece of content survivable in a genre
 * where one mistake normally ends everything. The milestone's text is announced
 * as the player crosses it.
 */
const PIXI = window.PIXI;

const LABEL_STYLE = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 12,
  fontWeight: '900',
  fill: 0x67e8f9,
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 190,
};

export class Checkpoint {
  constructor(ctx, spec, { x = 0, groundY = 0, index = 0, isFinal = false } = {}) {
    this.ctx = ctx;
    this.spec = spec;
    this.courseX = x;
    this.index = index;
    this.isFinal = isFinal;
    this.reached = false;
    this.width = 96;

    this.container = new PIXI.Container();
    this.container.y = groundY;

    // Platform slab the flag stands on.
    this.platform = new PIXI.Sprite(ctx.assets.get('platform'));
    this.platform.anchor.set(0.5, 0);
    this.platform.width = this.width;
    this.platform.height = 18;
    this.container.addChild(this.platform);

    // Light column, so a checkpoint is visible well before it arrives.
    this.beam = new PIXI.Graphics();
    this.beam.rect(-5, -230, 10, 230).fill({ color: 0x67e8f9, alpha: 0.14 });
    this.container.addChild(this.beam);

    this.flag = new PIXI.Graphics();
    this._drawFlag(false);
    this.container.addChild(this.flag);

    this.label = new PIXI.Text({
      text: isFinal ? `🏁 ${shorten(spec.label, 34)}` : shorten(spec.label, 34),
      style: LABEL_STYLE,
    });
    this.label.anchor.set(0.5, 1);
    this.label.y = -104;
    this.container.addChild(this.label);

    this._t = Math.random() * Math.PI * 2;
  }

  addTo(container) {
    container.addChild(this.container);
  }

  _drawFlag(reached) {
    const color = reached ? 0x34d399 : 0x67e8f9;
    this.flag.clear();
    this.flag.rect(-2, -100, 4, 100).fill(color);
    this.flag.poly([2, -100, 40, -88, 2, -76]).fill({ color, alpha: reached ? 1 : 0.55 });
  }

  screenX(scrollX) {
    return this.courseX - scrollX;
  }

  markReached() {
    if (this.reached) return false;
    this.reached = true;
    this._drawFlag(true);
    this.label.style.fill = 0x34d399;
    this.beam.clear();
    this.beam.rect(-5, -230, 10, 230).fill({ color: 0x34d399, alpha: 0.2 });
    this.ctx.audio?.play('unlock');
    return true;
  }

  update(dt, scrollX) {
    this._t += dt;
    this.container.x = this.courseX - scrollX;
    this.beam.alpha = 0.6 + Math.sin(this._t * 3) * 0.4;
    // Flag ripple.
    this.flag.skew.y = Math.sin(this._t * 4) * 0.04;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function shorten(text, max = 30) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
