import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCore } from "../runtime/RuntimeCore";
import { EngineAdapter } from "../runtime/EngineAdapter";
import {
  GameplayBundle,
  entrySceneId,
  spriteSpecs,
  worldWidthUnits,
} from "../runtime/GameplayBundle";
import { SKYRUN_BUNDLE } from "../skyrun";
import compiledJson from "../public/sample-bundle.json";

/**
 * These exercise the engine-agnostic half of the stack: a bundle in, actions
 * and events out, with no renderer involved. They are the guard on the claim
 * the whole DSL rests on — that a compiled bundle is playable by construction,
 * so a bad emitter fails here rather than as an empty canvas.
 */

const COMPILED = compiledJson as unknown as GameplayBundle;

/** An adapter that records instead of rendering, and lets tests inject events. */
class StubAdapter implements EngineAdapter {
  created: string[] = [];
  destroyed: string[] = [];
  actions: Array<{ type: string; parameters: Record<string, any> }> = [];
  scenesCreated: string[] = [];
  private queue: any[] = [];

  createScene(scene: any) {
    this.scenesCreated.push(scene.id);
  }
  destroyScene() {
    this.created = [];
  }
  createEntity(entity: any) {
    this.created.push(entity.id);
  }
  destroyEntity(entityId: string) {
    this.destroyed.push(entityId);
  }
  pollEngineEvents() {
    const events = this.queue;
    this.queue = [];
    return events;
  }
  applyAction(action: any) {
    this.actions.push({ type: action.type, parameters: action.parameters });
    // Despawning is adapter-owned in the DSL: real adapters remove the sprite.
    if (action.type === "DespawnEntity") this.destroyEntity(action.parameters.entityId);
  }
  update() {}
  getEntityHandle() {
    return undefined;
  }

  /**
   * Positions the core queries for distance, perception, and target resolution.
   * Tests place entities explicitly so combat is deterministic rather than
   * depending on whatever a physics step produced.
   */
  positions = new Map<string, { x: number; y: number; z: number }>();
  getEntityPosition(entityId: string) {
    return this.positions.get(entityId);
  }
  place(entityId: string, x: number, y = 0) {
    this.positions.set(entityId, { x, y, z: 0 });
  }

  inject(event: any) {
    this.queue.push(event);
  }
  messages() {
    return this.actions.filter(a => a.type === "ShowMessage").map(a => String(a.parameters.text));
  }
  ofType(type: string) {
    return this.actions.filter(a => a.type === type);
  }
}

function boot(bundle: GameplayBundle) {
  const adapter = new StubAdapter();
  const core = new RuntimeCore(adapter);
  core.loadGame(
    bundle.game,
    bundle.scenes,
    bundle.entities,
    bundle.stateMachines,
    bundle.triggers,
    bundle.directors ?? [],
    bundle.sequences ?? []
  );
  core.loadScene(entrySceneId(bundle));
  core.update(1 / 60); // drain the OnSceneEnter emitted by loadScene
  return { adapter, core };
}

test("compiled bundle opens its first scene and announces the region", () => {
  const { adapter } = boot(COMPILED);
  assert.equal(adapter.scenesCreated[0], "scene-1");
  assert.ok(adapter.created.includes("scene-1-player"), "player entity created");
  // Read the name off the bundle rather than hardcoding it: this asserts that
  // the region ANNOUNCES ITSELF, not that a fixture still says one thing.
  const regionName = COMPILED.scenes[0].name;
  assert.ok(
    adapter.messages().some(m => m.includes(regionName)),
    `expected "${regionName}" in ${JSON.stringify(adapter.messages())}`
  );
});

test("collecting an item despawns it and emits a signal carrying its bindingId", () => {
  const { adapter, core } = boot(COMPILED);
  adapter.inject({
    id: "t",
    type: "OnCollision",
    sourceEntityId: "scene-1-player",
    targetEntityId: "scene-1-item-1",
    payload: { normalY: 0 },
  });

  const observed: any[] = [];
  core.subscribe(n => observed.push(n));
  core.update(1 / 60);

  assert.ok(adapter.destroyed.includes("scene-1-item-1"), "collected item despawned");
  const collected = observed.find(
    n => n.kind === "event" && n.event.payload?.kind === "collected"
  );
  assert.ok(collected, "a collected event reached subscribers (the SignalBridge path)");
  assert.equal(collected.event.payload.entityId, "scene-1-item-1");
  assert.ok(collected.event.payload.bindingId, "content stays joinable by bindingId");
});

test("reaching the goal advances to the next scene, and the last scene completes", () => {
  const { adapter, core } = boot(COMPILED);
  adapter.inject({
    id: "t",
    type: "OnCollision",
    sourceEntityId: "scene-1-player",
    targetEntityId: "scene-1-goal",
    payload: { normalY: 0 },
  });
  core.update(1 / 60);

  assert.deepEqual(adapter.scenesCreated, ["scene-1", "scene-2"]);
  assert.ok(adapter.created.includes("scene-2-player"), "the next scene's entities loaded");

  adapter.inject({
    id: "t2",
    type: "OnCollision",
    sourceEntityId: "scene-2-player",
    targetEntityId: "scene-2-goal",
    payload: { normalY: 0 },
  });
  core.update(1 / 60);
  assert.equal(adapter.scenesCreated.length, 2, "the last scene does not load a third");
  assert.ok(adapter.messages().some(m => m.includes("Complete")), "the run is reported complete");
});

test("jump fires only when grounded, and landing restores the ground flag", () => {
  const { adapter, core } = boot(SKYRUN_BUNDLE);

  adapter.inject({ id: "i", type: "OnInput", payload: { inputState: { Jump: true } } });
  core.update(1 / 60);
  assert.ok(
    adapter.actions.some(a => a.type === "ApplyImpulse"),
    "grounded jump applies an impulse"
  );
  assert.equal(core.getVariables("player")?.isGrounded, false);

  // Airborne: a second press must not double-jump.
  const impulsesAfterFirst = adapter.actions.filter(a => a.type === "ApplyImpulse").length;
  adapter.inject({ id: "i2", type: "OnInput", payload: { inputState: { Jump: true } } });
  core.update(1 / 60);
  assert.equal(
    adapter.actions.filter(a => a.type === "ApplyImpulse").length,
    impulsesAfterFirst,
    "no impulse while airborne"
  );

  adapter.inject({
    id: "c",
    type: "OnCollision",
    sourceEntityId: "player",
    targetEntityId: "ground_1",
    payload: { normalY: 1 },
  });
  core.update(1 / 60);
  assert.equal(core.getVariables("player")?.isGrounded, true, "landing re-grounds the player");
});

test("variable references resolve to values before an action reaches the adapter", () => {
  const { adapter, core } = boot(SKYRUN_BUNDLE);
  adapter.inject({ id: "i", type: "OnInput", payload: { inputState: { MoveRight: true } } });
  core.update(1 / 60);

  const move = adapter.actions.find(a => a.type === "ApplyHorizontalMovementFromInput");
  assert.ok(move, "movement action reached the adapter");
  assert.equal(move!.parameters.speed, 5, "speedVar resolved to the entity's moveSpeed");
});

test("a shared state machine targets whichever entity is running it", () => {
  // The compiled bundle reuses one player_state_machine across every scene, so
  // its actions carry no entityId. If the core doesn't fill it in, the adapter
  // has nothing to move and the player is frozen — which is exactly what a
  // renderer-free test has to catch.
  const { adapter, core } = boot(COMPILED);
  adapter.inject({ id: "i", type: "OnInput", payload: { inputState: { MoveRight: true } } });
  core.update(1 / 60);

  const move = adapter.actions.find(a => a.type === "ApplyHorizontalMovementFromInput");
  assert.ok(move, "movement action reached the adapter");
  assert.equal(move!.parameters.entityId, "scene-1-player", "action targets the running entity");
  // The compiled speed, not a constant: it is derived from the source's mood, so
  // hardcoding it here would assert the fixture rather than the resolution.
  const compiledSpeed = (COMPILED.entities.find(e => e.id === "scene-1-player")
    ?.components.find(c => c.type === "StateComponent") as any)?.variables.moveSpeed;
  assert.equal(move!.parameters.speed, compiledSpeed, "speedVar resolved from that entity's variables");

  // And after advancing, the same machine must drive scene 2's player.
  adapter.inject({
    id: "g",
    type: "OnCollision",
    sourceEntityId: "scene-1-player",
    targetEntityId: "scene-1-goal",
    payload: { normalY: 0 },
  });
  core.update(1 / 60);
  adapter.actions.length = 0;
  adapter.inject({ id: "i2", type: "OnInput", payload: { inputState: { MoveRight: true } } });
  core.update(1 / 60);

  const move2 = adapter.actions.find(a => a.type === "ApplyHorizontalMovementFromInput");
  assert.equal(move2?.parameters.entityId, "scene-2-player", "retargets in the next scene");
});

test("placeholder art covers every sprite id a bundle references", () => {
  for (const [name, bundle] of [
    ["skyrun", SKYRUN_BUNDLE],
    ["compiled", COMPILED],
  ] as const) {
    const specs = new Map(spriteSpecs(bundle).map(s => [s.id, s]));

    for (const entity of bundle.entities) {
      const render: any = entity.components.find(c => c.type === "RenderComponent");
      if (!render) continue;
      assert.ok(specs.has(render.spriteId), `${name}: no art for ${render.spriteId}`);
    }
    // Animation targets too: a state that swaps texture must find one waiting.
    for (const machine of bundle.stateMachines) {
      for (const state of machine.states) {
        for (const action of state.onEnterActions ?? []) {
          if (action.type !== "PlayAnimation") continue;
          assert.ok(
            specs.has(action.parameters.animationId),
            `${name}: no art for animation ${action.parameters.animationId}`
          );
        }
      }
    }
    for (const spec of specs.values()) {
      assert.ok(spec.widthUnits > 0 && spec.heightUnits > 0, `${name}: ${spec.id} has no size`);
    }
    assert.ok(worldWidthUnits(bundle) > 0, `${name}: world has no extent`);
  }
});

test("every scene's entity list and trigger references resolve", () => {
  for (const [name, bundle] of [
    ["skyrun", SKYRUN_BUNDLE],
    ["compiled", COMPILED],
  ] as const) {
    const ids = new Set(bundle.entities.map(e => e.id));
    for (const scene of bundle.scenes) {
      for (const entityId of scene.entities) {
        assert.ok(ids.has(entityId), `${name}: scene ${scene.id} wants missing ${entityId}`);
      }
    }
    const machines = new Set(bundle.stateMachines.map(m => m.id));
    for (const entity of bundle.entities) {
      const state: any = entity.components.find(c => c.type === "StateComponent");
      if (!state) continue;
      assert.ok(machines.has(state.stateMachineId), `${name}: missing ${state.stateMachineId}`);
    }
    assert.ok(
      bundle.scenes.some(s => s.id === entrySceneId(bundle)),
      `${name}: entry scene is not in the bundle`
    );
  }
});
