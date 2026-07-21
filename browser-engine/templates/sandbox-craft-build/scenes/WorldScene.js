/**
 * WorldScene — the open claim: gather, craft, build.
 *
 * The world is larger than the viewport and the camera follows the builder, so
 * exploration is real. There is no forced order: every node is minable from the
 * first second, and the player decides what to gather and what to build first.
 *
 * Loop:
 *   - Walk to a resource node and HOLD interact to mine it. The fact is shown
 *     while you mine; each completed hit banks material units.
 *   - Press C (or tap the CRAFT button) to open the crafting panel. Affordable
 *     recipes light up; crafting spends materials and queues a structure.
 *   - The queued structure places itself where you stand, so the map fills in
 *     with the procedure you assembled.
 *   - Hazard zones drain energy while you stand in them.
 *   - The run completes when every blueprint's structures are standing.
 */
import { createBuilder, createNode, createStructure } from '../entity-factory.js';

const PIXI = window.PIXI;
const Matter = window.Matter;

const STEP = 1 / 60;
const CAMERA_LAG = 6;
const ENERGY_DRAIN_IDLE = 0.35; // per second — a soft clock on the run
const MINE_ENERGY_COST = 1.1;   // per second while mining

export class WorldScene {
  constructor(ctx, { model, onComplete, onExhausted, onOpenCrafting }) {
    this.ctx = ctx;
    this.model = model;
    this.onComplete = onComplete;
    this.onExhausted = onExhausted;
    this.onOpenCrafting = onOpenCrafting;

    this.container = new PIXI.Container();
    this.world = new PIXI.Container();
    this.hudLayer = new PIXI.Container();
    this.container.addChild(this.world, this.hudLayer);

    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    this._acc = 0;

    this.nodes = [];
    this.structures = [];
    this.hazardGraphics = null;
    this.camera = { x: 0, y: 0 };
    this._paused = false;
    this._done = false;
    this._activeNode = null;
    this.elapsed = 0;
  }

  enter(ctx) {
    const size = ctx.runtime.size();

    this._buildGround();
    this._buildHazards();
    this._spawn();
    this._registerObjectives();
    this._buildHud(size);

    // Any structures crafted before a scene rebuild are restored on re-entry.
    for (const recipe of this.model.recipes) {
      if (recipe.placed && recipe.placedAt) this._raiseStructure(recipe, recipe.placedAt, true);
    }

    ctx.state.set({
      energy: ctx.state.get('energy') ?? 100,
      currentRoom: {
        id: 'claim',
        title: `${this.model.title} — ${this.model.recipes.length} structure${this.model.recipes.length === 1 ? '' : 's'} to build`,
        index: 0,
        count: 1,
        summary: 'Mine the blocks for materials, then craft the steps and place them.',
      },
      hint: 'Walk to a block and HOLD E to mine · press C to open crafting.',
    });
    ctx.state.logEvent(`${this.model.nodes.length} resource nodes on the claim`);
  }

  // ---- World ----------------------------------------------------------------

  _buildGround() {
    const ground = new PIXI.TilingSprite({
      texture: this.ctx.assets.get('tile-ground'),
      width: this.model.width,
      height: this.model.height,
    });
    this.world.addChild(ground);

    // Map boundary — the claim has edges, so the player can't wander into void.
    const t = 40;
    const bodies = [
      Matter.Bodies.rectangle(this.model.width / 2, -t / 2, this.model.width, t, { isStatic: true }),
      Matter.Bodies.rectangle(this.model.width / 2, this.model.height + t / 2, this.model.width, t, { isStatic: true }),
      Matter.Bodies.rectangle(-t / 2, this.model.height / 2, t, this.model.height, { isStatic: true }),
      Matter.Bodies.rectangle(this.model.width + t / 2, this.model.height / 2, t, this.model.height, { isStatic: true }),
    ];
    Matter.Composite.add(this.engine.world, bodies);

    const border = new PIXI.Graphics();
    border.rect(0, 0, this.model.width, this.model.height)
      .stroke({ width: 3, color: 0x1c3a2e });
    this.world.addChild(border);
  }

  _buildHazards() {
    this.hazardGraphics = new PIXI.Graphics();
    this.world.addChild(this.hazardGraphics);

    for (const h of this.model.hazards) {
      this.hazardGraphics.circle(h.x, h.y, h.radius)
        .fill({ color: 0xfb7185, alpha: 0.09 })
        .stroke({ width: 2, color: 0xfb7185, alpha: 0.35 });

      const label = new PIXI.Text({
        text: shorten(h.spec.label, 26),
        style: {
          fontFamily: 'Inter, system-ui, sans-serif', fill: 0xfb7185, fontSize: 10, fontWeight: '800',
          align: 'center', wordWrap: true, wordWrapWidth: 130,
        },
      });
      label.anchor.set(0.5);
      label.position.set(h.x, h.y);
      this.world.addChild(label);
    }
  }

  _spawn() {
    this.structureLayer = new PIXI.Container();
    this.world.addChild(this.structureLayer);

    for (const n of this.model.nodes) {
      const node = createNode(this.ctx, n.spec, {
        x: n.x, y: n.y, material: n.material, yield: n.yield, hits: n.hits,
      });
      node.addTo(this.world);
      this.nodes.push(node);
    }

    this.builder = createBuilder(this.ctx, this.model.spawn);
    this.builder.addTo(this.world, this.engine.world);
    this.camera = { ...this.model.spawn };
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const recipe of this.model.recipes) {
      q.register('claim', {
        id: `craft:${recipe.id}`,
        label: `Build: ${recipe.spec.label}`,
        kind: 'craft',
        reward: recipe.spec.reward,
      });
    }
  }

  // ---- HUD ------------------------------------------------------------------

  _buildHud({ width, height }) {
    this.hudLayer.removeChildren();

    this.satchel = new PIXI.Graphics();
    this.hudLayer.addChild(this.satchel);

    this.satchelText = [];
    for (let i = 0; i < this.model.materials.length; i++) {
      const t = new PIXI.Text({
        text: '',
        style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xe5f4ff, fontSize: 12, fontWeight: '800' },
      });
      this.hudLayer.addChild(t);
      this.satchelText.push(t);
    }

    this.prompt = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'Inter, system-ui, sans-serif', fill: 0xe5f4ff, fontSize: 13, fontWeight: '700',
        align: 'center', wordWrap: true, wordWrapWidth: Math.min(460, width - 80), lineHeight: 18,
      },
    });
    this.prompt.anchor.set(0.5, 0);
    this.hudLayer.addChild(this.prompt);

    // Crafting button — the one screen-space control this genre needs on touch.
    this.craftBtn = new PIXI.Container();
    this.craftBg = new PIXI.Graphics();
    this.craftLabel = new PIXI.Text({
      text: 'CRAFT (C)',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0x03131d, fontSize: 13, fontWeight: '900' },
    });
    this.craftLabel.anchor.set(0.5);
    this.craftBtn.addChild(this.craftBg, this.craftLabel);
    this.craftBtn.eventMode = 'static';
    this.craftBtn.cursor = 'pointer';
    this.craftBtn.on('pointertap', () => this._openCrafting());
    this.hudLayer.addChild(this.craftBtn);

    this._layoutHud({ width, height });
  }

  _layoutHud({ width, height }) {
    this._hudGeom = { width, height };
    this.prompt?.position.set(width / 2, 14);

    // Satchel sits bottom-right above the craft button: bottom-center belongs to
    // the shared HUD hint pill and bottom-left to the event log.
    const bw = 92;
    const total = this.model.materials.length * bw;
    const bx = Math.max(16, width - total - 20);
    const by = height - 172;
    this._satchelGeom = { bx, by, bw };

    this.satchelText.forEach((t, i) => t.position.set(bx + i * bw + 30, by + 8));

    const cw = 128;
    const ch = 40;
    const cx = width - cw - 20;
    const cy = height - 118;
    this.craftBg?.clear();
    this.craftBg?.roundRect(0, 0, cw, ch, 20).fill(0xa78bfa);
    this.craftBtn?.position.set(cx, cy);
    this.craftLabel?.position.set(cw / 2, ch / 2);
  }

  _drawSatchel() {
    if (!this._satchelGeom) return;
    const { bx, by, bw } = this._satchelGeom;
    const inv = this.ctx.state.get('materials') || {};
    this.satchel.clear();
    this.model.materials.forEach((mat, i) => {
      const x = bx + i * bw;
      this.satchel.roundRect(x + 4, by, bw - 8, 30, 8)
        .fill({ color: 0x050c18, alpha: 0.86 })
        .stroke({ width: 1, color: 0x334155 });
      this.satchel.rect(x + 14, by + 10, 11, 11).fill(mat.color);
      this.satchelText[i].text = `${inv[mat.id] || 0}  ${mat.label.split(' ')[0]}`;
    });
  }

  _openCrafting() {
    if (this._paused || this._done) return;
    this._paused = true;
    this.builder.halt();
    this.onOpenCrafting?.(() => { this._paused = false; });
  }

  resume() {
    this._paused = false;
  }

  // ---- Frame ----------------------------------------------------------------

  update(dt) {
    if (this._done) return;

    for (const n of this.nodes) n.update(dt);
    for (const s of this.structures) s.update(dt);

    if (this._paused) return;

    this.elapsed += dt;

    // --- Movement ---
    this._acc += dt;
    let guard = 0;
    const axis = this.ctx.input.getAxis();
    while (this._acc >= STEP && guard < 5) {
      this.builder.drive(axis);
      Matter.Engine.update(this.engine, STEP * 1000);
      this._acc -= STEP;
      guard++;
    }
    this.builder.sync(dt);
    const bpos = this.builder.position;

    // --- Mining: hold interact while in reach of a node ---
    this._updateMining(dt, bpos, axis);

    // --- Hazard zones drain energy ---
    let inHazard = null;
    for (const h of this.model.hazards) {
      if (Math.hypot(bpos.x - h.x, bpos.y - h.y) <= h.radius) { inHazard = h; break; }
    }

    // --- Energy: a slow clock, faster while mining or standing in a hazard ---
    let drain = ENERGY_DRAIN_IDLE;
    if (this._activeNode) drain += MINE_ENERGY_COST;
    if (inHazard) drain += inHazard.drain;
    const energy = Math.max(0, (this.ctx.state.get('energy') ?? 100) - drain * dt);
    this.ctx.state.set({ energy });
    // Mirror energy onto focus so the shared HUD's focus bar stays meaningful.
    this.ctx.state.set({ focus: Math.round(energy) });

    if (inHazard && !this._hazardHint) {
      this._hazardHint = true;
      this.builder.flash();
      this.ctx.state.set({ hint: `⚠ ${inHazard.spec.description || inHazard.spec.label}` });
    } else if (!inHazard) {
      this._hazardHint = false;
    }

    // --- Keyboard crafting shortcut ---
    if (this.ctx.input.keys.has('c')) {
      this.ctx.input.keys.delete('c');
      this._openCrafting();
    }

    // --- Camera ---
    this.camera.x += (bpos.x - this.camera.x) * Math.min(1, CAMERA_LAG * dt);
    this.camera.y += (bpos.y - this.camera.y) * Math.min(1, CAMERA_LAG * dt);
    this._applyCamera();

    this._drawSatchel();
    this._updatePrompt();

    // --- Resolution ---
    if (energy <= 0) {
      this.ctx.state.set({ hint: 'Out of energy — the day is over.' });
      this._finish(false);
    } else if (this._allBlueprintsComplete()) {
      this._finish(true);
    }
  }

  _updateMining(dt, bpos, axis) {
    const held = this.ctx.input.keys.has('e') || this.ctx.input.keys.has(' ') || this._touchMining();
    // Walking away cancels the current hit — mining requires standing still.
    const moving = Math.abs(axis.x) + Math.abs(axis.y) > 0.15;

    const node = this.nodes.find((n) => n.inReach(bpos));
    if (!node || !held || moving) {
      if (this._activeNode) {
        this._activeNode.resetProgress();
        this._activeNode = null;
        this.builder.aimBeam(null);
      }
      return;
    }

    this._activeNode = node;
    this.builder.aimBeam(node.position, node.material.color);

    const result = node.mine(dt);
    if (!result) return;

    const inv = { ...(this.ctx.state.get('materials') || {}) };
    inv[result.material] = (inv[result.material] || 0) + result.units;
    this.ctx.state.set({ materials: inv });
    this.ctx.state.addXp(20);
    this.ctx.state.set({
      hint: `+${result.units} ${node.material.label} · ${result.spec.description || result.spec.label}`,
    });

    if (result.depleted) {
      this.ctx.state.addKey(`node:${result.spec.id}`, {
        id: result.spec.id, label: result.spec.label, icon: node.material.texture,
      });
      this.ctx.state.logEvent(`⛏ Mined out: ${result.spec.label}`);
      this._activeNode = null;
      this.builder.aimBeam(null);
    }
  }

  /** Touch mining: the interact button is held rather than tapped. */
  _touchMining() {
    // InputController fires interact per press; for hold-to-mine on touch we
    // treat a recent interact as a held frame, which keeps mobile playable.
    if (this.ctx.input.consumeInteract()) {
      this._touchHoldFor = 0.35;
    }
    if (this._touchHoldFor > 0) {
      this._touchHoldFor -= 1 / 60;
      return true;
    }
    return false;
  }

  /** Craft a recipe: spend materials, raise the structure where the player is. */
  craft(recipe) {
    if (recipe.crafted) return false;
    recipe.crafted = true;
    recipe.placed = true;

    const at = { x: this.builder.position.x, y: this.builder.position.y };
    recipe.placedAt = at;
    this._raiseStructure(recipe, at, false);

    this.ctx.quests.complete(`craft:${recipe.id}`);
    this.ctx.state.addXp(recipe.spec.reward?.xp || 120);
    if (recipe.spec.reward?.currency) this.ctx.state.addCurrency(recipe.spec.reward.currency);
    this.ctx.state.logEvent(`🔨 Built: ${recipe.spec.label}`);
    this.ctx.state.set({ hint: `🔨 ${recipe.spec.description || recipe.spec.label}` });

    this._checkBlueprints();
    return true;
  }

  _raiseStructure(recipe, at, silent) {
    const structure = createStructure(this.ctx, recipe.spec, { ...at, tier: recipe.tier });
    structure.addTo(this.structureLayer);
    this.structures.push(structure);
    if (!silent) this.ctx.audio?.play('reward');
  }

  _checkBlueprints() {
    for (const bp of this.model.blueprints) {
      if (bp.complete) continue;
      const done = bp.requires.every((rid) => this.model.recipes.find((r) => r.id === rid)?.placed);
      if (done) {
        bp.complete = true;
        this.ctx.state.addXp(bp.spec.reward?.xp || 200);
        this.ctx.state.logEvent(`📐 Blueprint complete: ${bp.spec.label}`);
      }
    }
  }

  _allBlueprintsComplete() {
    return this.model.blueprints.length > 0 && this.model.blueprints.every((b) => b.complete);
  }

  _updatePrompt() {
    if (!this.prompt) return;
    if (this._activeNode) {
      this.prompt.text = `⛏ ${this._activeNode.spec.description || this._activeNode.spec.label}`;
      return;
    }
    const near = this.nodes.find((n) => n.inReach(this.builder.position));
    if (near) {
      this.prompt.text = `HOLD E to mine · ${near.spec.label} (${near.material.label})`;
      return;
    }
    const built = this.model.recipes.filter((r) => r.placed).length;
    this.prompt.text = `${built} / ${this.model.recipes.length} structures built · press C to craft`;
  }

  _applyCamera() {
    const { width, height } = this.ctx.runtime.size();
    const x = clamp(this.camera.x, width / 2, Math.max(width / 2, this.model.width - width / 2));
    const y = clamp(this.camera.y, height / 2, Math.max(height / 2, this.model.height - height / 2));
    this.world.x = width / 2 - x;
    this.world.y = height / 2 - y;
  }

  _finish(win) {
    if (this._done) return;
    this._done = true;
    this.builder.halt();
    if (win) {
      this.ctx.state.clearRoom('claim');
      this.ctx.audio?.play('reward');
      const bonus = Math.max(0, Math.round(300 - this.elapsed * 1.5));
      if (bonus > 0) {
        this.ctx.state.addXp(bonus);
        this.ctx.state.logEvent(`🏗 Build complete · efficiency bonus +${bonus}`);
      }
      this.onComplete?.({
        built: this.model.recipes.filter((r) => r.placed).length,
        elapsed: this.elapsed,
        energy: this.ctx.state.get('energy'),
      });
    } else {
      this.onExhausted?.({
        built: this.model.recipes.filter((r) => r.placed).length,
        elapsed: this.elapsed,
        energy: 0,
      });
    }
  }

  resize(w, h) {
    this._layoutHud({ width: w, height: h });
    this._applyCamera();
  }

  exit() {
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function shorten(text, max = 26) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
