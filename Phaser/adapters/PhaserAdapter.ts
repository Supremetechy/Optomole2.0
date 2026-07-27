import Phaser from "phaser";
import {
  Scene as SceneSchema,
  Entity,
  Event,
  Action,
  TransformComponent,
  RenderComponent,
  PhysicsComponent,
  InputComponent,
} from "../dsl/types";
import { EngineAdapter } from "../runtime/EngineAdapter";
import { MusicBus } from "../runtime/MusicBus";

export interface PhaserAdapterConfig {
  pixelsPerUnit: number;
  worldHeight: number; // pixels; DSL y-up origin maps to this baseline
  offsetX: number; // pixels; shifts DSL x=0 into view
  gravityY: number; // DSL units/s² (negative = down), e.g. -9.81
}

type ArcadeSprite = Phaser.Physics.Arcade.Sprite;

interface EntityRecord {
  entity: Entity;
  sprite: ArcadeSprite;
  physics?: PhysicsComponent;
}

export class PhaserAdapter implements EngineAdapter {
  private scene: Phaser.Scene;
  private cfg: PhaserAdapterConfig;
  private records = new Map<string, EntityRecord>();
  private eventQueue: Event[] = [];
  private inputKeys = new Map<string, Phaser.Input.Keyboard.Key[]>();
  /** What SetMusicIntensity moves. Silent until the first key press. */
  private music = new MusicBus();
  private inputState: Record<string, boolean> = {};
  private touchingPairs = new Set<string>();
  private framePairs = new Set<string>();
  private messageText: Phaser.GameObjects.Text | null = null;
  // Colliders outlive the sprites they were wired to, so a multi-scene bundle
  // would accumulate dead pairs on every LoadScene unless we drop them.
  private colliders: Phaser.Physics.Arcade.Collider[] = [];

  constructor(scene: Phaser.Scene, config: PhaserAdapterConfig) {
    this.scene = scene;
    this.cfg = config;
  }

  // DSL space is meters, y-up; Phaser is pixels, y-down.
  private toX(x: number): number {
    return this.cfg.offsetX + x * this.cfg.pixelsPerUnit;
  }
  private toY(y: number): number {
    return this.cfg.worldHeight - y * this.cfg.pixelsPerUnit;
  }

  createScene(_sceneSchema: SceneSchema): void {
    this.scene.physics.world.gravity.y = -this.cfg.gravityY * this.cfg.pixelsPerUnit;
  }

  destroyScene(_sceneId: string): void {
    for (const collider of this.colliders) collider.destroy();
    this.colliders = [];
    for (const id of [...this.records.keys()]) this.destroyEntity(id);
    this.touchingPairs.clear();
    this.inputKeys.clear();
    this.inputState = {};
    this.messageText?.destroy();
    this.messageText = null;
  }

  createEntity(entity: Entity): void {
    const transform = entity.components.find(
      (c): c is TransformComponent => c.type === "TransformComponent"
    );
    const render = entity.components.find(
      (c): c is RenderComponent => c.type === "RenderComponent"
    );
    const physics = entity.components.find(
      (c): c is PhysicsComponent => c.type === "PhysicsComponent"
    );
    const input = entity.components.find(
      (c): c is InputComponent => c.type === "InputComponent"
    );
    if (!transform || !render) {
      console.warn(`Entity ${entity.id} missing Transform/Render component`);
      return;
    }

    const sprite = this.scene.add.sprite(
      this.toX(transform.position.x),
      this.toY(transform.position.y),
      render.spriteId
    ) as ArcadeSprite;
    const scale = transform.scale ?? { x: 1, y: 1, z: 1 };
    sprite.setScale(scale.x, scale.y);

    if (physics) {
      const isStatic = physics.bodyType === "static";
      this.scene.physics.add.existing(sprite, isStatic);
      if (!isStatic) {
        (sprite.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
      }
    }

    if (input) this.bindInput(input);

    const record: EntityRecord = { entity, sprite, physics };
    // Wire collisions against every already-created entity whose tags match.
    for (const other of this.records.values()) {
      this.wirePair(record, other);
    }
    this.records.set(entity.id, record);
  }

  destroyEntity(entityId: string): void {
    const record = this.records.get(entityId);
    if (record) {
      record.sprite.destroy();
      this.records.delete(entityId);
    }
  }

  pollEngineEvents(): Event[] {
    const events = [...this.eventQueue];
    this.eventQueue = [];
    return events;
  }

  applyAction(action: Action): void {
    const p = action.parameters;
    switch (action.type) {
      case "PlayAnimation": {
        const sprite = this.records.get(p.entityId)?.sprite;
        if (!sprite) break;
        // Prototype: generated single-frame textures stand in for animations.
        if (this.scene.anims.exists(p.animationId)) sprite.play(p.animationId);
        else if (this.scene.textures.exists(p.animationId)) sprite.setTexture(p.animationId);
        break;
      }
      case "ApplyHorizontalMovementFromInput": {
        const sprite = this.records.get(p.entityId)?.sprite;
        const body = sprite?.body as Phaser.Physics.Arcade.Body | undefined;
        if (!body) break;
        let dir = 0;
        if (this.inputState["MoveLeft"]) dir -= 1;
        if (this.inputState["MoveRight"]) dir += 1;
        body.setVelocityX(dir * (p.speed ?? 0) * this.cfg.pixelsPerUnit);
        if (dir !== 0 && sprite) sprite.setFlipX(dir < 0);
        break;
      }
      case "ApplyPlanarMovementFromInput": {
        const sprite = this.records.get(p.entityId)?.sprite;
        const body = sprite?.body as Phaser.Physics.Arcade.Body | undefined;
        if (!body) break;
        let dx = 0;
        let dy = 0;
        if (this.inputState["MoveLeft"]) dx -= 1;
        if (this.inputState["MoveRight"]) dx += 1;
        if (this.inputState["MoveUp"]) dy += 1; // DSL y-up
        if (this.inputState["MoveDown"]) dy -= 1;
        // Normalize so a diagonal is not √2 faster than an axis.
        const length = Math.hypot(dx, dy) || 1;
        const speedPx = (p.speed ?? 0) * this.cfg.pixelsPerUnit;
        body.setVelocityX((dx / length) * speedPx);
        body.setVelocityY(-(dy / length) * speedPx); // DSL y-up → Phaser y-down
        if (dx !== 0 && sprite) sprite.setFlipX(dx < 0);
        break;
      }
      case "ApplyImpulse": {
        const body = this.records.get(p.entityId)?.sprite
          .body as Phaser.Physics.Arcade.Body | undefined;
        if (!body) break;
        const force = (p.force ?? 0) * this.cfg.pixelsPerUnit;
        const direction = p.direction ?? { x: 0, y: 1 };
        // DSL y-up → Phaser y-down.
        body.velocity.x += direction.x * force;
        body.velocity.y += -direction.y * force;
        break;
      }
      case "PatrolBetweenPoints": {
        const sprite = this.records.get(p.entityId)?.sprite;
        const body = sprite?.body as Phaser.Physics.Arcade.Body | undefined;
        if (!sprite || !body) break;
        const leftPx = this.toX(p.left ?? 0);
        const rightPx = this.toX(p.right ?? 0);
        const speedPx = (p.speed ?? 1) * this.cfg.pixelsPerUnit;
        if (body.velocity.x === 0) body.setVelocityX(speedPx);
        if (sprite.x <= leftPx) body.setVelocityX(speedPx);
        else if (sprite.x >= rightPx) body.setVelocityX(-speedPx);
        sprite.setFlipX(body.velocity.x < 0);
        break;
      }
      // ---- combat movement ----
      // targetTag was already resolved to targetEntityId by the core.
      case "ApplyMovementTowardTarget":
      case "ApplyMovementAwayFromTarget":
      case "ApplyOrbitMovement":
      case "ApplyStandoffMovement": {
        const sprite = this.records.get(p.entityId)?.sprite;
        const target = this.records.get(p.targetEntityId)?.sprite;
        const body = sprite?.body as Phaser.Physics.Arcade.Body | undefined;
        if (!sprite || !target || !body) break;
        const gapPx = target.x - sprite.x;
        const speedPx = (p.speed ?? 1) * this.cfg.pixelsPerUnit;
        let dir = 0;
        if (action.type === "ApplyMovementTowardTarget") {
          const stopPx = (p.stopDistance ?? 0) * this.cfg.pixelsPerUnit;
          dir = Math.abs(gapPx) <= stopPx ? 0 : Math.sign(gapPx);
        } else if (action.type === "ApplyMovementAwayFromTarget") {
          dir = -(Math.sign(gapPx) || 1);
        } else if (action.type === "ApplyStandoffMovement") {
          // Hold a band: back off inside it, close outside it, stand within it.
          const offsetPx = sprite.x - target.x;
          const distancePx = Math.abs(offsetPx);
          const side = Math.sign(offsetPx) || 1;
          dir =
            distancePx < (p.minRange ?? 3) * this.cfg.pixelsPerUnit
              ? side
              : distancePx > (p.maxRange ?? 6) * this.cfg.pixelsPerUnit
                ? -side
                : 0;
        } else {
          // Circling in a side-scroller: hold station at the orbit radius.
          const radiusPx = (p.radius ?? 4) * this.cfg.pixelsPerUnit;
          const side = Math.sign(sprite.x - target.x) || 1;
          dir = Math.abs(sprite.x - target.x) < radiusPx ? side : -side;
        }
        body.setVelocityX(dir * speedPx);
        if (dir !== 0) sprite.setFlipX(dir < 0);
        break;
      }
      case "ApplyAttack": {
        // Damage is resolved by the core; the adapter only shows the hit.
        const target = p.targetEntityId ? this.records.get(p.targetEntityId)?.sprite : undefined;
        if (!target) break;
        this.scene.tweens.add({ targets: target, alpha: 0.4, duration: 90, yoyo: true });
        break;
      }
      case "FireProjectile": {
        // The shot's arrival is the core's business (it lands on `travelTime`);
        // the release is the adapter's, so it flashes the muzzle, not the target.
        const shooter = p.entityId ? this.records.get(p.entityId)?.sprite : undefined;
        if (!shooter) break;
        this.scene.tweens.add({ targets: shooter, alpha: 0.5, duration: 70, yoyo: true });
        break;
      }
      case "EvaluateSpawnBudget":
      case "TriggerBreather":
        // The core already resolved these: reinforcements are spawned through
        // createEntity, and a breather has already suspended the region's
        // budget. They arrive here only as a presentation hook (a HUD cue, a
        // camera beat), which this prototype does not draw.
        break;
      case "SetMusicIntensity":
        // The core already folded the curve into the region's compiled loudness;
        // this only turns the knob.
        this.music.setIntensity(Number(p.resolvedIntensity ?? p.intensity ?? 0));
        break;
      case "PlayCutsceneOrDialogue": {
        this.applyAction({
          ...action,
          type: "ShowMessage",
          parameters: { text: String(p.label ?? p.contentRef ?? "") },
        });
        break;
      }
      case "ShowMessage": {
        this.messageText?.destroy();
        this.messageText = this.scene.add
          .text(this.scene.scale.width / 2, 40, p.text ?? "", {
            fontSize: "24px",
            color: "#ffffff",
            backgroundColor: "#00000088",
            padding: { x: 12, y: 6 },
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(1000);
        const text = this.messageText;
        this.scene.time.delayedCall(2500, () => {
          if (this.messageText === text) {
            text.destroy();
            this.messageText = null;
          }
        });
        break;
      }
      case "DespawnEntity":
        this.destroyEntity(p.entityId);
        break;
      default:
        console.warn(`PhaserAdapter: unhandled action ${action.type}`);
    }
  }

  update(_deltaTime: number): void {
    // Poll bound keys → input state; emit OnInput while held or on change.
    let changed = false;
    let anyDown = false;
    for (const [action, keys] of this.inputKeys.entries()) {
      const down = keys.some(k => k.isDown);
      if (down !== !!this.inputState[action]) changed = true;
      this.inputState[action] = down;
      if (down) anyDown = true;
    }
    // Browsers refuse to start audio without a gesture; the first key is it.
    if (anyDown) this.music.resume();
    if (changed || anyDown) {
      this.eventQueue.push({
        id: "input_tick",
        type: "OnInput",
        payload: { inputState: { ...this.inputState } },
      });
    }

    // Contacts that stopped this frame are forgotten so re-contact re-fires.
    for (const pair of [...this.touchingPairs]) {
      if (!this.framePairs.has(pair)) this.touchingPairs.delete(pair);
    }
    this.framePairs.clear();
  }

  getEntityHandle(entityId: string): ArcadeSprite | undefined {
    return this.records.get(entityId)?.sprite;
  }

  /** Sprites live in pixels, y-down; the core asks in DSL units, y-up. */
  getEntityPosition(entityId: string) {
    const sprite = this.records.get(entityId)?.sprite;
    if (!sprite) return undefined;
    return {
      x: (sprite.x - this.cfg.offsetX) / this.cfg.pixelsPerUnit,
      y: (this.cfg.worldHeight - sprite.y) / this.cfg.pixelsPerUnit,
      z: 0,
    };
  }

  // ---- internals ----

  private bindInput(input: InputComponent): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;
    for (const binding of input.bindings) {
      const keys = binding.keys
        .map(name => this.toKeyCode(name))
        .filter((code): code is number => code !== undefined)
        .map(code => keyboard.addKey(code, false));
      this.inputKeys.set(binding.action, keys);
    }
  }

  private toKeyCode(name: string): number | undefined {
    const normalized = name.endsWith("Arrow")
      ? name.slice(0, -5).toUpperCase()
      : name.toUpperCase();
    return (Phaser.Input.Keyboard.KeyCodes as Record<string, number>)[normalized];
  }

  // A collides with B when either lists a tag the other carries.
  private wirePair(a: EntityRecord, b: EntityRecord): void {
    if (!a.physics || !b.physics) return;
    const matches =
      a.physics.collisionTags.some(t => b.entity.tags.includes(t)) ||
      b.physics.collisionTags.some(t => a.entity.tags.includes(t));
    if (!matches) return;

    // Solid contact for ground/world; sensor overlap for goals and enemies.
    const solid =
      a.entity.tags.includes("ground") || b.entity.tags.includes("ground");
    const handler = () => this.reportContact(a, b);
    this.colliders.push(
      solid
        ? this.scene.physics.add.collider(a.sprite, b.sprite, handler)
        : this.scene.physics.add.overlap(a.sprite, b.sprite, handler)
    );
  }

  private reportContact(a: EntityRecord, b: EntityRecord): void {
    const pair = [a.entity.id, b.entity.id].sort().join("|");
    this.framePairs.add(pair);
    if (this.touchingPairs.has(pair)) return; // only fresh contacts emit
    this.touchingPairs.add(pair);

    // Approximate contact normal: dynamic body resting on something below.
    const dynamic = a.physics?.bodyType === "dynamic" ? a : b;
    const body = dynamic.sprite.body as Phaser.Physics.Arcade.Body | null;
    const normalY = body && (body.touching.down || body.blocked.down) ? 1 : 0;

    this.eventQueue.push({
      id: `collision_${pair}`,
      type: "OnCollision",
      sourceEntityId: a.entity.id,
      targetEntityId: b.entity.id,
      payload: { normalY },
    });
  }
}
