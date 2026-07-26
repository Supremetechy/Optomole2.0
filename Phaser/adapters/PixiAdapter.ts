import { Container, Sprite, Text, Texture } from "pixi.js";
import {
  Action,
  Entity,
  Event,
  InputComponent,
  PhysicsComponent,
  RenderComponent,
  Scene as SceneSchema,
  TransformComponent,
} from "../dsl/types";
import { EngineAdapter } from "../runtime/EngineAdapter";
import { componentOf } from "../runtime/GameplayBundle";

/**
 * PixiAdapter — the second engine behind the same Gameplay DSL.
 *
 * Where PhaserAdapter delegates simulation to Phaser's arcade physics, this
 * one carries its own AABB solver and keyboard reader, so it shares no engine
 * code with the Phaser path at all. That is the point: if both adapters play
 * the same bundle, the gameplay lives in the DSL, not in either engine.
 *
 * The RuntimeCore is unchanged and unaware of which one it is driving.
 */

export interface PixiAdapterConfig {
  /** World-space container; the host pans this to move the camera. */
  world: Container;
  /** Screen-space container for messages, never panned. */
  overlay: Container;
  /** Placeholder textures keyed by sprite id, built by the host. */
  textures: Map<string, Texture>;
  pixelsPerUnit: number;
  worldHeight: number; // px; DSL y=0 sits at this baseline
  offsetX: number; // px; shifts DSL x=0 into view
  gravityY: number; // DSL units/s² (negative = down)
  worldWidthUnits: number;
  viewportWidth: number; // px; used to centre overlay messages
}

/** A simulated axis-aligned box, in DSL units with a y-up, center origin. */
interface Body {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  vx: number;
  vy: number;
  dynamic: boolean;
  grounded: boolean;
}

interface EntityRecord {
  entity: Entity;
  sprite: Sprite;
  body: Body;
  physics?: PhysicsComponent;
}

interface Pair {
  a: EntityRecord;
  b: EntityRecord;
  solid: boolean;
}

const MESSAGE_MS = 2500;

export class PixiAdapter implements EngineAdapter {
  private cfg: PixiAdapterConfig;
  private records = new Map<string, EntityRecord>();
  private pairs: Pair[] = [];
  private pairsStale = true;
  private eventQueue: Event[] = [];

  private keyCodesByAction = new Map<string, string[]>();
  private heldCodes = new Set<string>();
  private inputState: Record<string, boolean> = {};

  private touchingPairs = new Set<string>();
  private framePairs = new Set<string>();

  private message: Text | null = null;
  private messageTimer: number | null = null;

  private onKeyDown = (e: KeyboardEvent) => this.heldCodes.add(e.code);
  private onKeyUp = (e: KeyboardEvent) => this.heldCodes.delete(e.code);
  private onBlur = () => this.heldCodes.clear();

  constructor(config: PixiAdapterConfig) {
    this.cfg = config;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** Release the global key listeners this adapter installed. */
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  // DSL space is meters, y-up; the canvas is pixels, y-down.
  private toX(x: number): number {
    return this.cfg.offsetX + x * this.cfg.pixelsPerUnit;
  }
  private toY(y: number): number {
    return this.cfg.worldHeight - y * this.cfg.pixelsPerUnit;
  }

  createScene(_scene: SceneSchema): void {
    this.clearMessage();
  }

  destroyScene(_sceneId: string): void {
    for (const id of [...this.records.keys()]) this.destroyEntity(id);
    this.touchingPairs.clear();
    this.framePairs.clear();
    this.keyCodesByAction.clear();
    this.inputState = {};
    this.clearMessage();
  }

  createEntity(entity: Entity): void {
    const transform = componentOf<TransformComponent>(entity, "TransformComponent");
    const render = componentOf<RenderComponent>(entity, "RenderComponent");
    const physics = componentOf<PhysicsComponent>(entity, "PhysicsComponent");
    const input = componentOf<InputComponent>(entity, "InputComponent");
    if (!transform || !render) {
      console.warn(`Entity ${entity.id} missing Transform/Render component`);
      return;
    }

    const texture = this.cfg.textures.get(render.spriteId);
    if (!texture) {
      console.warn(`No texture for sprite ${render.spriteId}`);
      return;
    }

    const scale = transform.scale ?? { x: 1, y: 1, z: 1 };
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(scale.x, scale.y);
    sprite.x = this.toX(transform.position.x);
    sprite.y = this.toY(transform.position.y);
    this.cfg.world.addChild(sprite);

    // Collider dimensions are base units; transform scale stretches them.
    const collider = physics?.colliderShape;
    const baseW = collider?.width ?? (collider?.radius ? collider.radius * 2 : texture.width / this.cfg.pixelsPerUnit);
    const baseH = collider?.height ?? (collider?.radius ? collider.radius * 2 : texture.height / this.cfg.pixelsPerUnit);
    const body: Body = {
      x: transform.position.x,
      y: transform.position.y,
      halfW: (baseW * scale.x) / 2,
      halfH: (baseH * scale.y) / 2,
      vx: 0,
      vy: 0,
      dynamic: physics?.bodyType === "dynamic",
      grounded: false,
    };

    if (input) this.bindInput(input);

    this.records.set(entity.id, { entity, sprite, body, physics });
    this.pairsStale = true;
  }

  destroyEntity(entityId: string): void {
    const record = this.records.get(entityId);
    if (!record) return;
    record.sprite.destroy();
    this.records.delete(entityId);
    this.pairsStale = true;
  }

  pollEngineEvents(): Event[] {
    const events = [...this.eventQueue];
    this.eventQueue = [];
    return events;
  }

  applyAction(action: Action): void {
    const p = action.parameters;
    const record = p.entityId ? this.records.get(p.entityId) : undefined;
    switch (action.type) {
      case "PlayAnimation": {
        const texture = this.cfg.textures.get(p.animationId);
        if (record && texture) record.sprite.texture = texture;
        break;
      }
      case "ApplyHorizontalMovementFromInput": {
        if (!record) break;
        let dir = 0;
        if (this.inputState["MoveLeft"]) dir -= 1;
        if (this.inputState["MoveRight"]) dir += 1;
        record.body.vx = dir * (p.speed ?? 0);
        if (dir !== 0) this.face(record, dir);
        break;
      }
      case "ApplyImpulse": {
        if (!record) break;
        const force = p.force ?? 0;
        const direction = p.direction ?? { x: 0, y: 1 };
        // Bodies are y-up like the DSL, so an upward impulse adds to vy.
        record.body.vx += direction.x * force;
        record.body.vy += direction.y * force;
        break;
      }
      case "PatrolBetweenPoints": {
        if (!record) break;
        const speed = p.speed ?? 1;
        const left = p.left ?? 0;
        const right = p.right ?? 0;
        if (record.body.vx === 0) record.body.vx = speed;
        if (record.body.x <= left) record.body.vx = speed;
        else if (record.body.x >= right) record.body.vx = -speed;
        this.face(record, record.body.vx);
        break;
      }
      // ---- combat movement ----
      // The core has already resolved targetTag -> targetEntityId; the adapter
      // only moves a body toward/away from/around a known position.
      case "ApplyMovementTowardTarget": {
        const target = this.records.get(p.targetEntityId);
        if (!record || !target) break;
        const gap = target.body.x - record.body.x;
        const stopDistance = p.stopDistance ?? 0;
        const dir = Math.abs(gap) <= stopDistance ? 0 : Math.sign(gap);
        record.body.vx = dir * (p.speed ?? 1);
        if (dir !== 0) this.face(record, dir);
        break;
      }
      case "ApplyMovementAwayFromTarget": {
        const target = this.records.get(p.targetEntityId);
        if (!record || !target) break;
        const dir = Math.sign(record.body.x - target.body.x) || 1;
        record.body.vx = dir * (p.speed ?? 1);
        this.face(record, dir);
        break;
      }
      case "ApplyOrbitMovement": {
        const target = this.records.get(p.targetEntityId);
        if (!record || !target) break;
        // A 2D side-scroller has no orbit, so circling reads as pacing back and
        // forth at the hold radius — the same intent the compiler expressed.
        const radius = p.radius ?? 4;
        const offset = record.body.x - target.body.x;
        const side = Math.sign(offset) || 1;
        const dir = Math.abs(offset) < radius ? side : -side;
        record.body.vx = dir * (p.speed ?? 1);
        this.face(record, dir);
        break;
      }
      case "ApplyAttack": {
        // Damage is resolved by the core; the adapter only shows the hit.
        const target = p.targetEntityId ? this.records.get(p.targetEntityId) : undefined;
        if (target) this.flash(target);
        break;
      }
      case "SetMusicIntensity":
      case "EvaluateSpawnBudget":
      case "TriggerBreather":
        // Director output. Audio and spawn budgets are not wired in this
        // prototype; the values arrive pre-resolved so wiring them is additive.
        break;
      case "PlayCutsceneOrDialogue": {
        this.showMessage(String(p.label ?? p.contentRef ?? ""));
        break;
      }
      case "ShowMessage": {
        this.showMessage(String(p.text ?? ""));
        break;
      }
      case "DespawnEntity":
        this.destroyEntity(p.entityId);
        break;
      default:
        console.warn(`PixiAdapter: unhandled action ${action.type}`);
    }
  }

  /** Brief tint so a landed hit is visible without an animation pipeline. */
  private flash(record: { sprite: Sprite }): void {
    const sprite = record.sprite;
    sprite.alpha = 0.45;
    setTimeout(() => {
      if (!sprite.destroyed) sprite.alpha = 1;
    }, 120);
  }

  update(deltaTime: number): void {
    this.readInput();
    this.integrate(deltaTime);
    this.resolveCollisions();
    this.syncSprites();

    // Contacts that stopped this frame are forgotten so re-contact re-fires.
    for (const pair of [...this.touchingPairs]) {
      if (!this.framePairs.has(pair)) this.touchingPairs.delete(pair);
    }
    this.framePairs.clear();
  }

  getEntityHandle(entityId: string): Sprite | undefined {
    return this.records.get(entityId)?.sprite;
  }

  /** Bodies are already in DSL units (meters, y-up), so no conversion is needed. */
  getEntityPosition(entityId: string) {
    const body = this.records.get(entityId)?.body;
    return body ? { x: body.x, y: body.y, z: 0 } : undefined;
  }

  // ---- input ----

  private bindInput(input: InputComponent): void {
    for (const binding of input.bindings) {
      this.keyCodesByAction.set(binding.action, binding.keys.map(toKeyCode));
    }
  }

  private readInput(): void {
    let changed = false;
    let anyDown = false;
    for (const [action, codes] of this.keyCodesByAction.entries()) {
      const down = codes.some(code => this.heldCodes.has(code));
      if (down !== !!this.inputState[action]) changed = true;
      this.inputState[action] = down;
      if (down) anyDown = true;
    }
    if (changed || anyDown) {
      this.eventQueue.push({
        id: "input_tick",
        type: "OnInput",
        payload: { inputState: { ...this.inputState } },
      });
    }
  }

  // ---- physics ----

  private integrate(dt: number): void {
    for (const { body } of this.records.values()) {
      if (!body.dynamic) continue;
      body.grounded = false;
      body.vy += this.cfg.gravityY * dt;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
    }
  }

  private resolveCollisions(): void {
    if (this.pairsStale) this.rebuildPairs();

    // Solid contacts first: separation decides `grounded`, which the sensor
    // pass reports as the contact normal.
    for (const pair of this.pairs) {
      if (!pair.solid) continue;
      if (this.separate(pair.a, pair.b)) this.reportContact(pair.a, pair.b);
    }
    for (const pair of this.pairs) {
      if (pair.solid) continue;
      if (overlaps(pair.a.body, pair.b.body)) this.reportContact(pair.a, pair.b);
    }

    // Keep dynamic bodies inside the world so a fall never loses the player.
    for (const { body } of this.records.values()) {
      if (!body.dynamic) continue;
      const minX = body.halfW;
      const maxX = this.cfg.worldWidthUnits - body.halfW;
      if (body.x < minX) {
        body.x = minX;
        body.vx = 0;
      } else if (maxX > minX && body.x > maxX) {
        body.x = maxX;
        body.vx = 0;
      }
    }
  }

  /** Push overlapping bodies apart on the axis of least penetration. */
  private separate(a: EntityRecord, b: EntityRecord): boolean {
    const bodyA = a.body;
    const bodyB = b.body;
    if (!bodyA.dynamic && !bodyB.dynamic) return false;
    if (!overlaps(bodyA, bodyB)) return false;

    const dx = bodyB.x - bodyA.x;
    const dy = bodyB.y - bodyA.y;
    const overlapX = bodyA.halfW + bodyB.halfW - Math.abs(dx);
    const overlapY = bodyA.halfH + bodyB.halfH - Math.abs(dy);

    // Split the correction between two dynamic bodies; a static one absorbs none.
    const shareA = bodyA.dynamic ? (bodyB.dynamic ? 0.5 : 1) : 0;
    const shareB = bodyB.dynamic ? (bodyA.dynamic ? 0.5 : 1) : 0;

    if (overlapX < overlapY) {
      const push = dx > 0 ? -overlapX : overlapX;
      bodyA.x += push * shareA;
      bodyB.x -= push * shareB;
      if (bodyA.dynamic) bodyA.vx = 0;
      if (bodyB.dynamic) bodyB.vx = 0;
    } else {
      const push = dy > 0 ? -overlapY : overlapY;
      bodyA.y += push * shareA;
      bodyB.y -= push * shareB;
      // Whoever got pushed up is standing on the other.
      if (bodyA.dynamic) {
        if (push > 0) bodyA.grounded = true;
        bodyA.vy = 0;
      }
      if (bodyB.dynamic) {
        if (push < 0) bodyB.grounded = true;
        bodyB.vy = 0;
      }
    }
    return true;
  }

  private rebuildPairs(): void {
    const records = [...this.records.values()];
    this.pairs = [];
    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i];
        const b = records[j];
        if (!a.physics || !b.physics) continue;
        // A collides with B when either lists a tag the other carries.
        const matches =
          a.physics.collisionTags.some(t => b.entity.tags.includes(t)) ||
          b.physics.collisionTags.some(t => a.entity.tags.includes(t));
        if (!matches) continue;
        // Solid contact for ground/world; sensor overlap for goals and NPCs.
        const solid = a.entity.tags.includes("ground") || b.entity.tags.includes("ground");
        this.pairs.push({ a, b, solid });
      }
    }
    this.pairsStale = false;
  }

  private reportContact(a: EntityRecord, b: EntityRecord): void {
    const pair = [a.entity.id, b.entity.id].sort().join("|");
    this.framePairs.add(pair);
    if (this.touchingPairs.has(pair)) return; // only fresh contacts emit
    this.touchingPairs.add(pair);

    const dynamic = a.body.dynamic ? a : b;
    this.eventQueue.push({
      id: `collision_${pair}`,
      type: "OnCollision",
      sourceEntityId: a.entity.id,
      targetEntityId: b.entity.id,
      payload: { normalY: dynamic.body.grounded ? 1 : 0 },
    });
  }

  // ---- rendering ----

  private syncSprites(): void {
    for (const { sprite, body } of this.records.values()) {
      sprite.x = this.toX(body.x);
      sprite.y = this.toY(body.y);
    }
  }

  private face(record: EntityRecord, dir: number): void {
    const magnitude = Math.abs(record.sprite.scale.x) || 1;
    record.sprite.scale.x = dir < 0 ? -magnitude : magnitude;
  }

  private showMessage(text: string): void {
    this.clearMessage();
    this.message = new Text({
      text,
      style: { fontFamily: "monospace", fontSize: 22, fill: 0xffffff },
    });
    this.message.anchor.set(0.5, 0);
    this.message.x = this.cfg.viewportWidth / 2;
    this.message.y = 24;
    this.cfg.overlay.addChild(this.message);
    this.messageTimer = window.setTimeout(() => this.clearMessage(), MESSAGE_MS);
  }

  private clearMessage(): void {
    if (this.messageTimer !== null) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    this.message?.destroy();
    this.message = null;
  }
}

// ---- helpers ----

function overlaps(a: Body, b: Body): boolean {
  return (
    Math.abs(a.x - b.x) < a.halfW + b.halfW && Math.abs(a.y - b.y) < a.halfH + b.halfH
  );
}

/** DSL key names → KeyboardEvent.code, the layout-independent identifier. */
function toKeyCode(name: string): string {
  if (name.endsWith("Arrow")) return `Arrow${name.slice(0, -5)}`;
  if (name.length === 1) {
    return /[0-9]/.test(name) ? `Digit${name}` : `Key${name.toUpperCase()}`;
  }
  return name; // Space, Enter, ShiftLeft… already code names
}
