/**
 * ArenaScene — the playable arcade round. This is where the arcade genre stops
 * being a word list and becomes a game.
 *
 * Loop (one wave):
 *   - Build a bounded arena: tiled floor + Matter static walls.
 *   - Spawn the player (Matter body, driven by InputController) plus the wave's
 *     GOOD orbs (correct concepts), BAD orbs (decoys, which drift/home), and an
 *     optional POWER orb.
 *   - Collect every GOOD orb before the timer runs out -> wave clear.
 *   - Touching a BAD orb costs integrity (focus) and breaks the score combo;
 *     integrity at 0 -> fail. A POWER orb grants a shield + score multiplier.
 *   - Score, combo, integrity, wave, and per-wave objectives all flow through the
 *     shared StateStore / QuestEngine so the existing HUD renders them unchanged.
 */
import { createPlayer, createOrb, scatter } from '../entity-factory.js';

const PIXI = window.PIXI;
const Matter = window.Matter;
const STEP = 1 / 60;
const WALL = 16;
const HIT_COOLDOWN = 0.9;
const HIT_DAMAGE = 18;
const BASE_SCORE = 100;

export class ArenaScene {
  constructor(ctx, { wave, waveIndex, waveCount, onWaveClear, onFail }) {
    this.ctx = ctx;
    this.wave = wave;
    this.waveIndex = waveIndex;
    this.waveCount = waveCount;
    this.onWaveClear = onWaveClear;
    this.onFail = onFail;

    this.container = new PIXI.Container();
    this.world = new PIXI.Container();
    this.hudLayer = new PIXI.Container();
    this.container.addChild(this.world);
    this.container.addChild(this.hudLayer);

    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    this._acc = 0;

    this.goods = [];
    this.bads = [];
    this.power = null;
    this.player = null;

    this.timeLeft = wave.timeLimit;
    this.hitCooldown = 0;
    this.combo = 0;
    this.scoreMul = 1;
    this._done = false;
  }

  enter(ctx) {
    const size = ctx.runtime.size();
    // Arena fits the viewport (with a comfortable minimum) — no scrolling; the
    // whole field is visible, which is what a collect/avoid game wants.
    this.bounds = {
      x: WALL,
      y: WALL,
      w: Math.max(680, Math.min(size.width, 1280)) - WALL * 2,
      h: Math.max(520, Math.min(size.height, 900)) - WALL * 2,
    };

    this._buildFloor();
    this._buildWalls();
    this._spawn();
    this._registerObjectives();
    this._buildTimerBar(size);
    this._center(size);

    ctx.state.set({
      currentRoom: {
        id: this.wave.id,
        title: `${this.wave.title} — collect ${this.goods.length} concept${this.goods.length === 1 ? '' : 's'}`,
        index: this.waveIndex,
        count: this.waveCount,
        summary: 'Grab the labelled orbs. Dodge the red decoys. Beat the clock.',
      },
      hint: 'Move with WASD / arrows or the joystick. Collect the correct concepts, avoid the red orbs!',
    });
    ctx.state.logEvent(`${this.wave.title}: ${this.goods.length} concepts to collect`);
  }

  _buildFloor() {
    const tex = this.ctx.assets.get('tile-floor');
    const floor = new PIXI.TilingSprite({ texture: tex, width: this.bounds.w + WALL * 2, height: this.bounds.h + WALL * 2 });
    this.world.addChild(floor);
  }

  _buildWalls() {
    const { x, y, w, h } = this.bounds;
    const g = new PIXI.Graphics();
    const segs = [
      [x - WALL, y - WALL, w + WALL * 2, WALL],
      [x - WALL, y + h, w + WALL * 2, WALL],
      [x - WALL, y - WALL, WALL, h + WALL * 2],
      [x + w, y - WALL, WALL, h + WALL * 2],
    ];
    const bodies = [];
    for (const [sx, sy, sw, sh] of segs) {
      g.rect(sx, sy, sw, sh).fill(0x1e293b);
      g.rect(sx, sy, sw, sh).stroke({ width: 2, color: 0x334155 });
      bodies.push(Matter.Bodies.rectangle(sx + sw / 2, sy + sh / 2, sw, sh, { isStatic: true, label: 'wall' }));
    }
    this.world.addChild(g);
    Matter.Composite.add(this.engine.world, bodies);
  }

  _spawn() {
    const start = { x: this.bounds.x + this.bounds.w / 2, y: this.bounds.y + this.bounds.h / 2 };
    this.player = createPlayer(this.ctx, start);
    this.player.addTo(this.world, this.engine.world);

    const goodPos = scatter(this.wave.goods.length, this.bounds, start);
    this.wave.goods.forEach((spec, i) => {
      const orb = createOrb(this.ctx, spec, { ...goodPos[i], kind: 'good', speed: 45 });
      orb.addTo(this.world);
      this.goods.push(orb);
    });

    const badPos = scatter(this.wave.bads.length, this.bounds, start, 160);
    this.wave.bads.forEach((spec, i) => {
      const orb = createOrb(this.ctx, spec, {
        ...badPos[i],
        kind: 'bad',
        speed: this.wave.badSpeed,
        homing: this.wave.badHoming,
      });
      orb.addTo(this.world);
      this.bads.push(orb);
    });

    if (this.wave.power) {
      const [pos] = scatter(1, this.bounds, start, 140);
      this.power = createOrb(this.ctx, this.wave.power, { ...pos, kind: 'power', speed: 30 });
      this.power.addTo(this.world);
    }
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const orb of this.goods) {
      q.register(this.wave.id, {
        id: `${this.wave.id}:${orb.spec.id}`,
        label: `Collect: ${orb.spec.label}`,
        kind: 'collect',
        reward: orb.spec.reward,
      });
    }
  }

  _buildTimerBar(size) {
    this.timer = new PIXI.Container();
    this.timerBg = new PIXI.Graphics();
    this.timerFill = new PIXI.Graphics();
    this.timerText = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xe5f4ff, fontSize: 13, fontWeight: '800' },
    });
    this.timerText.anchor.set(0.5);
    this.comboText = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xfbbf24, fontSize: 15, fontWeight: '900' },
    });
    this.comboText.anchor.set(0.5);
    this.timer.addChild(this.timerBg, this.timerFill, this.timerText, this.comboText);
    this.hudLayer.addChild(this.timer);
    this._layoutTimer(size);
  }

  _layoutTimer({ width }) {
    if (!this.timer) return;
    const bw = Math.min(360, width - 120);
    const bx = (width - bw) / 2;
    const by = 16;
    this.timerBg.clear();
    this.timerBg.roundRect(bx, by, bw, 12, 6).fill({ color: 0x050c18, alpha: 0.85 }).stroke({ width: 1, color: 0x334155 });
    this._timerGeom = { bx, by, bw };
    this.timerText.position.set(width / 2, by + 26);
    this.comboText.position.set(width / 2, by + 48);
  }

  _drawTimer() {
    if (!this._timerGeom) return;
    const { bx, by, bw } = this._timerGeom;
    const frac = Math.max(0, this.timeLeft / this.wave.timeLimit);
    const color = frac < 0.25 ? 0xfb7185 : frac < 0.5 ? 0xfbbf24 : 0x67e8f9;
    this.timerFill.clear();
    this.timerFill.roundRect(bx + 1, by + 1, Math.max(0, (bw - 2) * frac), 10, 5).fill(color);
    const left = this.goods.filter((g) => !g.collected).length;
    this.timerText.text = `⏱ ${Math.ceil(this.timeLeft)}s   ·   ${left} concept${left === 1 ? '' : 's'} left`;
    this.comboText.text = this.combo >= 2 ? `COMBO ×${this.combo}${this.scoreMul > 1 ? '  ·  ⚡ ×2' : ''}` : (this.scoreMul > 1 ? '⚡ POWER ×2' : '');
  }

  update(dt) {
    if (this._done) return;

    // --- Fixed-step physics (player + walls) ---
    this._acc += dt;
    let guard = 0;
    const axis = this.ctx.input.getAxis();
    while (this._acc >= STEP && guard < 5) {
      this.player.drive(axis);
      Matter.Engine.update(this.engine, STEP * 1000);
      this._acc -= STEP;
      guard++;
    }
    this.player.sync(dt);
    const ppos = this.player.position;

    // --- Orb motion ---
    for (const g of this.goods) g.update(dt, this.bounds, ppos);
    for (const b of this.bads) b.update(dt, this.bounds, ppos);
    this.power?.update(dt, this.bounds, ppos);

    // --- Collect GOOD orbs ---
    for (const g of this.goods) {
      if (!g.collected && g.isNear(ppos)) {
        g.collect();
        this.combo += 1;
        const mult = Math.min(5, 1 + Math.floor(this.combo / 3)); // combo bonus, capped
        const gain = Math.round((g.spec.reward?.xp || BASE_SCORE) * mult * this.scoreMul);
        this.ctx.state.addXp(gain);
        if (g.spec.reward?.currency) this.ctx.state.addCurrency(g.spec.reward.currency);
        this.ctx.state.addKey(`${this.wave.id}:${g.spec.id}`, { id: g.spec.id, label: g.spec.label, icon: 'orb-good' });
        this.ctx.quests.complete(`${this.wave.id}:${g.spec.id}`);
        this.ctx.state.logEvent(`✓ ${g.spec.label} (+${gain})`);
      }
    }

    // --- Power orb ---
    if (this.power && !this.power.collected && this.power.isNear(ppos)) {
      this.power.collect();
      this.player.grantShield(6);
      this.scoreMul = 2;
      this._powerT = 6;
      this.ctx.state.set({ hint: '⚡ Power-up! Shield + double score for a few seconds.' });
      this.ctx.state.logEvent('⚡ Power-up collected');
    }
    if (this._powerT > 0) {
      this._powerT -= dt;
      if (this._powerT <= 0) this.scoreMul = 1;
    }

    // --- BAD orb contact ---
    if (this.hitCooldown > 0) this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (this.hitCooldown === 0 && !this.player.shielded) {
      for (const b of this.bads) {
        if (b.touches(ppos)) {
          this.hitCooldown = HIT_COOLDOWN;
          this.combo = 0;
          this.player.flash();
          this.ctx.state.damageFocus(HIT_DAMAGE);
          this.ctx.audio?.play('failure');
          this.ctx.state.set({ hint: `⚠ ${b.spec.description || 'Wrong concept! Integrity down.'}` });
          this.ctx.state.logEvent(`⚠ Hit a decoy (−${HIT_DAMAGE} integrity)`);
          break;
        }
      }
    }

    // --- Timer + HUD overlay ---
    this.timeLeft -= dt;
    this._drawTimer();

    // --- Win / fail resolution ---
    const remaining = this.goods.filter((g) => !g.collected).length;
    if (remaining === 0) {
      this._finish(true);
    } else if (this.ctx.state.get('focus') <= 0) {
      this.ctx.state.set({ hint: 'Integrity depleted!' });
      this._finish(false);
    } else if (this.timeLeft <= 0) {
      this.ctx.state.set({ hint: "Time's up!" });
      this._finish(false);
    }
  }

  _finish(win) {
    if (this._done) return;
    this._done = true;
    if (win) {
      this.ctx.state.clearRoom(this.wave.id);
      this.ctx.audio?.play('reward');
      // Time bonus rewards fast, clean clears.
      const bonus = Math.round(this.timeLeft * 5);
      if (bonus > 0) {
        this.ctx.state.addXp(bonus);
        this.ctx.state.logEvent(`Wave clear! Time bonus +${bonus}`);
      }
      this.onWaveClear?.();
    } else {
      this.onFail?.();
    }
  }

  _center(size) {
    this.world.x = (size.width - (this.bounds.w + WALL * 2)) / 2;
    this.world.y = (size.height - (this.bounds.h + WALL * 2)) / 2;
  }

  resize(w, h) {
    this._center({ width: w, height: h });
    this._layoutTimer({ width: w });
  }

  exit() {
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }
}
