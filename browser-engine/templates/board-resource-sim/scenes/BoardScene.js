/**
 * BoardScene (board-resource-sim) — the playable board.
 *
 * Draws a ring of space tiles (concept / event / hazard / START) with a
 * connecting track, a player Token, and a centered die. A DOM control bar hosts
 * the ROLL button (E / Space also roll). Each turn:
 *   - roll a d6 (with a short flicker animation),
 *   - hop the token that many spaces, resolving every concept/START square it
 *     passes and the final square it lands on (hazards/events fire on landing),
 *   - apply resource changes (knowledge/coins/energy) through the model and mirror
 *     them into the shared StateStore so the HUD updates,
 *   - complete a concept objective per square collected; when every concept is
 *     collected, report completion.
 *
 * Reuses HUD keys: xp→Knowledge, level→lap, keys→concepts collected, focus→energy.
 */
import { layoutRing } from '../entity-factory.js';
import { Token } from '../prefabs/Token.js';

const PIXI = window.PIXI;

const TYPE_COLOR = { start: 0x67e8f9, concept: 0x34d399, hazard: 0xfb7185, event: 0xa78bfa };
const TYPE_GLYPH = { start: '★', concept: '◆', hazard: '⚠', event: '✦' };
const TILE = 46;
const ROLL_FLICKER = 0.45;
const MAX_W = 1000;
const MAX_H = 600;
const SIDE_MIN = 40; // minimum screen-edge margin
const GAP_PAD = 24; // clearance kept between the board region and any HUD panel
const TILE_PAD = 32; // extra inset so a tile's own radius/label never pokes past the region
const BOTTOM_BAND = 140; // reserved for the roll control bar (mounted after layout)
const MIN_BESIDE_W = 460; // if the central gap is narrower than this, drop below the top panels

export class BoardScene {
  constructor(ctx, { model, title, onComplete }) {
    this.ctx = ctx;
    this.model = model;
    this.title = title;
    this.onComplete = onComplete;

    this.container = new PIXI.Container();
    this.board = new PIXI.Container();
    this.container.addChild(this.board);

    this.tiles = [];
    this.token = null;
    this._rolling = 0;
    this._flickerAcc = 0;
    this._pendingRoll = 0;
    this._stepsLeft = 0;
    this._completed = false;
    this._busy = false; // true while rolling or moving
  }

  /**
   * Absolute viewport rect for the ring. Measures the live HUD panel rects and
   * fits the board into the free central region so ring tiles never sit under the
   * HUD — regardless of how tall the objectives panel grows. Falls back to a
   * below-the-panels, full-width layout when the central gap is too narrow.
   */
  _computeBounds(size) {
    const W = size.width;
    const H = size.height;
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width ? r : null;
    };
    const tl = rectOf('.oe-tl'); // stats (top-left)
    const tr = rectOf('.oe-tr'); // objectives (top-right)
    const bl = rectOf('.oe-bl'); // log (bottom-left)

    let left = SIDE_MIN;
    let right = W - SIDE_MIN;
    const leftPanels = Math.max(tl ? tl.right : 0, bl ? bl.right : 0);
    if (leftPanels) left = Math.max(left, leftPanels + GAP_PAD);
    if (tr) right = Math.min(right, tr.left - GAP_PAD);

    let top = 120;
    let bottom = H - BOTTOM_BAND;

    // Central gap too tight to sit beside the side panels → go below them, full width.
    if (right - left < MIN_BESIDE_W) {
      left = SIDE_MIN;
      right = W - SIDE_MIN;
      const panelsBottom = Math.max(tl ? tl.bottom : 0, tr ? tr.bottom : 0);
      top = Math.max(top, panelsBottom + GAP_PAD);
    }

    // Inset by a tile's footprint so nothing pokes past the region edges.
    left += TILE_PAD;
    right -= TILE_PAD;
    top += TILE_PAD;
    bottom -= TILE_PAD;

    // Apply gentle minimums, but never exceed the free region (short windows win
    // by staying inside the region rather than overflowing onto the HUD).
    const regionW = Math.max(1, right - left);
    const regionH = Math.max(1, bottom - top);
    const w = Math.min(Math.max(Math.min(regionW, MAX_W), 420), regionW);
    const h = Math.min(Math.max(Math.min(regionH, MAX_H), 220), regionH);
    const x = left + (regionW - w) / 2;
    const y = top + (regionH - h) / 2;
    return { x, y, w, h };
  }

  enter(ctx) {
    const size = ctx.runtime.size();
    this.bounds = this._computeBounds(size);
    this._positions = layoutRing(this.model.spaces.length, this.bounds);

    this._drawTrack();
    this._buildTiles();
    this._buildDie();
    this._buildInstruction();

    this.token = new Token(ctx, this._positions[0]);
    this.token.addTo(this.board);

    this._registerObjectives();

    ctx.state.set({
      currentRoom: { id: 'board', title: this.title, index: 0, count: 1, summary: 'Roll the die, lap the board, and collect every concept square. Hazards cost energy; passing START refuels you.' },
      hint: 'Press ROLL (or E / Space) to roll the die and move.',
    });
    ctx.state.logEvent('The board is set — roll to begin.');

    injectStyles();
    this._mountDom();
    this._bridgeState();
    this._drawDie(1);
  }

  // ---- Board build ----------------------------------------------------------

  _drawTrack() {
    this.trackG = new PIXI.Graphics();
    this.board.addChildAt(this.trackG, 0);
    this._paintTrack();
  }

  _paintTrack() {
    const g = this.trackG;
    const p = this._positions;
    g.clear();
    g.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) g.lineTo(p[i].x, p[i].y);
    g.lineTo(p[0].x, p[0].y);
    g.stroke({ width: 6, color: 0x1e293b, alpha: 0.9 });
  }

  _buildTiles() {
    this.model.spaces.forEach((space, i) => {
      const pos = this._positions[i];
      const c = new PIXI.Container();
      c.x = pos.x;
      c.y = pos.y;
      const color = TYPE_COLOR[space.type] || 0x64748b;

      const rect = new PIXI.Graphics();
      rect.roundRect(-TILE / 2, -TILE / 2, TILE, TILE, 9).fill({ color: 0x0b1220 }).stroke({ width: 2, color });
      c.addChild(rect);

      const glyph = new PIXI.Text({ text: TYPE_GLYPH[space.type] || '•', style: { fontFamily: 'Inter, system-ui, sans-serif', fill: color, fontSize: 18, fontWeight: '900' } });
      glyph.anchor.set(0.5);
      glyph.y = -4;
      c.addChild(glyph);

      const num = new PIXI.Text({ text: space.type === 'start' ? 'GO' : String(i), style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0x94a3b8, fontSize: 9, fontWeight: '700' } });
      num.anchor.set(0.5);
      num.y = 14;
      c.addChild(num);

      this.board.addChild(c);
      this.tiles.push({ space, container: c, rect, glyph, color, flash: 0 });
    });
  }

  _buildDie() {
    this.die = new PIXI.Container();
    this.die.x = this.bounds.x + this.bounds.w / 2;
    this.die.y = this.bounds.y + this.bounds.h / 2;
    this.dieG = new PIXI.Graphics();
    this.die.addChild(this.dieG);
    this.board.addChild(this.die);
  }

  _buildInstruction() {
    this.centerLabel = new PIXI.Text({ text: 'ROLL TO MOVE', style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0x64748b, fontSize: 12, fontWeight: '800', letterSpacing: 2 } });
    this.centerLabel.anchor.set(0.5);
    this.centerLabel.x = this.bounds.x + this.bounds.w / 2;
    this.centerLabel.y = this.bounds.y + this.bounds.h / 2 + 52;
    this.board.addChild(this.centerLabel);
  }

  _drawDie(n) {
    const s = 64;
    const g = this.dieG;
    g.clear();
    g.roundRect(-s / 2, -s / 2, s, s, 12).fill(0xf8fafc).stroke({ width: 2, color: 0x0f172a });
    const o = 15;
    const pip = (px, py) => g.circle(px, py, 5).fill(0x0f172a);
    const P = {
      1: [[0, 0]],
      2: [[-o, -o], [o, o]],
      3: [[-o, -o], [0, 0], [o, o]],
      4: [[-o, -o], [o, -o], [-o, o], [o, o]],
      5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
      6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
    };
    for (const [px, py] of P[n] || P[1]) pip(px, py);
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const space of this.model.spaces) {
      if (space.type === 'concept') {
        q.register('board', { id: space.id, label: `Collect: ${space.label}`, kind: 'collect', reward: { xp: 0 } });
      }
    }
  }

  // ---- DOM control bar ------------------------------------------------------

  _mountDom() {
    const root = document.createElement('div');
    root.className = 'ob-root';
    root.innerHTML = `
      <div class="ob-bar">
        <button id="ob-roll" class="ob-roll">🎲 ROLL</button>
        <div class="ob-res">
          <span>Coins <b id="ob-coins">0</b></span>
          <span>Energy <b id="ob-energy">100</b></span>
          <span>Turns <b id="ob-turns">0</b></span>
        </div>
        <div class="ob-event" id="ob-event">Roll to move around the board.</div>
      </div>`;
    document.body.appendChild(root);
    this.dom = root;
    this.rollBtn = root.querySelector('#ob-roll');
    this.coinsEl = root.querySelector('#ob-coins');
    this.energyEl = root.querySelector('#ob-energy');
    this.turnsEl = root.querySelector('#ob-turns');
    this.eventEl = root.querySelector('#ob-event');
    this.rollBtn.addEventListener('click', () => this._startRoll());
  }

  // ---- Turn flow ------------------------------------------------------------

  _startRoll() {
    if (this._busy || this._completed) return;
    this._busy = true;
    this._pendingRoll = this.model.rollDie();
    this._rolling = ROLL_FLICKER;
    this._flickerAcc = 0;
    this.rollBtn.disabled = true;
    this.ctx.state.set({ hint: '' });
    this.centerLabel.text = 'ROLLING…';
  }

  _beginMove() {
    this._stepsLeft = this._pendingRoll;
    this.eventEl.textContent = `Rolled a ${this._pendingRoll} — moving ${this._pendingRoll} space${this._pendingRoll === 1 ? '' : 's'}.`;
    this.centerLabel.text = `MOVING ${this._pendingRoll}`;
    this._nextHop();
  }

  _nextHop() {
    this.model.pos = (this.model.pos + 1) % this.model.spaces.length;
    this.token.hopTo(this._positions[this.model.pos]);
  }

  _onArrive() {
    this._stepsLeft -= 1;
    const isLanding = this._stepsLeft <= 0;
    const space = this.model.spaces[this.model.pos];
    const effect = this.model.resolve(space, isLanding);
    if (effect) this._applyEffect(space, effect);
    if (isLanding) this._endTurn(space, effect);
    else this._nextHop();
  }

  _applyEffect(space, effect) {
    const tile = this.tiles[this.model.pos];
    tile.flash = 0.5;
    if (effect.kind === 'concept') {
      this.ctx.state.addKey(space.id, { id: space.id, label: space.label, icon: 'objective' });
      this.ctx.quests.complete(space.id);
      tile.glyph.text = '✓';
      tile.glyph.style.fill = 0x34d399;
      tile.rect.tint = 0x334155;
      this.ctx.audio?.play('pickup');
    } else if (effect.kind === 'hazard') {
      this.ctx.audio?.play('failure');
    } else if (effect.kind === 'start') {
      this.ctx.audio?.play('unlock');
    } else if (effect.kind === 'event') {
      this.ctx.audio?.play('talk');
    }
    this.eventEl.textContent = effect.text;
    this.ctx.state.logEvent(effect.text);
    this._bridgeState();
  }

  _endTurn(space, effect) {
    this._busy = false;
    this.rollBtn.disabled = false;
    this.centerLabel.text = 'ROLL TO MOVE';
    if (!effect) {
      this.eventEl.textContent = `Landed on ${space.label}.`;
    }
    this._bridgeState();
    if (this.model.allConceptsCollected() && !this._completed) {
      this._completed = true;
      this.rollBtn.disabled = true;
      this.ctx.state.set({ hint: 'Every concept collected — board complete!' });
      this.onComplete?.();
    }
  }

  _bridgeState() {
    const m = this.model;
    this.ctx.state.set({ xp: m.knowledge, currency: m.coins, focus: Math.round(m.energy), level: m.laps + 1 });
    if (this.dom) {
      this.coinsEl.textContent = m.coins;
      this.energyEl.textContent = Math.round(m.energy);
      this.turnsEl.textContent = m.turns;
    }
  }

  // ---- Frame ----------------------------------------------------------------

  update(dt) {
    // Interact key rolls too.
    if (this.ctx.input.consumeInteract()) this._startRoll();

    // Die flicker.
    if (this._rolling > 0) {
      this._rolling -= dt;
      this._flickerAcc += dt;
      if (this._flickerAcc >= 0.05) {
        this._flickerAcc = 0;
        this._drawDie(1 + Math.floor(Math.random() * 6));
        this.die.rotation = (Math.random() - 0.5) * 0.4;
      }
      if (this._rolling <= 0) {
        this.die.rotation = 0;
        this._drawDie(this._pendingRoll);
        this._beginMove();
      }
    }

    // Token movement + arrival resolution.
    if (this.token) {
      const wasMoving = this.token.moving;
      this.token.update(dt);
      if (wasMoving && this.token.arrived) {
        this.token.arrived = false;
        this._onArrive();
      }
    }

    // Tile flashes.
    for (const t of this.tiles) {
      if (t.flash > 0) {
        t.flash = Math.max(0, t.flash - dt);
        t.container.scale.set(1 + t.flash * 0.35);
      } else if (t.container.scale.x !== 1) {
        t.container.scale.set(1);
      }
    }
  }

  /** Recompute the ring for a new viewport and move everything into place. */
  _relayout(size) {
    this.bounds = this._computeBounds(size);
    this._positions = layoutRing(this.model.spaces.length, this.bounds);
    this._paintTrack();
    this.tiles.forEach((t, i) => {
      t.container.x = this._positions[i].x;
      t.container.y = this._positions[i].y;
    });
    const cx = this.bounds.x + this.bounds.w / 2;
    const cy = this.bounds.y + this.bounds.h / 2;
    if (this.die) this.die.position.set(cx, cy);
    if (this.centerLabel) this.centerLabel.position.set(cx, cy + 52);
    if (this.token) this.token.setSpace(this._positions[this.model.pos]);
  }

  resize(w, h) {
    this._relayout({ width: w, height: h });
  }

  exit() {
    if (this.dom) {
      this.dom.remove();
      this.dom = null;
    }
  }
}

function injectStyles() {
  if (document.getElementById('ob-board-styles')) return;
  const style = document.createElement('style');
  style.id = 'ob-board-styles';
  style.textContent = `
  .ob-root { position: fixed; left: 0; right: 0; bottom: 18px; z-index: 26; display: flex; justify-content: center; pointer-events: none; font-family: Inter, system-ui, -apple-system, sans-serif; }
  .ob-bar { pointer-events: auto; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; max-width: min(720px, 94vw); border: 1px solid rgba(103,232,249,.25); background: rgba(5,12,24,.92); border-radius: 12px; padding: 10px 14px; box-shadow: 0 16px 60px rgba(0,0,0,.5); backdrop-filter: blur(10px); color: #e5f4ff; }
  .ob-roll { pointer-events: auto; padding: 12px 22px; border: 0; border-radius: 10px; font-size: 15px; font-weight: 900; letter-spacing: .04em; color: #03131d; background: linear-gradient(90deg, #67e8f9, #34d399); cursor: pointer; transition: transform .06s ease, filter .1s ease; }
  .ob-roll:not(:disabled):hover { filter: brightness(1.08); }
  .ob-roll:not(:disabled):active { transform: translateY(1px); }
  .ob-roll:disabled { opacity: .5; cursor: not-allowed; }
  .ob-res { display: flex; gap: 14px; font-size: 12px; color: #94a3b8; font-weight: 600; }
  .ob-res b { color: #fff; margin-left: 4px; font-size: 14px; }
  .ob-event { flex-basis: 100%; text-align: center; font-size: 13px; color: #cbd5e1; padding-top: 2px; border-top: 1px solid rgba(255,255,255,.08); margin-top: 2px; }
  @media (max-width: 640px) { .ob-res { gap: 10px; } }
  @media (prefers-reduced-motion: reduce) { .ob-roll { transition: none; } }
  `;
  document.head.appendChild(style);
}
