/**
 * RegionScene — one chapter of the campaign, played as an explorable region.
 *
 * This is where the RPG genre stops being a reading list and becomes a game:
 *   - A bounded region (tiled floor + Matter static walls) with the hero at the
 *     entrance and the chapter's quest-giver beside them.
 *   - The chapter's facts spawn as QuestObjectives in a ring; walking over one
 *     logs it and completes the matching QuestEngine objective.
 *   - The chapter's hazards spawn as patrolling Enemies. Interacting inside an
 *     enemy's engage radius pushes the EncounterScene (a recall check).
 *   - The region gate stays sealed until every objective is logged and every
 *     enemy defeated; unlocking it advances the chapter.
 *
 * Progression (xp, level, skill points, focus) all flows through the shared
 * StateStore and QuestEngine, so the existing HUD renders it unchanged.
 */
import { createHero, createQuestGiver, createObjective, createEnemy, ringPlacement } from '../entity-factory.js';

const PIXI = window.PIXI;
const Matter = window.Matter;
const STEP = 1 / 60;
const WALL = 18;
const ENEMY_TOUCH_DAMAGE = 10;
const TOUCH_COOLDOWN = 1.4;

export class RegionScene {
  constructor(ctx, { chapter, chapterIndex, chapterCount, quiz, onChapterClear, onFail, onBriefing, onEncounter }) {
    this.ctx = ctx;
    this.chapter = chapter;
    this.chapterIndex = chapterIndex;
    this.chapterCount = chapterCount;
    this.quiz = quiz; // (enemySpec) => quiz object, supplied by the template runtime
    this.onChapterClear = onChapterClear;
    this.onFail = onFail;
    this.onBriefing = onBriefing;
    this.onEncounter = onEncounter;

    this.container = new PIXI.Container();
    this.world = new PIXI.Container();
    this.overlayLayer = new PIXI.Container();
    this.container.addChild(this.world);
    this.container.addChild(this.overlayLayer);

    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    this._acc = 0;

    this.objectives = [];
    this.enemies = [];
    this.giver = null;
    this.hero = null;
    this.gateUnlocked = false;
    this._touchCooldown = 0;
    this._done = false;
    this._paused = false;
  }

  enter(ctx) {
    const size = ctx.runtime.size();
    this.bounds = {
      x: WALL,
      y: WALL,
      w: Math.max(720, Math.min(size.width, 1320)) - WALL * 2,
      h: Math.max(540, Math.min(size.height, 920)) - WALL * 2,
    };
    this.center = { x: this.bounds.x + this.bounds.w / 2, y: this.bounds.y + this.bounds.h / 2 };

    this._buildFloor();
    this._buildWalls();
    this._spawn();
    this._buildGate();
    this._registerObjectives();
    this._center(size);

    ctx.state.set({
      currentRoom: {
        id: this.chapter.id,
        title: this.chapter.title,
        index: this.chapterIndex,
        count: this.chapterCount,
        summary: `Log ${this.objectives.length} fact${this.objectives.length === 1 ? '' : 's'}${this.enemies.length ? ` · defeat ${this.enemies.length} threat${this.enemies.length === 1 ? '' : 's'}` : ''}.`,
      },
      hint: this.giver
        ? 'Talk to the guide (walk close, press E) to take the questline.'
        : 'Walk over the glowing facts to log them. Press E near a threat to engage.',
    });
    ctx.state.logEvent(`${this.chapter.title} — region entered`);
    // What the knowledge graph says this region depends on, already cleared.
    if (this.chapter.buildsOn?.length) {
      ctx.state.logEvent(`↳ builds on ${this.chapter.buildsOn.join(', ')}`);
    }
  }

  _buildFloor() {
    const tex = this.ctx.assets.get('tile-floor');
    const floor = new PIXI.TilingSprite({
      texture: tex,
      width: this.bounds.w + WALL * 2,
      height: this.bounds.h + WALL * 2,
    });
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
    // Hero enters from the bottom of the region; the guide waits beside them.
    const start = { x: this.center.x, y: this.bounds.y + this.bounds.h - 70 };
    this.hero = createHero(this.ctx, start);
    this.hero.addTo(this.world, this.engine.world);
    this.hero.setLevel(this.ctx.state.get('level'));
    this.hero.speedBonus = (this.ctx.state.get('skills')?.momentum || 0) * 0.5;

    if (this.chapter.giver) {
      this.giver = createQuestGiver(this.ctx, this.chapter.giver, { x: start.x - 90, y: start.y - 20 });
      this.giver.addTo(this.world);
    }

    // Facts ring the region center — readable at a glance, walkable in one loop.
    const radius = Math.min(this.bounds.w, this.bounds.h) * 0.31;
    const spots = ringPlacement(this.chapter.objectives.length, this.center, radius);
    this.chapter.objectives.forEach((spec, i) => {
      const obj = createObjective(this.ctx, spec, spots[i] || this.center);
      obj.addTo(this.world);
      this.objectives.push(obj);
    });

    // Enemies patrol between the ring and the walls so they must be passed.
    const enemyRadius = radius * 1.62;
    const enemySpots = ringPlacement(this.chapter.enemies.length, this.center, enemyRadius, -Math.PI / 3);
    this.chapter.enemies.forEach((spec, i) => {
      const enemy = createEnemy(this.ctx, spec, {
        ...(enemySpots[i] || this.center),
        hp: this.chapter.enemyHp,
      });
      enemy.addTo(this.world);
      this.enemies.push(enemy);
    });
  }

  _buildGate() {
    // The gate sits at the top of the region — the visible goal of the chapter.
    this.gate = new PIXI.Container();
    this.gate.x = this.center.x;
    this.gate.y = this.bounds.y + 46;

    this.gateSprite = new PIXI.Sprite(this.ctx.assets.get('door'));
    this.gateSprite.anchor.set(0.5);
    this.gateSprite.width = 46;
    this.gateSprite.height = 64;
    this.gate.addChild(this.gateSprite);

    this.gateLabel = new PIXI.Text({
      text: this.chapter.gate?.label || 'Region Gate',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0x94a3b8, fontSize: 12, fontWeight: '800' },
    });
    this.gateLabel.anchor.set(0.5, 0);
    this.gateLabel.y = 38;
    this.gate.addChild(this.gateLabel);

    this.world.addChild(this.gate);
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const obj of this.objectives) {
      q.register(this.chapter.id, {
        id: `${this.chapter.id}:${obj.spec.id}`,
        label: `Log: ${obj.spec.label}`,
        kind: 'collect',
        reward: obj.spec.reward,
      });
    }
    for (const enemy of this.enemies) {
      q.register(this.chapter.id, {
        id: `${this.chapter.id}:enemy:${enemy.spec.id}`,
        label: `Defeat: ${enemy.spec.label}`,
        kind: 'battle',
        reward: enemy.spec.reward,
      });
    }
  }

  /** Called by the template runtime when an overlay (briefing/encounter) closes. */
  resume() {
    this._paused = false;
  }

  pause() {
    this._paused = true;
    this.hero?.halt();
  }

  update(dt) {
    if (this._done) return;
    if (this._paused) {
      // Still animate the world so a pushed overlay doesn't sit on a frozen frame.
      for (const o of this.objectives) o.update(dt);
      for (const e of this.enemies) e.update(dt);
      this.giver?.update(dt);
      return;
    }

    // --- Fixed-step physics ---
    this._acc += dt;
    let guard = 0;
    const axis = this.ctx.input.getAxis();
    while (this._acc >= STEP && guard < 5) {
      this.hero.drive(axis);
      Matter.Engine.update(this.engine, STEP * 1000);
      this._acc -= STEP;
      guard++;
    }
    this.hero.sync(dt);
    const hpos = this.hero.position;

    for (const o of this.objectives) o.update(dt);
    for (const e of this.enemies) e.update(dt);
    this.giver?.update(dt);

    // --- Log facts on contact ---
    for (const o of this.objectives) {
      if (!o.collected && o.isNear(hpos)) {
        o.collect();
        const skills = this.ctx.state.get('skills') || {};
        const momentumBonus = 1 + (skills.momentum || 0) * 0.2;
        const gain = Math.round((o.spec.reward?.xp || 60) * momentumBonus);
        this.ctx.state.addXp(gain);
        if (o.spec.reward?.currency) this.ctx.state.addCurrency(o.spec.reward.currency);
        this.ctx.state.addKey(`${this.chapter.id}:${o.spec.id}`, {
          id: o.spec.id, label: o.spec.label, icon: 'objective',
        });
        this.ctx.quests.complete(`${this.chapter.id}:${o.spec.id}`);
        this.ctx.state.set({ hint: o.spec.description || `Logged: ${o.spec.label}` });
        this.hero.setLevel(this.ctx.state.get('level'));
      }
    }

    // --- Enemy contact costs focus (encounters are opt-in via interact) ---
    if (this._touchCooldown > 0) this._touchCooldown = Math.max(0, this._touchCooldown - dt);
    const nearEnemy = this.enemies.find((e) => !e.defeated && e.isNear(hpos));
    if (nearEnemy && this._touchCooldown === 0) {
      this._touchCooldown = TOUCH_COOLDOWN;
      const skills = this.ctx.state.get('skills') || {};
      const damage = Math.max(3, ENEMY_TOUCH_DAMAGE - (skills.resolve || 0) * 3);
      this.hero.flash();
      this.ctx.state.damageFocus(damage);
      this.ctx.audio?.play('failure');
      this.ctx.state.set({ hint: `⚔ ${nearEnemy.spec.label} blocks the way — press E to face it.` });
    }

    // --- Interact: talk, engage, or unlock ---
    if (this.ctx.input.consumeInteract()) {
      this._handleInteract(hpos, nearEnemy);
    }

    // --- Gate state ---
    this._updateGate(hpos);

    if (this.ctx.state.get('focus') <= 0) {
      this.ctx.state.set({ hint: 'Focus depleted — the region overwhelms you.' });
      this._finish(false);
    }
  }

  _handleInteract(hpos, nearEnemy) {
    if (this.giver && !this.giver.talked && this.giver.isNear(hpos)) {
      this.giver.markTalked();
      this.pause();
      this.onBriefing?.(this.giver.spec, () => this.resume());
      return;
    }

    if (nearEnemy) {
      this.pause();
      this.onEncounter?.(nearEnemy, this.quiz?.(nearEnemy.spec), (result) => {
        this._resolveEncounter(nearEnemy, result);
        this.resume();
      });
      return;
    }

    if (this._canUnlock() && this._nearGate(hpos)) {
      this._finish(true);
    }
  }

  _resolveEncounter(enemy, result = {}) {
    if (result.defeated) {
      this.ctx.quests.complete(`${this.chapter.id}:enemy:${enemy.spec.id}`);
      const gain = enemy.spec.reward?.xp || 90;
      this.ctx.state.addXp(gain);
      this.ctx.state.logEvent(`⚔ Defeated ${enemy.spec.label} (+${gain})`);
      this.hero.setLevel(this.ctx.state.get('level'));
    }
    if (result.damage) {
      const skills = this.ctx.state.get('skills') || {};
      this.ctx.state.damageFocus(Math.max(2, result.damage - (skills.resolve || 0) * 2));
      this.hero.flash();
    }
    // Push the hero clear of the enemy so contact damage doesn't retrigger.
    this._touchCooldown = TOUCH_COOLDOWN;
  }

  _canUnlock() {
    const factsDone = this.objectives.every((o) => o.collected);
    const enemiesDown = this.enemies.every((e) => e.defeated);
    return factsDone && enemiesDown;
  }

  _nearGate(hpos) {
    return Math.hypot(hpos.x - this.gate.x, hpos.y - this.gate.y) <= 70;
  }

  _updateGate(hpos) {
    const open = this._canUnlock();
    if (open && !this.gateUnlocked) {
      this.gateUnlocked = true;
      this.gateSprite.texture = this.ctx.assets.get('door-open');
      this.gateLabel.style.fill = 0x34d399;
      this.ctx.audio?.play('unlock');
      this.ctx.state.set({ hint: 'The gate opens — head north and press E to advance.' });
      this.ctx.state.logEvent('🔓 Region gate unlocked');
    }
    if (open) {
      this.gateLabel.text = this._nearGate(hpos) ? 'PRESS E TO ADVANCE' : (this.chapter.gate?.label || 'Region Gate');
    } else {
      const left = this.objectives.filter((o) => !o.collected).length;
      const foes = this.enemies.filter((e) => !e.defeated).length;
      this.gateLabel.text = `Sealed · ${left} fact${left === 1 ? '' : 's'}${foes ? `, ${foes} threat${foes === 1 ? '' : 's'}` : ''} left`;
    }
  }

  _finish(win) {
    if (this._done) return;
    this._done = true;
    if (win) {
      this.ctx.state.clearRoom(this.chapter.id);
      this.ctx.audio?.play('reward');
      const bonus = this.chapter.gate?.reward?.xp || 60;
      this.ctx.state.addXp(bonus);
      this.ctx.state.logEvent(`✓ ${this.chapter.title} cleared (+${bonus})`);
      this.onChapterClear?.();
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
  }

  exit() {
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }
}