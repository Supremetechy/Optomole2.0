import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCore } from "../runtime/RuntimeCore";
import { EngineAdapter } from "../runtime/EngineAdapter";
import { GameplayBundle } from "../runtime/GameplayBundle";
import {
  arbitrateSquadAttack,
  attritionOf,
  createSquadState,
} from "../runtime/SquadArbiter";
import { sampleCurve } from "../runtime/PacingCurves";
import { MusicBus } from "../runtime/MusicBus";
import { Action, Entity, Event, Scene, TransformComponent, Vector3 } from "../dsl/types";

/**
 * Stage 4 — the three executors a compiled experience needs beyond the original
 * state-machine runner: timers + perception (combat trees), tick-driven
 * directors (pacing, squad arbitration), and beat-ordered sequences (narrative).
 *
 * The claim these guard is that each executor stays dumb: it runs what the
 * compiler already resolved. Every decision about fairness, tension, or gating
 * is asserted to happen in the runtime/compiler, never in an adapter.
 */

class StubAdapter implements EngineAdapter {
  actions: Action[] = [];
  created: string[] = [];
  destroyed: string[] = [];
  positions = new Map<string, Vector3>();
  private queue: Event[] = [];

  createScene() {}
  destroyScene() {}
  createEntity(entity: Entity) {
    this.created.push(entity.id);
    // Place it where its transform says, unless a test has already positioned
    // it — an entity that arrives mid-scene has to be locatable like any other.
    if (this.positions.has(entity.id)) return;
    const transform = entity.components.find(
      (c): c is TransformComponent => c.type === "TransformComponent"
    );
    if (transform) this.positions.set(entity.id, { ...transform.position });
  }
  destroyEntity(entityId: string) {
    this.destroyed.push(entityId);
    this.positions.delete(entityId);
  }
  pollEngineEvents() {
    const events = this.queue;
    this.queue = [];
    return events;
  }
  applyAction(action: Action) {
    this.actions.push(action);
    if (action.type === "DespawnEntity") this.destroyEntity(action.parameters.entityId);
  }
  update() {}
  getEntityHandle() {
    return undefined;
  }
  getEntityPosition(entityId: string) {
    return this.positions.get(entityId);
  }

  inject(event: Event) {
    this.queue.push(event);
  }
  ofType(type: string) {
    return this.actions.filter(a => a.type === type);
  }
}

// ---- fixture: two squadded enemies and a player, as the compiler emits them ----

const SQUAD_ID = "region-1_squad_director";

function enemy(id: string): Entity {
  return {
    id,
    archetype: "enemy",
    tags: ["enemy", "hostile", `squad:${SQUAD_ID}`],
    components: [
      { type: "TransformComponent", position: { x: 0, y: 0, z: 0 } },
      { type: "RenderComponent", spriteId: "enemy_idle", layer: "characters" },
      {
        type: "StateComponent",
        stateMachineId: "enemy_combat_sm",
        initialState: "Idle",
        variables: {
          aggression: 0.6,
          effectiveAggression: 0.6,
          baseSpeed: 5,
          effectiveSpeed: 5,
          health: 50,
          maxHealth: 50,
        },
      },
    ],
  };
}

const PLAYER: Entity = {
  id: "scene-1-player",
  archetype: "hero",
  tags: ["player", "controllable"],
  components: [
    { type: "TransformComponent", position: { x: 0, y: 0, z: 0 } },
    { type: "RenderComponent", spriteId: "player_idle", layer: "characters" },
    {
      type: "StateComponent",
      stateMachineId: "player_sm",
      initialState: "Idle",
      variables: { health: 100, maxHealth: 100 },
    },
  ],
};

const SCENE: Scene = {
  id: "scene-1",
  name: "Server Vault",
  regionId: "region-1",
  systems: ["physics", "input", "combat"],
  entities: ["scene-1-player", "enemy-1", "enemy-2"],
  entryTriggers: [],
  exitTriggers: [],
  directors: [SQUAD_ID, "region-1_pacing_director"],
};

/** The combat tree shape BehaviorCompilerService emits, trimmed to essentials. */
const COMBAT_SM = {
  id: "enemy_combat_sm",
  initialState: "Idle",
  states: [
    { id: "Idle", onEnterActions: [{ id: "idle", type: "PlayAnimation", parameters: { animationId: "enemy_idle" } }] },
    {
      id: "Alert",
      onEnterActions: [
        { id: "react", type: "StartTimer", parameters: { timerId: "reaction", duration: 0.5 } },
      ],
    },
    {
      id: "Approaching",
      onUpdateActions: [
        {
          id: "approach",
          type: "ApplyMovementTowardTarget",
          parameters: { targetTag: "player", speedVar: "effectiveSpeed", stopDistance: 1.5 },
        },
      ],
    },
    {
      id: "Holding",
      onUpdateActions: [
        { id: "circle", type: "ApplyOrbitMovement", parameters: { targetTag: "player", radius: 4, speed: 1.5 } },
      ],
    },
    {
      id: "Telegraphing",
      onEnterActions: [
        { id: "windup", type: "StartTimer", parameters: { timerId: "windup", duration: 0.3 } },
      ],
    },
    {
      id: "Attacking",
      onEnterActions: [
        { id: "hit", type: "ApplyAttack", parameters: { targetTag: "player", damage: 10 } },
        { id: "cool", type: "StartTimer", parameters: { timerId: "cooldown", duration: 1 } },
      ],
    },
  ],
  transitions: [
    {
      fromStateId: "Idle",
      toStateId: "Alert",
      eventType: "OnPerception",
      conditions: [{ id: "seen", type: "TargetInSightRange", parameters: { targetTag: "player", range: 20 } }],
    },
    {
      fromStateId: "Alert",
      toStateId: "Approaching",
      eventType: "OnTimerElapsed",
      conditions: [{ id: "reacted", type: "TimerElapsed", parameters: { timerId: "reaction" } }],
    },
    {
      fromStateId: "Approaching",
      toStateId: "Telegraphing",
      eventType: "OnDistanceCheck",
      priority: 10,
      conditions: [
        { id: "close", type: "WithinRange", parameters: { targetTag: "player", range: 1.5 } },
        { id: "granted", type: "AttackSlotGranted", parameters: {} },
      ],
    },
    {
      fromStateId: "Approaching",
      toStateId: "Holding",
      eventType: "OnDistanceCheck",
      conditions: [
        { id: "close2", type: "WithinRange", parameters: { targetTag: "player", range: 1.5 } },
        { id: "denied", type: "AttackSlotDenied", parameters: {} },
      ],
    },
    {
      fromStateId: "Telegraphing",
      toStateId: "Attacking",
      eventType: "OnTimerElapsed",
      conditions: [{ id: "wound", type: "TimerElapsed", parameters: { timerId: "windup" } }],
    },
  ],
} as any;

const PLAYER_SM = { id: "player_sm", initialState: "Idle", states: [{ id: "Idle" }], transitions: [] } as any;

function bundle(overrides: Partial<GameplayBundle> = {}): GameplayBundle {
  return {
    game: {
      id: "g",
      title: "t",
      version: "1",
      config: { gravity: { x: 0, y: -9.81, z: 0 } },
      scenes: ["scene-1"],
      globalSystems: ["physics"],
    },
    scenes: [SCENE],
    entities: [PLAYER, enemy("enemy-1"), enemy("enemy-2")],
    stateMachines: [PLAYER_SM, COMBAT_SM],
    triggers: [],
    directors: [],
    sequences: [],
    ...overrides,
  };
}

function boot(b: GameplayBundle) {
  const adapter = new StubAdapter();
  const core = new RuntimeCore(adapter);
  core.loadGame(b.game, b.scenes, b.entities, b.stateMachines, b.triggers, b.directors, b.sequences);
  adapter.positions.set("scene-1-player", { x: 10, y: 0, z: 0 });
  adapter.positions.set("enemy-1", { x: 11, y: 0, z: 0 });
  adapter.positions.set("enemy-2", { x: 9, y: 0, z: 0 });
  core.loadScene("scene-1");
  return { adapter, core };
}

/** Advance the core by `seconds` in fixed 1/60 steps. */
function run(core: RuntimeCore, seconds: number) {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) core.update(step);
}

// ---- timers + perception ----

test("a behavior tree advances on the core's own clock, with no player input", () => {
  const { adapter, core } = boot(bundle());
  const seen: Array<{ from: string; to: string }> = [];
  core.subscribe(n => {
    if (n.kind === "transition" && n.entityId === "enemy-1") seen.push({ from: n.from, to: n.to });
  });

  run(core, 1.5);

  const path = seen.map(s => s.to);
  assert.deepEqual(path.slice(0, 2), ["Alert", "Approaching"],
    "perception polling wakes the enemy and its reaction timer releases it");
  assert.ok(
    adapter.ofType("ApplyMovementTowardTarget").length > 0,
    "the approach action reached the adapter"
  );
});

test("the core resolves targetTag to a concrete entity before the adapter sees it", () => {
  const { adapter, core } = boot(bundle());
  run(core, 1.5);
  const move = adapter.ofType("ApplyMovementTowardTarget")[0];
  assert.equal(move.parameters.targetEntityId, "scene-1-player",
    "an adapter never has to search the world for 'the player'");
  assert.equal(move.parameters.speed, 5, "speedVar was resolved to the compiled number");
  assert.equal(move.parameters.entityId, "enemy-1", "the acting entity is filled in from the instance");
});

// ---- squad arbitration ----

test("a squad grants one attacker and holds the rest", () => {
  const squadDirector = {
    id: SQUAD_ID,
    scope: "region" as const,
    targetId: "region-1",
    tickIntervalSeconds: 0.2,
    onTickActions: [
      {
        id: "arb",
        type: "ArbitrateSquadAttack" as const,
        parameters: {
          squadId: SQUAD_ID,
          maxConcurrentAttackers: 1,
          flankBias: 0.4,
          callOutDelay: 0.5,
        },
      },
      {
        id: "bcast",
        type: "BroadcastVariable" as const,
        parameters: { squadId: SQUAD_ID, var: "effectiveAggression", baseVar: "aggression" },
      },
    ],
    scheduledActions: [],
  };

  const { adapter, core } = boot(bundle({ directors: [squadDirector] }));
  // Both enemies stand right on the player, so both want to commit.
  adapter.positions.set("enemy-1", { x: 10.5, y: 0, z: 0 });
  adapter.positions.set("enemy-2", { x: 9.5, y: 0, z: 0 });

  run(core, 2);

  const states = ["enemy-1", "enemy-2"].map(id => ({
    id,
    granted: core.getVariables(id),
  }));
  assert.ok(states.every(s => s.granted), "both enemies are still alive and instanced");

  const holding = adapter.ofType("ApplyOrbitMovement");
  assert.ok(holding.length > 0, "a denied enemy circles instead of standing still");

  // The denied enemy is throttled and the committed one presses — the only
  // thing either of them learns from the coordinator.
  const aggressions = ["enemy-1", "enemy-2"].map(
    id => Number(core.getVariables(id)?.effectiveAggression)
  );
  assert.notEqual(aggressions[0], aggressions[1],
    "effective aggression differs by commitment, and is computed by the coordinator");
});

test("arbitration is pure and prefers spread when flankBias is high", () => {
  const state = createSquadState();
  const candidates = [
    { entityId: "near-same-side", wantsToAttack: true, distanceToTarget: 1, angleToTarget: 0 },
    { entityId: "far-opposite", wantsToAttack: true, distanceToTarget: 2, angleToTarget: Math.PI },
  ];

  // First tick with one slot: nearest wins, because nothing is committed yet.
  const first = arbitrateSquadAttack(state, { maxConcurrentAttackers: 1, flankBias: 1, callOutDelay: 0 }, candidates, 0);
  assert.deepEqual(first.grantedEntityIds, ["near-same-side"]);
  assert.deepEqual(first.deniedEntityIds, ["far-opposite"]);

  // With a slot still free, the next grant favors the flanker over anyone
  // clustered on the committed side.
  const crowd = [
    ...candidates,
    { entityId: "near-same-side-2", wantsToAttack: true, distanceToTarget: 1.1, angleToTarget: 0.05 },
  ];
  const second = arbitrateSquadAttack(state, { maxConcurrentAttackers: 2, flankBias: 1, callOutDelay: 0 }, crowd, 1);
  assert.deepEqual(second.grantedEntityIds, ["far-opposite"], "flankBias spreads the encounter out");
});

test("a thinned squad presses harder rather than fizzling out", () => {
  const state = createSquadState();
  state.initialMemberCount = 4;
  assert.equal(attritionOf(state, 4), 0, "at full strength there is no attrition");
  assert.equal(attritionOf(state, 2), 0.5);
  assert.equal(attritionOf(state, 1), 0.75, "the last enemy is under maximum pressure");

  const fresh = createSquadState();
  assert.equal(attritionOf(fresh, 3), 0, "a squad that has not engaged yet is unscaled");
});

test("a lone enemy is never deadlocked waiting for a coordinator", () => {
  const loner: Entity = { ...enemy("enemy-1"), tags: ["enemy", "hostile"] };
  const solo = bundle({
    entities: [PLAYER, loner],
    scenes: [{ ...SCENE, entities: ["scene-1-player", "enemy-1"], directors: [] }],
  });
  const { adapter, core } = boot(solo);
  adapter.positions.set("enemy-1", { x: 10.5, y: 0, z: 0 });

  const reached: string[] = [];
  core.subscribe(n => {
    if (n.kind === "transition") reached.push(n.to);
  });
  run(core, 2.5);

  assert.ok(reached.includes("Attacking"), "no squad means granted by default");
  assert.ok(
    Number(core.getVariables("scene-1-player")?.health) < 100,
    "the attack actually resolved against the player"
  );
});

// ---- directors + curves ----

test("the director samples the curve so the adapter receives a scalar", () => {
  const pacing = {
    id: "region-1_pacing_director",
    scope: "region" as const,
    targetId: "region-1",
    tickIntervalSeconds: 1,
    onTickActions: [
      {
        id: "spawn",
        type: "EvaluateSpawnBudget" as const,
        parameters: { regionId: "region-1", baseRate: 4, curve: "escalating", density: 0.5 },
      },
    ],
    scheduledActions: [
      {
        id: "breather",
        type: "TriggerBreather" as const,
        repeatEverySeconds: 2,
        parameters: { regionId: "region-1", durationSeconds: 8 },
      },
    ],
  };

  const { adapter, core } = boot(bundle({ directors: [pacing] }));
  run(core, 5);

  const budgets = adapter.ofType("EvaluateSpawnBudget");
  assert.ok(budgets.length >= 4, "the director ticked once per second");
  assert.equal(typeof budgets[0].parameters.tension, "number", "tension arrives pre-sampled");
  assert.ok(
    budgets[budgets.length - 1].parameters.tension > budgets[0].parameters.tension,
    "an escalating curve escalates — and the adapter never had to know that"
  );
  assert.ok(adapter.ofType("TriggerBreather").length >= 2, "scheduled actions repeat on their own interval");
});

// ---- pacing: reinforcements and breathers ----

/**
 * A pacing director tuned for a test: one tick a second, a steady curve, and a
 * base rate that resolves to exactly one spawn per tick. Real compiled rates are
 * 2-6 per minute — the arithmetic is identical, just slower to watch.
 */
function pacingDirector(overrides: {
  density: number;
  breatherEverySeconds?: number;
  breatherDurationSeconds?: number;
}) {
  return {
    id: "region-1_pacing_director",
    scope: "region" as const,
    targetId: "region-1",
    tickIntervalSeconds: 1,
    onTickActions: [
      {
        id: "spawn",
        type: "EvaluateSpawnBudget" as const,
        // steady samples 0.5, so 120/min resolves to 60/min = one per tick.
        parameters: { regionId: "region-1", baseRate: 120, curve: "steady", density: overrides.density },
      },
    ],
    scheduledActions: overrides.breatherEverySeconds
      ? [
          {
            id: "breather",
            type: "TriggerBreather" as const,
            repeatEverySeconds: overrides.breatherEverySeconds,
            parameters: {
              regionId: "region-1",
              durationSeconds: overrides.breatherDurationSeconds ?? 5,
            },
          },
        ]
      : [],
  };
}

const reinforcementsIn = (adapter: StubAdapter) =>
  adapter.created.filter(id => id.includes("-reinforcement-"));

test("a region walks its beat plan on its own clock, and announces each beat", () => {
  const director = {
    ...pacingDirector({ density: 1 }),
    beats: [
      { type: "calm" as const, duration: 2, enemyDensity: 0.1, traversalComplexity: 0.25 },
      { type: "peak" as const, duration: 2, enemyDensity: 1, traversalComplexity: 0.85 },
    ],
  };
  const seen: string[] = [];
  const { core } = boot(bundle({ directors: [director] }));
  core.subscribe(n => {
    if (n.kind === "event" && (n.event.payload as any)?.kind === "beat") {
      seen.push(String((n.event.payload as any).beatType));
    }
  });

  run(core, 5);
  assert.deepEqual(seen, ["calm", "peak", "calm"], "the plan advances on duration and loops");
});

test("a peak may crowd a region where a calm beat may not", () => {
  // Same rate, same region, same two compiled enemies — only the beat differs.
  const withBeats = (beats: any[]) => ({ ...pacingDirector({ density: 1 }), beats });
  const calmOnly = boot(
    bundle({
      directors: [withBeats([{ type: "calm", duration: 600, enemyDensity: 0.1, traversalComplexity: 0.25 }])],
    })
  );
  const peakOnly = boot(
    bundle({
      directors: [withBeats([{ type: "peak", duration: 600, enemyDensity: 1, traversalComplexity: 0.85 }])],
    })
  );

  run(calmOnly.core, 8);
  run(peakOnly.core, 8);

  assert.deepEqual(
    reinforcementsIn(calmOnly.adapter),
    [],
    "a calm beat's density is already met by the enemies the region declared"
  );
  assert.equal(
    reinforcementsIn(peakOnly.adapter).length,
    4,
    "a peak fills the region, and the beat density is what said it could"
  );
});

test("reinforcements top a region back up to its compiled density, and stop there", () => {
  // density 1.0 => six simultaneous enemies allowed; the scene declares two.
  const { adapter, core } = boot(bundle({ directors: [pacingDirector({ density: 1 })] }));

  run(core, 5.5);

  const arrivals = reinforcementsIn(adapter);
  assert.equal(arrivals.length, 4, "the region filled to its density and the budget stopped paying out");
  assert.ok(
    arrivals.every(id => core.getVariables(id) !== undefined),
    "every reinforcement is running a behavior tree, not just a sprite"
  );

  // The cap is on the living, so clearing the region re-opens it.
  run(core, 5);
  assert.equal(reinforcementsIn(adapter).length, 4, "a region at capacity accrues nothing further");
});

test("a region already at its density is never reinforced", () => {
  // density 0.34 => two enemies allowed, which is exactly what the scene has.
  const { adapter, core } = boot(bundle({ directors: [pacingDirector({ density: 0.34 })] }));
  run(core, 10);
  assert.deepEqual(reinforcementsIn(adapter), [], "pacing tops a region up, it does not pile on");
});

test("a breather suspends reinforcements and does not pay the pause back as a wave", () => {
  const breathers: Array<Record<string, any>> = [];
  const { adapter, core } = boot(
    bundle({
      directors: [pacingDirector({ density: 1, breatherEverySeconds: 1, breatherDurationSeconds: 5 })],
    })
  );
  core.subscribe(n => {
    if (n.kind === "event" && n.event.payload?.kind === "breather") breathers.push(n.event.payload);
  });

  run(core, 6);

  assert.equal(
    reinforcementsIn(adapter).length,
    1,
    "one arrival landed before the first breather; the rest of the window stayed quiet"
  );
  assert.ok(breathers.length > 0, "the rest is observable, so telemetry can see the pacing");
  assert.equal(breathers[0].regionId, "region-1", "a breather is scoped to the region that asked for it");
});

test("a reinforcement fights like the enemy it was cloned from, and can be fought back", () => {
  const attackTrigger = {
    id: "player-attack",
    scope: "scene" as const,
    eventType: "OnCustom" as const,
    conditions: [],
    actions: [
      {
        id: "strike",
        type: "ApplyAttack" as const,
        parameters: { entityId: "scene-1-player", targetTag: "enemy", damage: 30, range: 3 },
      },
    ],
  };

  const { adapter, core } = boot(
    bundle({ directors: [pacingDirector({ density: 1 })], triggers: [attackTrigger] })
  );

  const reached: string[] = [];
  run(core, 1.5);
  const arrival = reinforcementsIn(adapter)[0];
  assert.ok(arrival, "a reinforcement arrived");

  assert.equal(
    core.getVariables(arrival)?.health,
    50,
    "it inherited the compiled health of its template, not a runtime default"
  );

  core.subscribe(n => {
    if (n.kind === "transition" && n.entityId === arrival) reached.push(n.to);
  });
  run(core, 1.5);
  assert.ok(reached.includes("Approaching"), "it runs the same combat tree on the same clock");

  // The failure this guards: a reinforcement the compiled scene never declared
  // is invisible to `targetTag`, so it damages a player who cannot damage it.
  adapter.positions.set(arrival, { x: 10.5, y: 0, z: 0 });
  adapter.inject({ id: "s", type: "OnCustom", payload: {} });
  core.update(1 / 60);
  assert.equal(core.getVariables(arrival)?.health, 20, "the player's strike resolved against it");
});

test("loudness is resolved by the core, so the adapter only turns a knob", () => {
  const director = {
    ...pacingDirector({ density: 0.34 }),
    onTickActions: [
      {
        id: "music",
        type: "SetMusicIntensity" as const,
        parameters: { regionId: "region-1", intensity: 0.8, curve: "escalating" },
      },
    ],
  };
  const { adapter, core } = boot(bundle({ directors: [director] }));
  run(core, 5);

  const cues = adapter.ofType("SetMusicIntensity");
  assert.ok(cues.length >= 4, "the director ticked");
  for (const cue of cues) {
    assert.equal(typeof cue.parameters.resolvedIntensity, "number", "a scalar, not a curve name");
    assert.ok(cue.parameters.resolvedIntensity <= cue.parameters.intensity,
      "the curve can only ever hold the region back from its compiled loudness");
  }
  assert.ok(
    Number(cues[cues.length - 1].parameters.resolvedIntensity) > Number(cues[0].parameters.resolvedIntensity),
    "an escalating region gets louder — and the adapter never had to know that"
  );
});

test("the music bus is silent, not broken, where there is no audio", () => {
  // Headless, in a test, or in a browser that blocks it: audio must never be
  // the reason a compiled experience fails to run.
  const bus = new MusicBus();
  assert.equal(bus.available, false, "node has no AudioContext");
  assert.doesNotThrow(() => {
    bus.setIntensity(0.9);
    bus.resume();
    bus.setIntensity(0);
    bus.dispose();
    bus.setIntensity(0.5);
  });
});

test("curve sampling is a pure function of elapsed time", () => {
  assert.equal(sampleCurve("steady", 0), sampleCurve("steady", 500));
  assert.ok(sampleCurve("escalating", 300) > sampleCurve("escalating", 30));
  assert.ok(sampleCurve("release", 30) > sampleCurve("release", 150));
  assert.equal(sampleCurve("no-such-curve", 10), sampleCurve("steady", 10), "an unknown curve degrades to steady");
});

// ---- the zoning family ----

/** The zoning tree BehaviorCompilerService emits, trimmed to essentials. */
const ZONING_SM = {
  id: "zoning_combat_sm",
  initialState: "Idle",
  states: [
    { id: "Idle", onEnterActions: [{ id: "idle", type: "PlayAnimation", parameters: { animationId: "enemy_idle" } }] },
    {
      id: "MaintainDistance",
      onUpdateActions: [
        {
          id: "standoff",
          type: "ApplyStandoffMovement",
          parameters: { targetTag: "player", speedVar: "effectiveSpeed", minRange: 3.6, maxRange: 6 },
        },
      ],
    },
    {
      id: "Telegraphing",
      onEnterActions: [{ id: "windup", type: "StartTimer", parameters: { timerId: "windup", duration: 0.3 } }],
    },
    {
      id: "Attacking",
      onEnterActions: [
        {
          id: "shoot",
          type: "FireProjectile",
          parameters: { targetTag: "player", damage: 10, range: 6.5, projectileSpeed: 4 },
        },
        { id: "cool", type: "StartTimer", parameters: { timerId: "cooldown", duration: 30 } },
      ],
    },
  ],
  transitions: [
    {
      fromStateId: "Idle",
      toStateId: "MaintainDistance",
      eventType: "OnPerception",
      conditions: [{ id: "seen", type: "TargetInSightRange", parameters: { targetTag: "player", range: 24 } }],
    },
    {
      fromStateId: "MaintainDistance",
      toStateId: "Telegraphing",
      eventType: "OnDistanceCheck",
      conditions: [
        { id: "in_band", type: "WithinRange", parameters: { targetTag: "player", range: 6 } },
        { id: "granted", type: "AttackSlotGranted", parameters: {} },
      ],
    },
    {
      fromStateId: "Telegraphing",
      toStateId: "Attacking",
      eventType: "OnTimerElapsed",
      conditions: [{ id: "wound", type: "TimerElapsed", parameters: { timerId: "windup" } }],
    },
  ],
} as any;

const ZONER: Entity = {
  id: "zoner-1",
  archetype: "enemy",
  tags: ["enemy", "hostile"],
  components: [
    { type: "TransformComponent", position: { x: 15, y: 0, z: 0 } },
    { type: "RenderComponent", spriteId: "enemy_idle", layer: "characters" },
    {
      type: "StateComponent",
      stateMachineId: "zoning_combat_sm",
      initialState: "Idle",
      variables: { effectiveSpeed: 4, health: 50, maxHealth: 50 },
    },
  ],
};

function zoningBundle(triggers: any[] = []) {
  return bundle({
    entities: [PLAYER, ZONER],
    scenes: [{ ...SCENE, entities: ["scene-1-player", "zoner-1"], directors: [] }],
    stateMachines: [PLAYER_SM, ZONING_SM],
    triggers,
  });
}

test("a zoning enemy holds its band instead of closing the gap", () => {
  const { adapter, core } = boot(zoningBundle());
  // 15m out: seen, but well outside the band, so it has to work its way in —
  // which is the only state in which holding is distinguishable from shooting.
  adapter.positions.set("zoner-1", { x: 25, y: 0, z: 0 });
  run(core, 0.5);

  assert.equal(adapter.ofType("ApplyMovementTowardTarget").length, 0, "it never charges");
  const standoff = adapter.ofType("ApplyStandoffMovement")[0];
  assert.ok(standoff, "it works the standoff instead");
  assert.equal(standoff.parameters.targetEntityId, "scene-1-player", "resolved before the adapter sees it");
  assert.equal(standoff.parameters.speed, 4, "speedVar resolved to the compiled number");
  assert.ok(
    standoff.parameters.minRange < standoff.parameters.maxRange,
    "the band it holds has width, so it is a position and not a point"
  );
});

test("a shot lands on arrival, not on release — distance is what buys the player time", () => {
  const { adapter, core } = boot(zoningBundle());
  adapter.positions.set("zoner-1", { x: 15, y: 0, z: 0 }); // 5m at 4 units/s => 1.25s of flight

  run(core, 0.8);
  const shot = adapter.ofType("FireProjectile")[0];
  assert.ok(shot, "the shot was released");
  assert.equal(shot.parameters.targetEntityId, "scene-1-player");
  assert.ok(
    Math.abs(Number(shot.parameters.travelTime) - 1.25) < 0.1,
    "flight time came from the gap it actually fired across, not from a constant"
  );
  assert.equal(core.getVariables("scene-1-player")?.health, 100, "releasing a shot damages nobody");

  run(core, 1.4);
  assert.equal(core.getVariables("scene-1-player")?.health, 90, "the shot landed on its own clock");
  assert.ok(
    adapter.ofType("ApplyAttack").some(a => a.parameters.targetEntityId === "scene-1-player"),
    "impact reuses the hit presentation every adapter already implements"
  );
});

test("a shot whose target is gone when it arrives simply misses", () => {
  const despawnPlayer = {
    id: "vanish",
    scope: "global" as const,
    eventType: "OnCustom" as const,
    conditions: [],
    actions: [
      { id: "gone", type: "DespawnEntity" as const, parameters: { entityId: "scene-1-player" } },
    ],
  };
  const { adapter, core } = boot(zoningBundle([despawnPlayer]));
  adapter.positions.set("zoner-1", { x: 15, y: 0, z: 0 });

  run(core, 0.8);
  assert.ok(adapter.ofType("FireProjectile").length > 0, "the shot is in flight");

  adapter.inject({ id: "vanish", type: "OnCustom", payload: {} });
  core.update(1 / 60);
  run(core, 1.5);

  assert.equal(core.getVariables("scene-1-player"), undefined, "the target left before it arrived");
  assert.equal(
    adapter.ofType("ApplyAttack").length,
    0,
    "nothing was hit — a shot in flight does not re-aim at whoever is nearest when it lands"
  );
});

// ---- narrative sequences ----

test("narrative beats fire in order, gated beats wait, skippable beats advance", () => {
  const sequence = {
    id: "level_sequence",
    beats: [
      {
        id: "beat_1",
        order: 0,
        label: "The alert fires",
        skippable: false,
        triggerActions: [
          { id: "b1", type: "PlayCutsceneOrDialogue" as const, parameters: { label: "The alert fires" } },
        ],
      },
      {
        id: "beat_2",
        order: 1,
        label: "Tracing the breach",
        skippable: true,
        triggerActions: [
          { id: "b2", type: "PlayCutsceneOrDialogue" as const, parameters: { label: "Tracing the breach" } },
        ],
      },
      {
        id: "beat_3",
        order: 2,
        label: "Keys rotated",
        skippable: false,
        triggerActions: [
          { id: "b3", type: "PlayCutsceneOrDialogue" as const, parameters: { label: "Keys rotated" } },
        ],
      },
    ],
    transitions: [
      { fromBeatId: "beat_1", toBeatId: "beat_2", conditions: [] },
      {
        fromBeatId: "beat_2",
        toBeatId: "beat_3",
        conditions: [{ id: "gate", type: "BeatCompleted" as const, parameters: { beatId: "beat_2" } }],
      },
    ],
  };

  const { adapter, core } = boot(bundle({ sequences: [sequence] }));

  core.update(1 / 60);
  const labels = () => adapter.ofType("PlayCutsceneOrDialogue").map(a => a.parameters.label);
  assert.deepEqual(labels(), ["The alert fires"], "only the opening beat fires immediately");

  run(core, 9);
  assert.deepEqual(labels(), ["The alert fires", "Tracing the breach"], "the next beat waits out its dwell");

  // beat_3 is gated on beat_2 completing, and is NOT skippable: it must hold.
  run(core, 12);
  assert.equal(labels().length, 2, "a gated, non-skippable beat does not fire early");

  // The world flag the compiler's SetVariable(scope: world) writes opens it.
  core.loadScene("scene-1"); // scene changes must not reset world-scoped narrative
  (core as any).worldVariables["beat_2_complete"] = true;
  run(core, 10);
  const finalLabels = labels();
  assert.equal(finalLabels[finalLabels.length - 1], "Keys rotated", "satisfying the gate releases the beat");
});

test("a scene-scoped trigger does not fire for a scene that is not loaded", () => {
  const announce = (sceneId: string) => ({
    id: `${sceneId}-start`,
    scope: "scene" as const,
    sceneId,
    eventType: "OnSceneEnter" as const,
    conditions: [],
    actions: [
      { id: `${sceneId}-msg`, type: "ShowMessage" as const, parameters: { text: `Entering ${sceneId}` } },
    ],
  });

  const { adapter, core } = boot(
    bundle({
      scenes: [SCENE, { ...SCENE, id: "scene-2", name: "Loading Bay", entities: [] }],
      triggers: [announce("scene-1"), announce("scene-2")],
    })
  );
  core.update(1 / 60);

  const messages = adapter.ofType("ShowMessage").map(a => a.parameters.text);
  assert.deepEqual(messages, ["Entering scene-1"], "only the loaded region announces itself");
});

// ---- damage, death, and slot release ----

test("damage, death and squad-slot release are core-owned, not adapter-owned", () => {
  const attackTrigger = {
    id: "player-attack",
    scope: "scene" as const,
    eventType: "OnCustom" as const,
    conditions: [],
    actions: [
      {
        id: "strike",
        type: "ApplyAttack" as const,
        parameters: { entityId: "scene-1-player", targetTag: "enemy", damage: 30, range: 3, cooldown: 0.4 },
      },
    ],
  };

  const { adapter, core } = boot(bundle({ triggers: [attackTrigger] }));
  adapter.positions.set("enemy-1", { x: 10.5, y: 0, z: 0 });
  adapter.positions.set("enemy-2", { x: 30, y: 0, z: 0 }); // out of reach

  const strike = () => {
    adapter.inject({ id: "s", type: "OnCustom", payload: {} });
    core.update(1 / 60);
  };

  strike();
  assert.equal(core.getVariables("enemy-1")?.health, 20, "the nearest enemy in range took the hit");
  assert.equal(core.getVariables("enemy-2")?.health, 50, "an out-of-range enemy was untouched");

  strike(); // still inside the cooldown window
  assert.equal(core.getVariables("enemy-1")?.health, 20, "cooldown blocks a second swing in the same window");

  run(core, 0.5); // let the attack timer expire
  strike();
  assert.equal(core.getVariables("enemy-1"), undefined, "a defeated enemy stops running its machine");
  assert.ok(adapter.destroyed.includes("enemy-1"), "and the adapter removed it");
});
