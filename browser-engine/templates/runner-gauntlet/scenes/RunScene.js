/**
 * RunScene — the whole of the runner genre: one continuous course, scrolling.
 *
 * The runner's screen x is fixed; the world scrolls past at the current pace, so
 * `scrollX` is the run's real distance. Everything on the course positions
 * itself from `courseX - scrollX` each frame.
 *
 * Loop:
 *   - Auto-run right. Jump (E / Space / tap) to clear obstacles; a second press
 *     mid-air double-jumps. Holding jump extends the rise.
 *   - Tokens are facts — collect them for score and combo.
 *   - Obstacles are hazards — a hit costs integrity, breaks the combo, and shows
 *     the hazard's explanation. Three hits (or integrity out) ends the run.
 *   - Checkpoints are milestones — crossing one banks progress, so a later hit
 *     resumes there instead of restarting the whole course.
 *   - Reaching the final checkpoint completes the run.
 *
 * Score, integrity, and per-stage objectives flow through the shared StateStore
 * and QuestEngine, so the existing HUD renders them unchanged.
 */
import { createRunner, createObstacle, createToken, createCheckpoint, paceAt } from '../entity-factory.js';

const PIXI = window.PIXI;

const RUNNER_SCREEN_X = 170;
const HIT_DAMAGE = 22;
const MAX_HITS = 3;
const TOKEN_SCORE = 90;

export class RunScene {
  constructor(ctx, { course, onComplete, onFail }) {
    this.ctx = ctx;
    this.course = course;
    this.onComplete = onComplete;
    this.onFail = onFail;

    this.container = new PIXI.Container();
    this.bgFar = new PIXI.Container();
    this.bgNear = new PIXI.Container();
    this.world = new PIXI.Container();
    this.hudLayer = new PIXI.Container();
    this.container.addChild(this.bgFar, this.bgNear, this.world, this.hudLayer);

    this.scrollX = 0;
    this.checkpointX = 0;   // banked restart position
    this.hits = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.tokensCollected = 0;
    this.stagesCleared = 0;
    this.elapsed = 0;
    this._done = false;
    this._jumpWasDown = false;

    this.obstacles = [];
    this.tokens = [];
    this.checkpoints = [];
  }

  enter(ctx) {
    const size = ctx.runtime.size();
    this.groundY = Math.round(size.height * 0.74);

    this._buildBackdrop(size);
    this._spawn();
    this._registerObjectives();
    this._buildHud(size);

    ctx.state.set({
      currentRoom: {
        id: 'course',
        title: `${this.course.title} — ${this.course.stages.length} stage${this.course.stages.length === 1 ? '' : 's'}`,
        index: 0,
        count: 1,
        summary: 'Jump the setbacks, grab the facts, reach every checkpoint.',
      },
      hint: 'Press E / Space / tap to jump · press again mid-air to double-jump.',
    });
    ctx.state.logEvent(`Course: ${this.course.tokenCount} facts, ${this.course.obstacleCount} setbacks`);
  }

  // ---- Course construction --------------------------------------------------

  _buildBackdrop({ width, height }) {
    this.bgFar.removeChildren();
    this.bgNear.removeChildren();

    const sky = new PIXI.Graphics();
    sky.rect(0, 0, width, height).fill(0x050c18);
    sky.rect(0, this.groundY, width, height - this.groundY).fill(0x0b1220);
    sky.rect(0, this.groundY - 2, width, 4).fill({ color: 0x67e8f9, alpha: 0.3 });
    this.bgFar.addChild(sky);

    // Two parallax bands of "city" bars — depth without any art assets.
    this.parallaxFar = new PIXI.Graphics();
    this.parallaxNear = new PIXI.Graphics();
    this.bgFar.addChild(this.parallaxFar);
    this.bgNear.addChild(this.parallaxNear);
    this._drawParallax(width);

    // Ground strip scrolls with the course so speed is legible.
    this.groundStrip = new PIXI.TilingSprite({
      texture: this.ctx.assets.get('tile-floor'),
      width,
      height: height - this.groundY,
    });
    this.groundStrip.y = this.groundY;
    this.bgNear.addChild(this.groundStrip);
  }

  _drawParallax(width) {
    const drawBand = (g, count, hMin, hMax, color, alpha, spacing) => {
      g.clear();
      for (let i = 0; i < count; i++) {
        const x = i * spacing;
        // Deterministic pseudo-random heights: stable across redraws.
        const h = hMin + ((i * 73) % (hMax - hMin));
        g.rect(x, this.groundY - h, spacing * 0.62, h).fill({ color, alpha });
      }
    };
    const span = Math.ceil((width * 2) / 90) + 2;
    drawBand(this.parallaxFar, span, 60, 190, 0x14223a, 0.9, 90);
    drawBand(this.parallaxNear, span, 30, 110, 0x1c2f4d, 0.9, 130);
  }

  _spawn() {
    for (const item of this.course.items) {
      if (item.kind === 'obstacle') {
        const o = createObstacle(this.ctx, item.spec, {
          x: item.x, groundY: this.groundY, height: item.height,
        });
        o.addTo(this.world);
        this.obstacles.push(o);
      } else if (item.kind === 'token') {
        const t = createToken(this.ctx, item.spec, {
          x: item.x, y: item.y, groundY: this.groundY,
        });
        t.addTo(this.world);
        this.tokens.push(t);
      } else if (item.kind === 'checkpoint') {
        const c = createCheckpoint(this.ctx, item.spec, {
          x: item.x, groundY: this.groundY, index: item.index, isFinal: item.isFinal,
        });
        c.addTo(this.world);
        this.checkpoints.push(c);
      }
    }

    this.runner = createRunner(this.ctx, { x: RUNNER_SCREEN_X, groundY: this.groundY });
    this.runner.addTo(this.world);
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const c of this.checkpoints) {
      q.register('course', {
        id: `checkpoint:${c.spec.id}`,
        label: `Reach: ${c.spec.label}`,
        kind: 'checkpoint',
        reward: c.spec.reward,
      });
    }
    for (const t of this.tokens) {
      q.register('course', {
        id: `token:${t.spec.id}:${Math.round(t.courseX)}`,
        label: `Collect: ${t.spec.label}`,
        kind: 'collect',
        reward: t.spec.reward,
        optional: true,
      });
    }
  }

  // ---- HUD ------------------------------------------------------------------

  _buildHud({ width, height }) {
    this.hudLayer.removeChildren();

    this.readout = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xe5f4ff, fontSize: 14, fontWeight: '900' },
    });
    this.readout.anchor.set(0.5, 0);
    this.hudLayer.addChild(this.readout);

    this.comboText = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xfbbf24, fontSize: 15, fontWeight: '900' },
    });
    this.comboText.anchor.set(0.5, 0);
    this.hudLayer.addChild(this.comboText);

    // Course progress bar with checkpoint ticks — the run at a glance.
    this.progress = new PIXI.Graphics();
    this.hudLayer.addChild(this.progress);

    this.hearts = new PIXI.Graphics();
    this.hudLayer.addChild(this.hearts);

    this._layoutHud({ width, height });
  }

  _layoutHud({ width, height }) {
    this.readout?.position.set(width / 2, 14);
    this.comboText?.position.set(width / 2, 36);
    this._hudGeom = {
      width,
      height,
      bar: { x: width / 2 - 170, y: 62, w: 340, h: 7 },
      hearts: { x: width / 2 - 34, y: 78 },
    };
  }

  _drawProgress() {
    if (!this._hudGeom) return;
    const { x, y, w, h } = this._hudGeom.bar;
    const frac = Math.max(0, Math.min(1, this.scrollX / this.course.length));

    this.progress.clear();
    this.progress.roundRect(x, y, w, h, 4)
      .fill({ color: 0x050c18, alpha: 0.85 })
      .stroke({ width: 1, color: 0x334155 });
    this.progress.roundRect(x + 1, y + 1, Math.max(0, (w - 2) * frac), h - 2, 3).fill(0x67e8f9);

    for (const c of this.checkpoints) {
      const t = Math.max(0, Math.min(1, c.courseX / this.course.length));
      this.progress.rect(x + t * w - 1, y - 3, 2, h + 6)
        .fill(c.reached ? 0x34d399 : 0x64748b);
    }
  }

  _drawHearts() {
    if (!this._hudGeom) return;
    const { x, y } = this._hudGeom.hearts;
    this.hearts.clear();
    for (let i = 0; i < MAX_HITS; i++) {
      const hx = x + i * 24;
      const alive = i < MAX_HITS - this.hits;
      this.hearts.circle(hx, y, 6).fill(alive ? 0xfb7185 : 0x334155);
    }
  }

  // ---- Frame ----------------------------------------------------------------

  update(dt) {
    if (this._done) return;
    this.elapsed += dt;

    // --- Jump input: edge-triggered press, plus a held state for jump height ---
    const jumpHeld = this.ctx.input.keys.has('e')
      || this.ctx.input.keys.has(' ')
      || this.ctx.input.keys.has('arrowup')
      || this.ctx.input.keys.has('w');
    if (this.ctx.input.consumeInteract()) this.runner.jump();
    // Keyboard hold: fire on the rising edge only, so holding doesn't spam jumps.
    if (jumpHeld && !this._jumpWasDown) this.runner.jump();
    this._jumpWasDown = jumpHeld;

    this.runner.update(dt, { jumpHeld });

    // --- Scroll the world at the current pace ---
    const pace = paceAt(this.scrollX);
    this.scrollX += pace * dt;

    // --- Parallax + ground ---
    this.parallaxFar.x = -(this.scrollX * 0.18) % 90 - 90;
    this.parallaxNear.x = -(this.scrollX * 0.42) % 130 - 130;
    if (this.groundStrip) this.groundStrip.tilePosition.x = -this.scrollX;

    // --- Course actors ---
    for (const o of this.obstacles) o.update(dt, this.scrollX);
    for (const t of this.tokens) t.update(dt, this.scrollX);
    for (const c of this.checkpoints) c.update(dt, this.scrollX);

    // --- Collisions ---
    const rb = this.runner.bounds;
    this._checkTokens(rb);
    this._checkObstacles(rb);
    this._checkCheckpoints();

    // --- HUD ---
    this._drawProgress();
    this._drawHearts();
    this._updateReadout(pace);

    // --- Resolution ---
    if (this.hits >= MAX_HITS || this.ctx.state.get('focus') <= 0) {
      this.ctx.state.set({ hint: 'Run ended — too many setbacks.' });
      this._finish(false);
    }
  }

  _checkTokens(rb) {
    for (const t of this.tokens) {
      if (t.collected) continue;
      if (!overlaps(rb, t.boundsAt(this.scrollX))) continue;

      t.collect();
      this.tokensCollected++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const mult = Math.min(5, 1 + Math.floor(this.combo / 4));
      const gain = Math.round((t.spec.reward?.xp || TOKEN_SCORE) * mult);
      this.ctx.state.addXp(gain);
      if (t.spec.reward?.currency) this.ctx.state.addCurrency(t.spec.reward.currency);
      this.ctx.quests.complete(`token:${t.spec.id}:${Math.round(t.courseX)}`);
      this.ctx.state.set({ hint: t.spec.description || t.spec.label });
    }
  }

  _checkObstacles(rb) {
    for (const o of this.obstacles) {
      const ob = o.boundsAt(this.scrollX);

      // Cleared: the obstacle has passed fully behind the runner untouched.
      if (!o.struck && !o.cleared && ob.right < rb.left) {
        if (o.markCleared()) {
          this.ctx.state.addXp(30);
          this.combo++;
          this.bestCombo = Math.max(this.bestCombo, this.combo);
        }
        continue;
      }

      if (o.struck || !overlaps(rb, ob)) continue;
      if (!this.runner.hit()) continue;

      o.markStruck();
      this.hits++;
      this.combo = 0;
      this.ctx.state.damageFocus(HIT_DAMAGE);
      this.ctx.state.set({ hint: `⚠ ${o.spec.description || o.spec.label}` });
      this.ctx.state.logEvent(`⚠ ${o.spec.label} (−${HIT_DAMAGE})`);

      // Knock the run back to the last banked checkpoint rather than ending it.
      if (this.hits < MAX_HITS && this.checkpointX > 0) {
        this.scrollX = this.checkpointX;
        this.ctx.state.logEvent('↩ Resumed from last checkpoint');
      }
    }
  }

  _checkCheckpoints() {
    for (const c of this.checkpoints) {
      if (c.reached) continue;
      if (c.screenX(this.scrollX) > RUNNER_SCREEN_X) continue;

      c.markReached();
      this.stagesCleared++;
      this.checkpointX = c.courseX;
      this.ctx.quests.complete(`checkpoint:${c.spec.id}`);
      const gain = c.spec.reward?.xp || 150;
      this.ctx.state.addXp(gain);
      if (c.spec.reward?.currency) this.ctx.state.addCurrency(c.spec.reward.currency);
      this.ctx.state.addKey(`checkpoint:${c.spec.id}`, {
        id: c.spec.id, label: c.spec.label, icon: 'platform',
      });
      this.ctx.state.set({ hint: `🏁 ${c.spec.description || c.spec.label}` });
      this.ctx.state.logEvent(`🏁 ${c.spec.label} (+${gain})`);

      if (c.isFinal) this._finish(true);
    }
  }

  _updateReadout(pace) {
    if (!this.readout) return;
    const metres = Math.round(this.scrollX / 10);
    this.readout.text = `${metres} m   ·   ${this.tokensCollected}/${this.course.tokenCount} facts   ·   ${this.stagesCleared}/${this.checkpoints.length} checkpoints`;
    this.comboText.text = this.combo >= 3 ? `COMBO ×${this.combo}` : '';
  }

  _finish(win) {
    if (this._done) return;
    this._done = true;

    const stats = {
      distance: Math.round(this.scrollX / 10),
      tokens: this.tokensCollected,
      tokenTotal: this.course.tokenCount,
      checkpoints: this.stagesCleared,
      checkpointTotal: this.checkpoints.length,
      bestCombo: this.bestCombo,
      hits: this.hits,
      elapsed: this.elapsed,
    };

    if (win) {
      this.ctx.state.clearRoom('course');
      this.ctx.audio?.play('reward');
      // Clean-run bonus: finishing untouched is worth chasing on a replay.
      if (this.hits === 0) {
        this.ctx.state.addXp(400);
        this.ctx.state.logEvent('✨ Flawless run bonus +400');
      }
      this.onComplete?.(stats);
    } else {
      this.onFail?.(stats);
    }
  }

  resize(w, h) {
    this.groundY = Math.round(h * 0.74);
    this._buildBackdrop({ width: w, height: h });
    this._layoutHud({ width: w, height: h });

    // Re-seat everything on the new ground line so nothing floats after a
    // rotation or window resize.
    for (const o of this.obstacles) o.container.y = this.groundY;
    for (const c of this.checkpoints) c.container.y = this.groundY;
    for (const t of this.tokens) t.container.y = this.groundY + t.offsetY;
    if (this.runner) {
      this.runner.groundY = this.groundY;
      if (this.runner.grounded) this.runner.y = this.groundY;
    }
  }
}

/** Axis-aligned box overlap. */
function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
