/**
 * RangeScene — the playable first-person round.
 *
 * There is no 3D engine here. The range is a flat ground plane; the camera has a
 * position and a yaw, and every target is projected through a pinhole camera
 * each frame (see entity-factory `project`). That buys real depth — distant
 * targets are smaller, dimmer, and harder to hit — with plain sprites.
 *
 * Loop (one round):
 *   - Look left/right (A/D, arrows, or drag) and step forward/back (W/S).
 *   - The crosshair is fixed at screen center; fire with E / Space / tap-right.
 *   - Hostile + bonus targets must be hit; bystanders must be left standing.
 *   - Round clears when every hostile is down before the clock expires. Wrongful
 *     fire costs integrity (focus) and breaks the streak; correctly held
 *     bystanders pay a discipline bonus at round end.
 *
 * Score, streak, integrity, and per-round objectives flow through the shared
 * StateStore / QuestEngine so the existing HUD renders them unchanged.
 */
import { createTarget, project, makeView, CAMERA_HEIGHT } from '../entity-factory.js';

const PIXI = window.PIXI;

const TURN_SPEED = 1.9;     // radians/sec at full stick
const MOVE_SPEED = 3.2;     // world units/sec
const MAX_YAW = 0.95;       // clamp so the player can't spin away from the range
const Z_MIN = -2;
const Z_MAX = 4;
const WRONG_SHOT_DAMAGE = 20;
const MISS_DAMAGE = 4;
const BASE_SCORE = 120;
const FIRE_COOLDOWN = 0.22;

export class RangeScene {
  constructor(ctx, { round, roundIndex, roundCount, onRoundClear, onFail }) {
    this.ctx = ctx;
    this.round = round;
    this.roundIndex = roundIndex;
    this.roundCount = roundCount;
    this.onRoundClear = onRoundClear;
    this.onFail = onFail;

    this.container = new PIXI.Container();
    this.skyLayer = new PIXI.Container();
    this.targetLayer = new PIXI.Container();
    this.targetLayer.sortableChildren = true; // depth ordering via zIndex
    this.hudLayer = new PIXI.Container();
    this.container.addChild(this.skyLayer, this.targetLayer, this.hudLayer);

    this.camera = { x: 0, z: 0, yaw: 0 };
    this.targets = [];
    this.timeLeft = round.timeLimit;
    this.streak = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.wrongful = 0; // bystanders engaged — the discipline failure metric
    this._fireCooldown = 0;
    this._done = false;
    this._muzzleT = 0;
    this._recoil = 0;
  }

  enter(ctx) {
    const size = ctx.runtime.size();
    this.view = makeView(size.width, size.height);

    this._buildRange(size);
    this._spawn();
    this._registerObjectives();
    this._buildHud(size);
    this._bindPointerLook();

    ctx.state.set({
      currentRoom: {
        id: this.round.id,
        title: `${this.round.title} — ${this.round.hostiles.length} threat${this.round.hostiles.length === 1 ? '' : 's'} downrange`,
        index: this.roundIndex,
        count: this.roundCount,
        summary: 'Engage the threats. Hold fire on routine activity.',
      },
      hint: 'Look with A/D or drag · move with W/S · fire with E / Space / tap right.',
    });
    ctx.state.logEvent(`${this.round.title}: ${this.round.hostiles.length} threats, ${this.round.bystanders.length} bystander(s)`);
  }

  // ---- Range geometry -------------------------------------------------------

  _buildRange({ width, height }) {
    this.skyLayer.removeChildren();
    const horizon = this.view.horizon;

    // Sky gradient stand-in: two flat bands plus a glow strip at the horizon.
    const sky = new PIXI.Graphics();
    sky.rect(0, 0, width, horizon).fill(0x081426);
    sky.rect(0, horizon - 60, width, 60).fill({ color: 0x0e2338, alpha: 0.8 });
    sky.rect(0, horizon - 3, width, 6).fill({ color: 0x67e8f9, alpha: 0.28 });
    sky.rect(0, horizon, width, height - horizon).fill(0x0a1a14);
    this.skyLayer.addChild(sky);

    // Ground lane lines, drawn in perspective, redrawn as the camera turns.
    this.ground = new PIXI.Graphics();
    this.skyLayer.addChild(this.ground);
  }

  _drawGround() {
    if (!this.ground) return;
    const { width, height } = this.view;
    const horizon = this.view.horizon;
    this.ground.clear();

    // Depth rungs: constant-z lines get closer together as they recede.
    for (let z = 4; z <= 24; z += 4) {
      const p = project({ x: 0, z }, this.camera, this.view);
      if (!p) continue;
      const y = horizon + (this.view.focal * CAMERA_HEIGHT) / p.depth;
      if (y > horizon && y < height) {
        this.ground.moveTo(0, y).lineTo(width, y)
          .stroke({ width: 1, color: 0x1c3a2e, alpha: Math.max(0.15, 1 - z / 26) });
      }
    }

    // Lane markers: constant-x lines converging toward the vanishing point.
    for (let x = -9; x <= 9; x += 3) {
      const near = project({ x, z: 3 }, this.camera, this.view);
      const far = project({ x, z: 22 }, this.camera, this.view);
      if (!near || !far) continue;
      const nearY = horizon + (this.view.focal * CAMERA_HEIGHT) / near.depth;
      const farY = horizon + (this.view.focal * CAMERA_HEIGHT) / far.depth;
      this.ground.moveTo(near.screenX, nearY).lineTo(far.screenX, farY)
        .stroke({ width: 1, color: 0x1c3a2e, alpha: 0.5 });
    }
  }

  _spawn() {
    const place = this.round.placements;
    const add = (spec, kind) => {
      const pos = place.get(spec.id) || { x: 0, z: 12 };
      const t = createTarget(this.ctx, spec, {
        x: pos.x,
        z: pos.z,
        kind,
        strafeSpeed: this.round.strafeSpeed,
      });
      t.addTo(this.targetLayer);
      this.targets.push(t);
      return t;
    };

    this.round.hostiles.forEach((s) => add(s, 'hostile'));
    this.round.bystanders.forEach((s) => add(s, 'bystander'));
    if (this.round.bonus) add(this.round.bonus, 'bonus');
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const t of this.targets) {
      if (t.kind === 'bystander') {
        q.register(this.round.id, {
          id: `${this.round.id}:hold:${t.spec.id}`,
          label: `Hold fire: ${t.spec.label}`,
          kind: 'hold',
          reward: { xp: 40 },
        });
      } else {
        q.register(this.round.id, {
          id: `${this.round.id}:hit:${t.spec.id}`,
          label: `Engage: ${t.spec.label}`,
          kind: 'shoot',
          reward: t.spec.reward,
          optional: t.kind === 'bonus',
        });
      }
    }
  }

  // ---- HUD ------------------------------------------------------------------

  _buildHud({ width, height }) {
    this.hudLayer.removeChildren();

    this.crosshair = new PIXI.Graphics();
    this.hudLayer.addChild(this.crosshair);

    this.muzzle = new PIXI.Sprite(this.ctx.assets.get('muzzle'));
    this.muzzle.anchor.set(0.5);
    this.muzzle.alpha = 0;
    this.hudLayer.addChild(this.muzzle);

    this.readout = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xe5f4ff, fontSize: 13, fontWeight: '800' },
    });
    this.readout.anchor.set(0.5, 0);
    this.hudLayer.addChild(this.readout);

    this.streakText = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xfbbf24, fontSize: 15, fontWeight: '900' },
    });
    this.streakText.anchor.set(0.5, 0);
    this.hudLayer.addChild(this.streakText);

    // Compass strip: shows where the player is looking across the range.
    this.compass = new PIXI.Graphics();
    this.hudLayer.addChild(this.compass);

    this._layoutHud({ width, height });
  }

  _layoutHud({ width, height }) {
    this.readout?.position.set(width / 2, 18);
    this.streakText?.position.set(width / 2, 40);
    this._drawCrosshair();
    this.muzzle?.position.set(width / 2, this.view.horizon + 30);
  }

  _drawCrosshair() {
    if (!this.crosshair) return;
    const cx = this.view.cx;
    const cy = this.view.horizon - this._recoil * 14;
    const gap = 7 + this._recoil * 10;
    const arm = 12;
    const hot = this.targets.some((t) => !t.hit && t.isUnderCrosshair(this.view));
    const color = hot ? 0x34d399 : 0x67e8f9;

    this.crosshair.clear();
    this.crosshair.moveTo(cx - gap - arm, cy).lineTo(cx - gap, cy).stroke({ width: 2, color });
    this.crosshair.moveTo(cx + gap, cy).lineTo(cx + gap + arm, cy).stroke({ width: 2, color });
    this.crosshair.moveTo(cx, cy - gap - arm).lineTo(cx, cy - gap).stroke({ width: 2, color });
    this.crosshair.moveTo(cx, cy + gap).lineTo(cx, cy + gap + arm).stroke({ width: 2, color });
    this.crosshair.circle(cx, cy, 2).fill(color);
  }

  _drawCompass() {
    if (!this.compass) return;
    const { width } = this.view;
    const barW = Math.min(300, width - 120);
    const bx = (width - barW) / 2;
    const by = this.view.height - 34;
    this.compass.clear();
    this.compass.roundRect(bx, by, barW, 6, 3).fill({ color: 0x050c18, alpha: 0.8 });
    // Yaw position marker within the clamped look range.
    const t = (this.camera.yaw + MAX_YAW) / (MAX_YAW * 2);
    this.compass.circle(bx + t * barW, by + 3, 5).fill(0x67e8f9);
    // Ticks for un-engaged hostiles, so nothing hides off to one side.
    for (const target of this.targets) {
      if (target.hit || target.kind === 'bystander') continue;
      const ang = Math.atan2(target.world.x - this.camera.x, target.world.z - this.camera.z);
      const tt = Math.max(0, Math.min(1, (ang + MAX_YAW) / (MAX_YAW * 2)));
      this.compass.rect(bx + tt * barW - 1, by - 4, 2, 5).fill({ color: 0xfb7185, alpha: 0.9 });
    }
  }

  /** Drag-to-look on touch, in addition to keyboard turning. */
  _bindPointerLook() {
    this.container.eventMode = 'static';
    this.container.hitArea = new PIXI.Rectangle(0, 0, this.view.width, this.view.height);
    this._dragging = null;
    this.container.on('pointerdown', (e) => {
      this._dragging = { x: e.global.x, yaw: this.camera.yaw };
    });
    this.container.on('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.global.x - this._dragging.x;
      this.camera.yaw = clamp(this._dragging.yaw - (dx / this.view.width) * 1.8, -MAX_YAW, MAX_YAW);
    });
    const end = () => { this._dragging = null; };
    this.container.on('pointerup', end);
    this.container.on('pointerupoutside', end);
  }

  // ---- Frame ----------------------------------------------------------------

  update(dt) {
    if (this._done) return;

    // --- Camera ---
    const axis = this.ctx.input.getAxis();
    this.camera.yaw = clamp(this.camera.yaw + axis.x * TURN_SPEED * dt, -MAX_YAW, MAX_YAW);
    this.camera.z = clamp(this.camera.z - axis.y * MOVE_SPEED * dt, Z_MIN, Z_MAX);

    // --- Targets: move, then project through the camera ---
    for (const t of this.targets) {
      t.advance(dt);
      t.place(project(t.world, this.camera, this.view));
      t.updateParticles(dt);
    }

    // --- Fire ---
    if (this._fireCooldown > 0) this._fireCooldown = Math.max(0, this._fireCooldown - dt);
    if (this.ctx.input.consumeInteract() && this._fireCooldown === 0) this._fire();

    // --- Feedback decay ---
    if (this._muzzleT > 0) {
      this._muzzleT = Math.max(0, this._muzzleT - dt);
      if (this.muzzle) {
        this.muzzle.alpha = this._muzzleT / 0.12;
        this.muzzle.scale.set(1 + (1 - this._muzzleT / 0.12) * 0.6);
      }
    }
    if (this._recoil > 0) this._recoil = Math.max(0, this._recoil - dt * 5);

    // --- Timer + HUD ---
    this.timeLeft -= dt;
    this._drawGround();
    this._drawCrosshair();
    this._drawCompass();
    this._updateReadout();

    // --- Resolution ---
    const hostilesLeft = this.targets.filter((t) => t.kind === 'hostile' && !t.hit).length;
    if (hostilesLeft === 0) {
      this._finish(true);
    } else if (this.ctx.state.get('focus') <= 0) {
      this.ctx.state.set({ hint: 'Integrity depleted — range failure.' });
      this._finish(false);
    } else if (this.timeLeft <= 0) {
      this.ctx.state.set({ hint: "Time's up on the range!" });
      this._finish(false);
    }
  }

  _fire() {
    this._fireCooldown = FIRE_COOLDOWN;
    this.shotsFired++;
    this._muzzleT = 0.12;
    this._recoil = 1;
    this.ctx.audio?.play('pickup');

    // Nearest target under the crosshair wins the shot.
    const candidates = this.targets
      .filter((t) => !t.hit && t.isUnderCrosshair(this.view))
      .sort((a, b) => (a.screen?.depth || 99) - (b.screen?.depth || 99));
    const target = candidates[0];

    if (!target) {
      this.streak = 0;
      this.ctx.state.damageFocus(MISS_DAMAGE);
      this.ctx.state.set({ hint: 'Missed — every stray round costs integrity.' });
      return;
    }

    const result = target.shoot();

    if (result.correct) {
      this.shotsHit++;
      this.streak++;
      const streakMul = Math.min(4, 1 + Math.floor(this.streak / 3));
      const bonusMul = target.kind === 'bonus' ? 2 : 1;
      const gain = Math.round((target.spec.reward?.xp || BASE_SCORE) * streakMul * bonusMul);
      this.ctx.state.addXp(gain);
      if (target.spec.reward?.currency) this.ctx.state.addCurrency(target.spec.reward.currency);
      this.ctx.state.addKey(`${this.round.id}:${target.spec.id}`, {
        id: target.spec.id, label: target.spec.label, icon: 'target-good',
      });
      this.ctx.quests.complete(`${this.round.id}:hit:${target.spec.id}`);
      this.ctx.state.set({ hint: target.spec.description || `Confirmed: ${target.spec.label}` });
      this.ctx.state.logEvent(`✓ ${target.spec.label} (+${gain})`);
    } else {
      // Wrongful engagement — the discipline failure this drill exists to teach.
      this.streak = 0;
      this.wrongful++;
      this.ctx.state.damageFocus(WRONG_SHOT_DAMAGE);
      this.ctx.quests.fail(`${this.round.id}:hold:${target.spec.id}`, 0);
      this.ctx.state.set({ hint: `⚠ Hold fire — ${target.spec.description || target.spec.label}` });
      this.ctx.state.logEvent(`⚠ Wrongful engagement: ${target.spec.label} (−${WRONG_SHOT_DAMAGE})`);
    }
  }

  _updateReadout() {
    if (!this.readout) return;
    const left = this.targets.filter((t) => t.kind === 'hostile' && !t.hit).length;
    const acc = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 100;
    this.readout.text = `⏱ ${Math.ceil(Math.max(0, this.timeLeft))}s   ·   ${left} threat${left === 1 ? '' : 's'} left   ·   ${acc}% accuracy`;
    this.streakText.text = this.streak >= 2 ? `STREAK ×${this.streak}` : '';
  }

  _finish(win) {
    if (this._done) return;
    this._done = true;

    if (win) {
      // Discipline bonus: pay for every bystander correctly left standing.
      let held = 0;
      for (const t of this.targets) {
        if (t.kind === 'bystander' && t.markHeld()) {
          held++;
          this.ctx.quests.complete(`${this.round.id}:hold:${t.spec.id}`);
        }
      }
      if (held) {
        const bonus = held * 60;
        this.ctx.state.addXp(bonus);
        this.ctx.state.logEvent(`🛡 Fire discipline: ${held} held (+${bonus})`);
      }

      const timeBonus = Math.round(Math.max(0, this.timeLeft) * 6);
      if (timeBonus) this.ctx.state.addXp(timeBonus);
      this.ctx.state.clearRoom(this.round.id);
      this.ctx.audio?.play('reward');
      this.onRoundClear?.({
        accuracy: this.shotsFired ? this.shotsHit / this.shotsFired : 1,
        shotsFired: this.shotsFired,
        wrongful: this.wrongful,
        held,
      });
    } else {
      this.onFail?.({
        accuracy: this.shotsFired ? this.shotsHit / this.shotsFired : 0,
        shotsFired: this.shotsFired,
        wrongful: this.wrongful,
      });
    }
  }

  resize(w, h) {
    this.view = makeView(w, h);
    this._buildRange({ width: w, height: h });
    this._layoutHud({ width: w, height: h });
    this.container.hitArea = new PIXI.Rectangle(0, 0, w, h);
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
