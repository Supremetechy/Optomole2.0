/**
 * RoomScene — the playable room. This is where Optomole stops being "quest UI"
 * and becomes an actual game.
 *
 * Responsibilities:
 *   - Build the room: tiled floor, bounding walls (Matter static bodies),
 *     player, guide NPC, collectibles (keys/objectives), hazards, exit door.
 *   - Run a fixed-step Matter physics loop so movement and wall/door collision
 *     are stable and frame-rate independent.
 *   - Drive the player from InputController each step; sync sprites each frame.
 *   - Auto-pickup collectibles on proximity, damage focus on hazard contact,
 *     open dialogue on NPC interact, and unlock the gate once the room's keys
 *     and objectives are satisfied.
 *   - Follow the player with a simple camera when the room exceeds the viewport.
 */
import { createEntity, createPlayer, layoutRoom } from '../entity-factory.js';
import { DialogueEngine } from '../../../engines/DialogueEngine.js';

const PIXI = window.PIXI;
const Matter = window.Matter;
const STEP = 1 / 60;
const WALL = 16;

export class RoomScene {
  constructor(ctx, { room, roomIndex, roomCount, onExit, openDialogue }) {
    this.ctx = ctx;
    this.room = room;
    this.roomIndex = roomIndex;
    this.roomCount = roomCount;
    this.onExit = onExit;
    this.openDialogue = openDialogue;

    this.container = new PIXI.Container();
    this.world = new PIXI.Container(); // camera-transformed layer
    this.container.addChild(this.world);

    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    this._acc = 0;
    this._exited = false;

    this.collectibles = [];
    this.hazards = [];
    this.npc = null;
    this.door = null;
    this.player = null;
  }

  enter(ctx) {
    const size = ctx.runtime.size();
    // Room fills the viewport (min 720x540 so small windows still play well).
    this.bounds = {
      x: WALL,
      y: WALL,
      w: Math.max(720, size.width) - WALL * 2,
      h: Math.max(540, size.height) - WALL * 2,
    };
    this._buildFloor();
    this._buildWalls();
    this._spawn();
    this._registerObjectives();

    ctx.state.set({
      currentRoom: {
        id: this.room.id,
        title: this.room.title,
        index: this.roomIndex,
        count: this.roomCount,
        summary: this.room.npc?.description || 'Collect the keys, avoid hazards, unlock the gate.',
      },
      hint: 'Move with WASD / arrows or the joystick. Press E to talk & unlock.',
    });
    ctx.state.logEvent(`Entered ${this.room.title}`);
    // What the knowledge graph says this room depends on, already cleared.
    if (this.room.buildsOn?.length) {
      ctx.state.logEvent(`↳ builds on ${this.room.buildsOn.join(', ')}`);
    }
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
      [x - WALL, y - WALL, w + WALL * 2, WALL], // top
      [x - WALL, y + h, w + WALL * 2, WALL], // bottom
      [x - WALL, y - WALL, WALL, h + WALL * 2], // left
      [x + w, y - WALL, WALL, h + WALL * 2], // right
    ];
    const pal = this.ctx.theme?.palette;
    const wallFill = pal?.floorGrid ?? 0x1e293b;
    const wallEdge = pal?.wall ?? 0x334155;
    const bodies = [];
    for (const [sx, sy, sw, sh] of segs) {
      g.rect(sx, sy, sw, sh).fill(wallFill);
      g.rect(sx, sy, sw, sh).stroke({ width: 2, color: wallEdge });
      bodies.push(Matter.Bodies.rectangle(sx + sw / 2, sy + sh / 2, sw, sh, { isStatic: true, label: 'wall' }));
    }
    this.world.addChild(g);
    Matter.Composite.add(this.engine.world, bodies);
  }

  _spawn() {
    const plan = layoutRoom(this.room, this.bounds);

    // Player
    this.player = createPlayer(this.ctx, plan.playerStart);
    this.player.addTo(this.world, this.engine.world);

    // NPC (guide)
    if (this.room.npc) {
      this.npc = createEntity(this.ctx, { ...this.room.npc, entityType: 'npc' }, plan.npcPos);
      this.npc.addTo(this.world);
    }

    // Collectibles + hazards
    for (const spec of this.room.entities) {
      const pos = plan.positions.get(spec.id) || plan.doorPos;
      const ent = createEntity(this.ctx, spec, pos);
      ent.addTo(this.world, this.engine.world);
      if (spec.entityType === 'hazard') this.hazards.push(ent);
      else this.collectibles.push(ent);
    }

    // Exit door
    this.door = createEntity(this.ctx, { ...this.room.door, entityType: 'exit-gate' }, plan.doorPos);
    this.door.addTo(this.world, this.engine.world);
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const c of this.collectibles) {
      if (c.spec.entityType === 'key-item' || c.spec.entityType === 'quest-objective') {
        q.register(this.room.id, {
          id: c.spec.id,
          label: `${c.isKey ? 'Collect' : 'Complete'}: ${c.spec.label}`,
          kind: c.isKey ? 'collect' : 'sequence',
          reward: c.spec.reward,
        });
      }
    }
    if (this.npc) {
      q.register(this.room.id, {
        id: `talk-${this.room.id}`,
        label: `Talk to ${this.room.npc.label}`,
        kind: 'talk',
        optional: true,
        reward: { xp: 10 },
      });
    }
    q.register(this.room.id, {
      id: `unlock-${this.room.id}`,
      label: this.door.isFinal ? 'Unlock the final gate' : 'Unlock the exit gate',
      kind: 'unlock',
      reward: this.room.door.reward || { xp: 40 },
    });
  }

  update(dt) {
    // --- Fixed-step physics ---
    this._acc += dt;
    let guard = 0;
    const axis = this.ctx.input.getAxis();
    while (this._acc >= STEP && guard < 5) {
      this.player.drive(axis);
      Matter.Engine.update(this.engine, STEP * 1000);
      this._acc -= STEP;
      guard++;
    }

    // --- Visual sync ---
    this.player.sync(dt);
    const ppos = this.player.position;
    for (const c of this.collectibles) c.update(dt);
    for (const h of this.hazards) h.update(dt);
    this.npc?.update(dt, ppos);
    this.door.update(dt);

    // --- Auto-pickup ---
    for (const c of this.collectibles) {
      if (!c.collected && c.isNear(ppos)) {
        const reward = c.collect();
        if (c.isKey) this.ctx.state.addKey(c.spec.id, { id: c.spec.id, label: c.spec.label, icon: 'key' });
        this.ctx.quests.complete(c.spec.id);
        this.ctx.state.logEvent(`Collected ${c.spec.label} (+${reward.xp || 0} XP)`);
      }
    }

    // --- Hazards ---
    for (const h of this.hazards) {
      const note = h.touch(ppos);
      if (note) {
        this.ctx.quests.fail(`hazard-${h.spec.id}`, 10);
        this.ctx.state.set({ hint: `⚠ ${note}` });
      }
    }

    // --- Interaction (E / tap) ---
    if (this.ctx.input.consumeInteract()) this._handleInteract(ppos);

    // --- Camera follow (only if room bigger than viewport) ---
    this._updateCamera(ppos);

    // --- Exit through an unlocked door ---
    if (!this.door.locked && !this._exited) {
      const d = Math.hypot(ppos.x - this.door.position.x, ppos.y - this.door.position.y);
      if (d < 34) {
        this._exited = true;
        this.ctx.state.clearRoom(this.room.id);
        this.onExit?.();
      }
    }
  }

  _handleInteract(ppos) {
    // Talk to NPC
    if (this.npc && this.npc.isNear(ppos)) {
      this.npc.talkedTo = true;
      this.ctx.quests.complete(`talk-${this.room.id}`);
      const tree = DialogueEngine.synthesize(this.room.npc, this.room);
      this.openDialogue?.(tree);
      return;
    }
    // Try the door
    if (this.door.isNear(ppos)) {
      if (this.door.locked) {
        const keysOk = this.door.requirementsMet(this.ctx.state);
        const objsOk = this._objectivesReadyForExit();
        if (keysOk && objsOk) {
          this.door.unlock(this.engine.world);
          this.ctx.quests.complete(`unlock-${this.room.id}`);
          this.ctx.state.set({ hint: this.door.isFinal ? 'The final gate is open — step through to finish!' : 'Gate open — step through to the next room.' });
        } else {
          const missingKeys = this.door.missingSummary(this.ctx.state);
          const msg = !keysOk
            ? `Gate needs ${missingKeys} more key item(s). Collect them first.`
            : 'Finish the room objectives before unlocking.';
          this.ctx.state.set({ hint: `🔒 ${msg}` });
          this.ctx.audio?.play('failure');
        }
      }
    }
  }

  /** Room is exit-ready when all non-optional, non-unlock objectives are done. */
  _objectivesReadyForExit() {
    return this.ctx.quests
      .roomList(this.room.id)
      .filter((o) => !o.optional && o.kind !== 'unlock')
      .every((o) => o.done);
  }

  _updateCamera(ppos) {
    const size = this.ctx.runtime.size();
    if (this.bounds.w <= size.width && this.bounds.h <= size.height) {
      this.world.x = (size.width - this.bounds.w) / 2 - WALL;
      this.world.y = (size.height - this.bounds.h) / 2 - WALL;
      return;
    }
    const targetX = size.width / 2 - ppos.x;
    const targetY = size.height / 2 - ppos.y;
    const minX = size.width - (this.bounds.w + WALL);
    const minY = size.height - (this.bounds.h + WALL);
    this.world.x += (clamp(targetX, minX, WALL) - this.world.x) * 0.12;
    this.world.y += (clamp(targetY, minY, WALL) - this.world.y) * 0.12;
  }

  resize() {
    /* Room keeps its enter-time layout; camera recenters each frame. */
  }

  exit() {
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
