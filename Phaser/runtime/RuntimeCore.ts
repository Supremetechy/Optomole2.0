import {
  Game,
  Scene,
  Entity,
  Event,
  StateMachine,
  StateComponent,
  TransformComponent,
  Trigger,
  Transition,
  Condition,
  Action,
  DirectorProgram,
  LevelBeat,
  SequenceGraph,
  Vector3,
} from "../dsl/types";
import { EngineAdapter } from "./EngineAdapter";
import { sampleCurve } from "./PacingCurves";
import {
  SquadArbitrationState,
  SquadCandidate,
  arbitrateSquadAttack,
  attritionOf,
  createSquadState,
  releaseSlot,
} from "./SquadArbiter";

interface StateMachineInstance {
  entityId: string;
  machine: StateMachine;
  currentStateId: string;
  variables: Record<string, number | boolean | string>;
}

/** Per-director bookkeeping: elapsed clock, tick accumulator, schedule timers. */
interface DirectorRuntime {
  program: DirectorProgram;
  elapsed: number;
  sinceTick: number;
  sinceScheduled: Record<string, number>;
  /** Which beat of the program's plan is playing; -1 until the first is entered. */
  beatIndex: number;
}

/**
 * A region's reinforcement account. The pacing director accrues into `budget`
 * in whole spawns; a breather suspends accrual until `breatherUntil`.
 */
interface SpawnBudgetRuntime {
  budget: number;
  spawned: number;
  breatherUntil: number;
}

/**
 * A shot in flight. It carries the id it was fired at rather than re-resolving
 * on arrival, so a zoning enemy that loses its target mid-flight still misses
 * instead of silently re-aiming at whoever is nearest when it lands.
 */
interface ProjectileRuntime {
  attackerId: string;
  targetId: string;
  damage: number;
  remaining: number;
  action: Action;
}

/** Where a narrative sequence has got to, and how long it has been there. */
interface SequenceRuntime {
  graph: SequenceGraph;
  beatIndex: number;
  beatElapsed: number;
  started: boolean;
}

/**
 * Observations the core exposes to listeners (e.g. the SignalBridge that feeds
 * the Person Node signal stream). Pure observation — listeners cannot affect
 * the deterministic runtime.
 */
export type RuntimeNotification =
  | { kind: "event"; event: Event }
  | { kind: "transition"; entityId: string; from: string; to: string };

const MAX_EVENT_CASCADE = 100;

/** How often perception/distance are polled for behavior trees, in seconds. */
const PERCEPTION_INTERVAL = 0.2;

/** Minimum time a narrative beat holds the stage before the next can fire. */
const DEFAULT_BEAT_DWELL_SECONDS = 8;

/** Default reach for an attack that does not declare one, in DSL units. */
const DEFAULT_ATTACK_RANGE = 2.5;

/** Compiled spawn rates are enemies-per-minute; budgets accrue in spawns. */
const SECONDS_PER_MINUTE = 60;

/**
 * What an encounter density of 1.0 is allowed to mean, in simultaneous living
 * enemies. The compiled density scales against this, so the ceiling on how
 * crowded a region can get is one number here rather than an open-ended feed.
 */
const ENEMIES_AT_FULL_DENSITY = 6;

/** How far apart successive reinforcements arrive, in DSL units. */
const REINFORCEMENT_SPREAD_UNITS = 1.5;

/** Fallback flight speed for a shot that does not declare one, in units/s. */
const DEFAULT_PROJECTILE_SPEED = 10;

export class RuntimeCore {
  private game: Game | null = null;
  private scenes = new Map<string, Scene>();
  private entities = new Map<string, Entity>();
  private stateMachines = new Map<string, StateMachine>();
  private triggers: Trigger[] = [];
  private directorPrograms: DirectorProgram[] = [];
  private sequenceGraphs: SequenceGraph[] = [];
  private adapter: EngineAdapter;

  private activeSceneId: string | null = null;
  private instances = new Map<string, StateMachineInstance>();
  private internalQueue: Event[] = [];
  private lastInputState: Record<string, boolean> = {};
  private listeners: Array<(notification: RuntimeNotification) => void> = [];

  // ---- combat/pacing/narrative runtime state ----

  /** entityId -> timerId -> seconds remaining. Expiry emits OnTimerElapsed. */
  private timers = new Map<string, Map<string, number>>();
  /** Timers that expired this frame, readable by TimerElapsed until consumed. */
  private firedTimers = new Map<string, Set<string>>();
  private directors: DirectorRuntime[] = [];
  private sequences: SequenceRuntime[] = [];
  /** Beat completion and other world-scoped flags a SequenceGraph gates on. */
  private worldVariables: Record<string, number | boolean | string> = {};
  private squads = new Map<string, SquadArbitrationState>();
  /** entityId -> whether its squad currently grants it an attack slot. */
  private attackGrants = new Map<string, boolean>();
  /** regionId -> reinforcement account, driven by that region's pacing director. */
  private spawnBudgets = new Map<string, SpawnBudgetRuntime>();
  /** Entity definitions minted at runtime by a spawn budget, not by the compiler. */
  private spawnedEntityIds = new Set<string>();
  /** Shots in flight, resolved on arrival so distance stays worth something. */
  private projectiles: ProjectileRuntime[] = [];
  private sincePerception = 0;
  /** True when any loaded machine reacts to perception/distance polling. */
  private needsPerceptionTick = false;
  private clock = 0;

  constructor(adapter: EngineAdapter) {
    this.adapter = adapter;
  }

  loadGame(
    game: Game,
    sceneDefs: Scene[],
    entityDefs: Entity[],
    smDefs: StateMachine[],
    triggerDefs: Trigger[],
    directorDefs: DirectorProgram[] = [],
    sequenceDefs: SequenceGraph[] = []
  ): void {
    this.game = game;
    sceneDefs.forEach(s => this.scenes.set(s.id, s));
    entityDefs.forEach(e => this.entities.set(e.id, e));
    smDefs.forEach(sm => this.stateMachines.set(sm.id, sm));
    this.triggers = [...triggerDefs].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
    this.directorPrograms = directorDefs;
    this.sequenceGraphs = sequenceDefs;

    // Narrative is world-scoped: it spans scenes, so it starts with the game
    // rather than being reset every time a region loads.
    this.sequences = sequenceDefs.map(graph => ({
      graph,
      beatIndex: 0,
      beatElapsed: 0,
      started: false,
    }));
  }

  loadScene(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error(`Scene not found: ${sceneId}`);

    if (this.activeSceneId) {
      this.adapter.destroyScene(this.activeSceneId);
      this.instances.clear();
    }
    // Region-scoped state does not survive a scene change: timers, attack
    // slots, and squad commitments all belong to the encounter that just ended.
    this.timers.clear();
    this.firedTimers.clear();
    this.squads.clear();
    this.attackGrants.clear();
    // Reinforcements were minted for the encounter that just ended. Their
    // definitions exist nowhere in the compiled bundle, so dropping them here is
    // what stops a long session accumulating entity ids no scene can reach.
    for (const spawnedId of this.spawnedEntityIds) this.entities.delete(spawnedId);
    this.spawnedEntityIds.clear();
    this.spawnBudgets.clear();
    this.projectiles = [];
    this.activeSceneId = sceneId;
    this.adapter.createScene(scene);

    for (const entityId of scene.entities) {
      const entity = this.entities.get(entityId);
      if (!entity) {
        console.warn(`Entity not found: ${entityId}`);
        continue;
      }
      this.adapter.createEntity(entity);
      this.registerStateMachine(entity);
    }

    // Only the directors this region owns run; a global director runs anywhere.
    const sceneDirectorIds = new Set(scene.directors ?? []);
    this.directors = this.directorPrograms
      .filter(
        program =>
          program.scope === "level" ||
          sceneDirectorIds.has(program.id) ||
          program.targetId === scene.regionId
      )
      .map(program => ({
        program,
        elapsed: 0,
        sinceTick: 0,
        sinceScheduled: Object.fromEntries(
          program.scheduledActions.map(action => [action.id, 0])
        ),
        beatIndex: -1,
      }));

    this.needsPerceptionTick = [...this.instances.values()].some(inst =>
      inst.machine.transitions.some(
        t => t.eventType === "OnPerception" || t.eventType === "OnDistanceCheck"
      )
    );

    // Enter every machine's initial state, then announce the scene.
    for (const inst of this.instances.values()) {
      this.runStateActions(inst, inst.currentStateId, "onEnterActions");
    }
    this.emit({ id: `scene_enter_${sceneId}`, type: "OnSceneEnter", payload: { sceneId } });
  }

  update(deltaTime: number): void {
    this.clock += deltaTime;

    // 1. Engine events (input, collisions) → domain events.
    const events = this.adapter.pollEngineEvents();
    for (const event of events) this.processEvent(event);

    // 2. Internal events emitted by actions, cascading within the frame.
    this.drainQueue();

    // 3. Per-frame state behavior.
    for (const inst of this.instances.values()) {
      this.runStateActions(inst, inst.currentStateId, "onUpdateActions");
    }

    // 4. Timers expire on the core's clock, not the adapter's, so a behavior
    //    tree advances identically in every engine.
    this.tickTimers(deltaTime);

    // 5. Perception/distance polling drives combat trees with no player input.
    this.tickPerception(deltaTime);

    // 5b. Shots in flight land, or miss a target that is no longer there.
    this.tickProjectiles(deltaTime);

    // 6. Directors: pacing curves and squad arbitration.
    this.tickDirectors(deltaTime);

    // 7. Narrative beats.
    this.tickSequences(deltaTime);

    this.drainQueue();

    // 8. Let the adapter poll input/collisions for next frame.
    this.adapter.update(deltaTime);
  }

  emit(event: Event): void {
    this.internalQueue.push(event);
  }

  /** Observe runtime activity. Returns an unsubscribe function. */
  subscribe(listener: (notification: RuntimeNotification) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(notification: RuntimeNotification): void {
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
        // Observation must never break the game.
      }
    }
  }

  getVariables(entityId: string): Record<string, number | boolean | string> | undefined {
    return this.instances.get(entityId)?.variables;
  }

  /** World-scoped flags (narrative beat completion, global progress). */
  getWorldVariables(): Record<string, number | boolean | string> {
    return { ...this.worldVariables };
  }

  /** Which narrative beat each sequence is currently on. */
  getSequenceProgress(): Array<{ id: string; beatIndex: number; beatId: string | null }> {
    return this.sequences.map(runtime => ({
      id: runtime.graph.id,
      beatIndex: runtime.beatIndex,
      beatId: runtime.graph.beats[runtime.beatIndex]?.id ?? null,
    }));
  }

  // ---- internals ----

  private drainQueue(): void {
    let cascade = 0;
    while (this.internalQueue.length > 0 && cascade++ < MAX_EVENT_CASCADE) {
      const event = this.internalQueue.shift()!;
      this.processEvent(event);
    }
  }

  private registerStateMachine(entity: Entity): void {
    const stateComp = entity.components.find(
      (c): c is StateComponent => c.type === "StateComponent"
    );
    if (!stateComp) return;
    const machine = this.stateMachines.get(stateComp.stateMachineId);
    if (!machine) {
      console.warn(`State machine not found: ${stateComp.stateMachineId}`);
      return;
    }
    this.instances.set(entity.id, {
      entityId: entity.id,
      machine,
      currentStateId: stateComp.initialState || machine.initialState,
      variables: { ...stateComp.variables },
    });
  }

  private processEvent(event: Event): void {
    if (event.type === "OnInput" && event.payload?.inputState) {
      this.lastInputState = { ...event.payload.inputState };
    } else {
      // Input ticks fire every held frame — too noisy to observe.
      this.notify({ kind: "event", event });
    }

    // State machine transitions.
    for (const inst of this.instances.values()) {
      const candidates = inst.machine.transitions
        .filter(t => t.fromStateId === inst.currentStateId && t.eventType === event.type)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

      for (const transition of candidates) {
        if (!this.conditionsPass(transition.conditions, event, inst)) continue;
        this.takeTransition(inst, transition, event);
        break; // deterministic: one winning transition per event
      }
    }

    // Rule engine triggers.
    for (const trigger of this.triggers) {
      if (trigger.eventType !== event.type) continue;
      // A scene-scoped trigger belongs to its own region only. Ignoring scope
      // let every region's rules run at once — the first scene announced all of
      // them, and collectibles from unloaded scenes were live.
      if (trigger.scope === "scene" && trigger.sceneId && trigger.sceneId !== this.activeSceneId) {
        continue;
      }
      const inst = event.sourceEntityId
        ? this.instances.get(event.sourceEntityId)
        : undefined;
      if (!this.conditionsPass(trigger.conditions, event, inst)) continue;
      for (const action of trigger.actions) this.executeAction(action, inst);
    }
  }

  private takeTransition(
    inst: StateMachineInstance,
    transition: Transition,
    _event: Event
  ): void {
    const from = inst.currentStateId;
    this.runStateActions(inst, from, "onExitActions");
    inst.currentStateId = transition.toStateId;
    for (const action of transition.actions ?? []) this.executeAction(action, inst);
    this.runStateActions(inst, inst.currentStateId, "onEnterActions");
    // An enemy that stops attacking hands its slot back, so the coordinator can
    // pass it to someone else instead of the squad deadlocking on a stale commit.
    if (from === "Attacking" && transition.toStateId !== "Attacking") {
      this.releaseAttackSlot(inst.entityId);
    }
    this.notify({ kind: "transition", entityId: inst.entityId, from, to: inst.currentStateId });
  }

  private runStateActions(
    inst: StateMachineInstance,
    stateId: string,
    slot: "onEnterActions" | "onExitActions" | "onUpdateActions"
  ): void {
    const state = inst.machine.states.find(s => s.id === stateId);
    for (const action of state?.[slot] ?? []) this.executeAction(action, inst);
  }

  private conditionsPass(
    conditions: Condition[],
    event: Event,
    inst?: StateMachineInstance
  ): boolean {
    return conditions.every(c => this.evaluateCondition(c, event, inst));
  }

  private evaluateCondition(
    condition: Condition,
    event: Event,
    inst?: StateMachineInstance
  ): boolean {
    const p = condition.parameters;
    switch (condition.type) {
      case "InputIsPressed": {
        const actions: string[] = p.actions ?? [];
        return actions.some(a => this.lastInputState[a]);
      }
      case "InputReleasedAll": {
        const actions: string[] = p.actions ?? [];
        return actions.every(a => !this.lastInputState[a]);
      }
      case "VariableEquals": {
        // World scope closes a one-way street: SetVariable could already write
        // a world variable, but nothing except BeatCompleted could read one
        // back, so cross-entity progress (every item collected, every node
        // visited) had no way to gate anything. A resolution is exactly that
        // kind of state, so it needs the symmetric read.
        if (p.scope === "world") return this.worldVariables[p.var] === p.value;
        const vars = p.entityId
          ? this.instances.get(p.entityId)?.variables
          : inst?.variables;
        return vars?.[p.var] === p.value;
      }
      case "CollisionWithTag": {
        if (event.type !== "OnCollision") return false;
        const { entityId, tag, contactNormalYGreaterThan } = p;
        const self = entityId ?? inst?.entityId;
        const other =
          event.sourceEntityId === self
            ? event.targetEntityId
            : event.targetEntityId === self
              ? event.sourceEntityId
              : undefined;
        if (!other) return false;
        const otherEntity = this.entities.get(other);
        if (!otherEntity?.tags.includes(tag)) return false;
        if (contactNormalYGreaterThan !== undefined) {
          return (event.payload?.normalY ?? 0) > contactNormalYGreaterThan;
        }
        return true;
      }
      case "CollisionPair": {
        if (event.type !== "OnCollision") return false;
        const ids = [event.sourceEntityId, event.targetEntityId];
        return ids.includes(p.entityAId) && ids.includes(p.entityBId);
      }
      case "TimerElapsed": {
        const entityId = p.entityId ?? inst?.entityId;
        if (!entityId) return false;
        return this.firedTimers.get(entityId)?.has(p.timerId) ?? false;
      }
      case "WithinRange":
      case "TargetInSightRange": {
        const selfId = p.entityId ?? inst?.entityId;
        if (!selfId) return false;
        const target = this.resolveTargetId(selfId, p.targetEntityId, p.targetTag);
        if (!target) return false;
        const distance = this.distanceBetween(selfId, target);
        if (distance === null) return false;
        const range = typeof p.range === "number" ? p.range : DEFAULT_ATTACK_RANGE;
        return distance <= range;
      }
      case "HealthBelowThreshold": {
        const vars = p.entityId ? this.instances.get(p.entityId)?.variables : inst?.variables;
        const health = Number(vars?.health);
        const maxHealth = Number(vars?.maxHealth) || health;
        if (!Number.isFinite(health) || !maxHealth) return false;
        return health / maxHealth < Number(p.threshold ?? 0);
      }
      // No squad => no arbiter => granted. A lone enemy must not deadlock
      // waiting for a coordinator that was never compiled.
      case "AttackSlotGranted": {
        const entityId = p.entityId ?? inst?.entityId;
        if (!entityId) return false;
        return this.attackGrants.get(entityId) ?? !this.isSquadMember(entityId);
      }
      case "AttackSlotDenied": {
        const entityId = p.entityId ?? inst?.entityId;
        if (!entityId) return false;
        const granted = this.attackGrants.get(entityId) ?? !this.isSquadMember(entityId);
        return !granted;
      }
      case "BeatCompleted":
        return this.worldVariables[`${p.beatId}_complete`] === true
          || this.worldVariables[`beat_${p.beatId}_complete`] === true;
      case "Expression":
        console.warn("Expression conditions not implemented in prototype");
        return false;
      default:
        return false;
    }
  }

  private executeAction(action: Action, inst?: StateMachineInstance): void {
    switch (action.type) {
      // Core-owned actions: mutate runtime state, never touch the engine.
      case "SetVariable": {
        const { entityId, var: varName, value, scope } = action.parameters;
        if (scope === "world") {
          this.worldVariables[varName] = value;
          return;
        }
        const target = entityId ? this.instances.get(entityId) : inst;
        if (target) target.variables[varName] = value;
        return;
      }
      case "EmitEvent": {
        const { eventType, payload, entityId } = action.parameters;
        this.emit({
          id: action.id,
          type: eventType,
          payload,
          sourceEntityId: entityId ?? inst?.entityId,
        });
        return;
      }
      case "LoadScene": {
        this.loadScene(action.parameters.sceneId);
        return;
      }
      case "StartTimer": {
        const entityId = action.parameters.entityId ?? inst?.entityId;
        if (!entityId) return;
        this.startTimer(entityId, action.parameters.timerId, Number(action.parameters.duration) || 0);
        return;
      }
      case "ArbitrateSquadAttack":
        this.runArbitration(action);
        return;
      case "BroadcastVariable":
        this.runBroadcast(action);
        return;
      case "ApplyAttack":
        this.runAttack(action, inst);
        return;
      case "FireProjectile":
        this.runFireProjectile(action, inst);
        return;
      // Pacing output. Whether a reinforcement is due, and whether the region is
      // resting, are gameplay decisions — so they resolve here and the action is
      // still forwarded, leaving the adapter only the presentation of it.
      case "EvaluateSpawnBudget":
        this.runSpawnBudget(action);
        this.adapter.applyAction(this.resolveAction(action, inst));
        return;
      case "TriggerBreather":
        this.runBreather(action);
        this.adapter.applyAction(this.resolveAction(action, inst));
        return;
      case "DespawnEntity": {
        // Core-side cleanup first so a dead entity stops running its machine
        // and stops holding a squad slot; the adapter still removes the sprite.
        const entityId = action.parameters.entityId ?? inst?.entityId;
        if (entityId) {
          this.instances.delete(entityId);
          this.timers.delete(entityId);
          this.releaseAttackSlot(entityId);
          // A reinforcement's definition dies with it; a compiled entity's does
          // not, because its scene will declare it again on reload.
          if (this.spawnedEntityIds.delete(entityId)) this.entities.delete(entityId);
        }
        this.adapter.applyAction(this.resolveAction(action, inst));
        return;
      }
      // Engine-owned actions: resolve variable references, hand to adapter.
      default:
        this.adapter.applyAction(this.resolveAction(action, inst));
    }
  }

  /**
   * Parameters ending in "Var" (speedVar, forceVar, leftVar…) name entity
   * variables; resolve them so adapters only ever see concrete values.
   *
   * An action running inside a state machine also defaults `entityId` to the
   * instance that ran it. Without that, a machine could only ever drive the one
   * entity whose id its author hardcoded — so a compiled bundle that reuses
   * `player_state_machine` across scenes would emit actions no adapter could
   * route, and the player would simply never move.
   *
   * `targetTag` is resolved the same way, into a concrete `targetEntityId`: an
   * adapter should move a body toward a known entity, not search the world for
   * one. This is what lets one compiled combat tree run in Pixi and Phaser
   * alike without either adapter knowing what "the player" means.
   */
  private resolveAction(action: Action, inst?: StateMachineInstance): Action {
    const entityId = action.parameters.entityId ?? inst?.entityId;
    const vars =
      (entityId ? this.instances.get(entityId)?.variables : inst?.variables) ?? {};
    const resolved: Record<string, any> = { ...action.parameters };
    if (entityId !== undefined) resolved.entityId = entityId;
    for (const [key, value] of Object.entries(action.parameters)) {
      if (key.endsWith("Var") && typeof value === "string" && value in vars) {
        resolved[key.slice(0, -3)] = vars[value];
      }
    }
    if (resolved.targetTag && !resolved.targetEntityId && entityId) {
      const target = this.resolveTargetId(entityId, undefined, resolved.targetTag);
      if (target) resolved.targetEntityId = target;
    }
    return { ...action, parameters: resolved };
  }

  // ---- timers ----

  private startTimer(entityId: string, timerId: string, duration: number): void {
    if (!this.timers.has(entityId)) this.timers.set(entityId, new Map());
    this.timers.get(entityId)!.set(timerId, duration);
  }

  /**
   * Expiry emits OnTimerElapsed and leaves the timer id readable for the rest
   * of the frame, so a transition gated on TimerElapsed can see the one that
   * just fired rather than racing the event.
   */
  private tickTimers(deltaTime: number): void {
    this.firedTimers.clear();
    for (const [entityId, entityTimers] of this.timers) {
      for (const [timerId, remaining] of entityTimers) {
        const left = remaining - deltaTime;
        if (left > 0) {
          entityTimers.set(timerId, left);
          continue;
        }
        entityTimers.delete(timerId);
        if (!this.firedTimers.has(entityId)) this.firedTimers.set(entityId, new Set());
        this.firedTimers.get(entityId)!.add(timerId);
        this.emit({
          id: `timer_${entityId}_${timerId}`,
          type: "OnTimerElapsed",
          payload: { timerId },
          sourceEntityId: entityId,
        });
      }
    }
    this.drainQueue();
  }

  // ---- perception ----

  /**
   * Behavior trees advance on their own clock: without a poll, an enemy that is
   * standing next to the player would sit in Idle forever because nothing in
   * the world emits "you can see them now".
   */
  private tickPerception(deltaTime: number): void {
    if (!this.needsPerceptionTick) return;
    this.sincePerception += deltaTime;
    if (this.sincePerception < PERCEPTION_INTERVAL) return;
    this.sincePerception = 0;
    this.emit({ id: "perception_tick", type: "OnPerception", payload: {} });
    this.emit({ id: "distance_tick", type: "OnDistanceCheck", payload: {} });
    this.drainQueue();
  }

  // ---- directors ----

  private tickDirectors(deltaTime: number): void {
    for (const director of this.directors) {
      director.elapsed += deltaTime;
      director.sinceTick += deltaTime;
      this.advanceBeat(director);
      if (director.sinceTick >= director.program.tickIntervalSeconds) {
        director.sinceTick = 0;
        for (const action of director.program.onTickActions) {
          this.executeDirectorAction(action, director);
        }
      }
      for (const scheduled of director.program.scheduledActions) {
        const since = (director.sinceScheduled[scheduled.id] ?? 0) + deltaTime;
        if (since >= scheduled.repeatEverySeconds) {
          director.sinceScheduled[scheduled.id] = 0;
          this.executeDirectorAction(scheduled, director);
        } else {
          director.sinceScheduled[scheduled.id] = since;
        }
      }
    }
    this.drainQueue();
  }

  /**
   * The curve is sampled HERE, not in the adapter: `tension` arrives as a plain
   * scalar so an adapter can spawn or set music volume without ever knowing
   * what "escalating" means.
   */
  private executeDirectorAction(action: Action, director: DirectorRuntime): void {
    const curve = action.parameters.curve;
    if (typeof curve === "string") {
      const tension = sampleCurve(curve, director.elapsed);
      const beat = this.activeBeat(director);
      this.executeAction(
        {
          ...action,
          parameters: {
            ...action.parameters,
            tension,
            // The beat plays over the curve: the curve says how hard the region
            // is pressing, the beat says what kind of moment it is pressing in.
            ...(beat
              ? {
                  beatType: beat.type,
                  beatIndex: director.beatIndex,
                  beatEnemyDensity: beat.enemyDensity,
                }
              : {}),
            elapsedSeconds: Number(director.elapsed.toFixed(2)),
            // How much time this tick accounts for. A rate is meaningless
            // without it, and only the director knows its own cadence.
            tickIntervalSeconds: director.program.tickIntervalSeconds,
            // The compiled base rate scaled by where the curve is now — the
            // spawn budget the region actually accrues against this tick.
            resolvedRate:
              typeof action.parameters.baseRate === "number"
                ? Number((action.parameters.baseRate * tension).toFixed(3))
                : undefined,
            // Same rule for loudness: the region's compiled intensity is what it
            // feels like at full tension, and the curve says how much of that is
            // being felt now. An adapter receives one scalar and turns a knob.
            resolvedIntensity:
              typeof action.parameters.intensity === "number"
                ? Number(Math.max(0, Math.min(1, action.parameters.intensity * tension)).toFixed(3))
                : undefined,
          },
        },
        undefined
      );
      return;
    }
    this.executeAction(action, undefined);
  }

  // ---- pacing: beats, reinforcements and breathers ----

  /**
   * Which beat a director is on, from its own elapsed clock. The plan loops:
   * a region the player lingers in keeps cycling calm → build → peak rather
   * than pinning forever at whatever its last beat happened to be.
   */
  private activeBeat(director: DirectorRuntime): LevelBeat | null {
    const beats = director.program.beats;
    if (!beats?.length) return null;
    const total = beats.reduce((sum, beat) => sum + Math.max(1, beat.duration), 0);
    let offset = director.elapsed % total;
    for (const beat of beats) {
      offset -= Math.max(1, beat.duration);
      if (offset < 0) return beat;
    }
    return beats[beats.length - 1];
  }

  private beatIndexOf(director: DirectorRuntime, beat: LevelBeat): number {
    return director.program.beats?.indexOf(beat) ?? -1;
  }

  /** Announce a beat change once, so telemetry and adapters can react to it. */
  private advanceBeat(director: DirectorRuntime): void {
    const beat = this.activeBeat(director);
    if (!beat) return;
    const index = this.beatIndexOf(director, beat);
    if (index === director.beatIndex) return;
    director.beatIndex = index;
    this.emit({
      id: `beat_${director.program.id}_${index}`,
      type: "OnCustom",
      payload: {
        kind: "beat",
        regionId: director.program.targetId,
        beatType: beat.type,
        beatIndex: index,
        enemyDensity: beat.enemyDensity,
        traversalComplexity: beat.traversalComplexity,
      },
    });
  }

  // ---- pacing: reinforcements and breathers ----

  private spawnBudgetFor(regionId: string): SpawnBudgetRuntime {
    let state = this.spawnBudgets.get(regionId);
    if (!state) {
      state = { budget: 0, spawned: 0, breatherUntil: 0 };
      this.spawnBudgets.set(regionId, state);
    }
    return state;
  }

  /**
   * Reinforcements. The director hands over a rate already scaled by the tension
   * curve; this accrues it into whole spawns and tops the region back up to the
   * encounter density the pacing directive asked for.
   *
   * The cap counts LIVING enemies rather than total spawns, which is what makes
   * pacing feel like pacing: a player who clears a region faster than the budget
   * accrues earns quiet, and one who leaves it standing never faces more at once
   * than the compiled density allows.
   */
  private runSpawnBudget(action: Action): void {
    const p = action.parameters;
    const regionId = String(p.regionId ?? this.activeSceneId ?? "region");
    const state = this.spawnBudgetFor(regionId);
    if (this.clock < state.breatherUntil) return;

    const rate = Number(p.resolvedRate ?? p.baseRate);
    const interval = Number(p.tickIntervalSeconds);
    if (!(rate > 0) || !(interval > 0)) return;

    const templates = this.enemyTemplates();
    if (!templates.length) return;

    // The active beat's density wins over the region's average when a pacing
    // plan is compiled: that is the whole point of a beat — a peak is allowed
    // to be crowded and a release is not, inside the same region.
    const density = Number(p.beatEnemyDensity ?? p.density);
    const targetLive = Math.max(
      1,
      Math.round((Number.isFinite(density) ? density : 0.3) * ENEMIES_AT_FULL_DENSITY)
    );

    state.budget += (rate * interval) / SECONDS_PER_MINUTE;
    while (state.budget >= 1 && this.liveEnemyCount() < targetLive) {
      state.budget -= 1;
      state.spawned += 1;
      this.spawnReinforcement(templates[state.spawned % templates.length], state.spawned);
    }
    // A region at capacity banks at most one spawn, so a long stalemate cannot
    // burst into a wave the instant the player thins it out.
    if (state.budget > 1) state.budget = 1;
  }

  /**
   * A breather suspends reinforcement accrual for its duration — the pause the
   * pacing directive asked for. Enemies already in the region keep fighting: a
   * breather is relief from escalation, not a truce.
   */
  private runBreather(action: Action): void {
    const p = action.parameters;
    const regionId = String(p.regionId ?? this.activeSceneId ?? "region");
    const duration = Number(p.durationSeconds);
    if (!(duration > 0)) return;

    const state = this.spawnBudgetFor(regionId);
    state.breatherUntil = this.clock + duration;
    // Banked pressure does not survive the pause, or the rest would simply be
    // paid back as a wave the moment it ends.
    state.budget = 0;
    this.emit({
      id: `breather_${regionId}`,
      type: "OnCustom",
      payload: { kind: "breather", regionId, durationSeconds: duration },
    });
  }

  /** The enemies this region declared — the only things it may reinforce with. */
  private enemyTemplates(): Entity[] {
    const scene = this.activeSceneId ? this.scenes.get(this.activeSceneId) : null;
    if (!scene) return [];
    return scene.entities
      .map(entityId => this.entities.get(entityId))
      .filter((entity): entity is Entity => !!entity && entity.tags.includes("enemy"));
  }

  private liveEnemyCount(): number {
    let live = 0;
    for (const entityId of this.instances.keys()) {
      if (this.entities.get(entityId)?.tags.includes("enemy")) live += 1;
    }
    return live;
  }

  /**
   * One reinforcement, CLONED from an enemy the region already declared rather
   * than invented here. Cloning is what keeps every compiled number intact — its
   * behavior tree, its squad tag, its sprite, its health — so a reinforcement
   * fights like the content that produced it instead of like a runtime default.
   */
  private spawnReinforcement(template: Entity, ordinal: number): void {
    const transform = template.components.find(
      (c): c is TransformComponent => c.type === "TransformComponent"
    );
    if (!transform) return;

    const entityId = `${template.id}-reinforcement-${ordinal}`;
    if (this.entities.has(entityId)) return;

    // Arrivals are spread around the template's own position, which is on the
    // ground and inside the region by construction — nothing computed at runtime
    // can promise either.
    const offset = ((ordinal % 3) - 1) * REINFORCEMENT_SPREAD_UNITS;
    const clone: Entity = {
      ...template,
      id: entityId,
      components: template.components.map(component =>
        component.type === "TransformComponent"
          ? { ...component, position: { ...component.position, x: component.position.x + offset } }
          : component
      ),
    };

    this.entities.set(entityId, clone);
    this.spawnedEntityIds.add(entityId);
    this.adapter.createEntity(clone);
    this.registerStateMachine(clone);

    const inst = this.instances.get(entityId);
    if (inst) {
      // A region whose compiled enemies were all defeated may have stopped
      // polling; a new arrival needs perception back on to ever notice anyone.
      this.needsPerceptionTick =
        this.needsPerceptionTick ||
        inst.machine.transitions.some(
          t => t.eventType === "OnPerception" || t.eventType === "OnDistanceCheck"
        );
      this.runStateActions(inst, inst.currentStateId, "onEnterActions");
    }

    this.emit({
      id: `reinforcement_${entityId}`,
      type: "OnCustom",
      payload: { kind: "reinforcement", entityId, templateId: template.id },
      sourceEntityId: entityId,
    });
  }

  // ---- squad arbitration ----

  private isSquadMember(entityId: string): boolean {
    return this.entities.get(entityId)?.tags.some(tag => tag.startsWith("squad:")) ?? false;
  }

  private squadMemberIds(squadId: string): string[] {
    const tag = `squad:${squadId}`;
    const ids: string[] = [];
    for (const [entityId] of this.instances) {
      if (this.entities.get(entityId)?.tags.includes(tag)) ids.push(entityId);
    }
    return ids;
  }

  private releaseAttackSlot(entityId: string): void {
    this.attackGrants.delete(entityId);
    for (const state of this.squads.values()) releaseSlot(state, entityId);
  }

  /**
   * One tick of arbitration. Candidates are the squad members currently trying
   * to commit (Approaching or already Holding); everything about *why* one is
   * chosen stays here, and each enemy only receives a flag.
   */
  private runArbitration(action: Action): void {
    const p = action.parameters;
    const squadId = String(p.squadId ?? "squad");
    if (!this.squads.has(squadId)) this.squads.set(squadId, createSquadState());
    const state = this.squads.get(squadId)!;

    const memberIds = this.squadMemberIds(squadId);
    if (!memberIds.length) return;
    if (state.initialMemberCount === null) state.initialMemberCount = memberIds.length;

    const targetId = this.resolveTargetId(memberIds[0], undefined, "player");
    const targetPosition = targetId ? this.adapter.getEntityPosition(targetId) : undefined;

    const candidates: SquadCandidate[] = memberIds.map(entityId => {
      const inst = this.instances.get(entityId);
      const position = this.adapter.getEntityPosition(entityId);
      const wantsToAttack =
        inst?.currentStateId === "Approaching" || inst?.currentStateId === "Holding";
      return {
        entityId,
        wantsToAttack,
        distanceToTarget:
          position && targetPosition ? distance(position, targetPosition) : Number.MAX_SAFE_INTEGER,
        angleToTarget:
          position && targetPosition
            ? Math.atan2(position.y - targetPosition.y, position.x - targetPosition.x)
            : 0,
      };
    });

    // A thinned squad is allowed one more simultaneous attacker than its
    // compiled cap, so an encounter tightens as it is won instead of trailing off.
    const attrition = attritionOf(state, memberIds.length);
    const compiledCap = Number(p.maxConcurrentAttackers) || 1;
    const result = arbitrateSquadAttack(
      state,
      {
        maxConcurrentAttackers: Math.min(
          memberIds.length,
          compiledCap + (attrition > 0.5 ? 1 : 0)
        ),
        flankBias: Number(p.flankBias) || 0,
        callOutDelay: Number(p.callOutDelay) || 0,
      },
      candidates,
      this.clock
    );

    for (const entityId of result.grantedEntityIds) {
      this.attackGrants.set(entityId, true);
      this.emit({
        id: `attack_granted_${entityId}`,
        type: "OnCustom",
        payload: { kind: "attack_granted" },
        sourceEntityId: entityId,
      });
    }
    for (const entityId of result.deniedEntityIds) this.attackGrants.set(entityId, false);
  }

  /**
   * Effective aggression is base aggression scaled by how many allies are
   * already committed: the ones holding back circle a little slower, the
   * committed ones press. The enemy's own state machine never computes this.
   */
  private runBroadcast(action: Action): void {
    const p = action.parameters;
    const squadId = String(p.squadId ?? "squad");
    const state = this.squads.get(squadId);
    const memberIds = this.squadMemberIds(squadId);
    if (!memberIds.length) return;

    // Pressure is compiled per-encounter but felt dynamically: as the player
    // thins the squad, the survivors press rather than politely queueing.
    const attrition = state ? attritionOf(state, memberIds.length) : 0;

    for (const entityId of memberIds) {
      const inst = this.instances.get(entityId);
      if (!inst) continue;
      const base = Number(inst.variables[String(p.baseVar ?? "aggression")] ?? 0.5);
      const committed = state?.committedAttackers.has(entityId) ?? false;
      const scale = (committed ? 1.15 : 0.85) * (1 + attrition * 0.5);
      const effective = Math.max(0, Math.min(1, base * scale));
      inst.variables[String(p.var ?? "effectiveAggression")] = Number(effective.toFixed(3));
      const baseSpeed = Number(inst.variables.baseSpeed);
      if (Number.isFinite(baseSpeed)) {
        inst.variables.effectiveSpeed = Number((baseSpeed * scale).toFixed(3));
      }
    }
  }

  // ---- combat resolution ----

  /**
   * Damage is core-owned so health, death, and the OnHealthChanged event stay
   * identical across engines; the action is still forwarded so an adapter can
   * play a hit flash. An attacker with a `cooldown` cannot swing again until
   * its `attack` timer expires — that is what keeps a held attack key from
   * deleting an encounter in one frame.
   */
  private runAttack(action: Action, inst?: StateMachineInstance): void {
    const p = action.parameters;
    const attackerId = p.entityId ?? inst?.entityId;
    if (!attackerId) return;

    const cooldown = Number(p.cooldown);
    if (Number.isFinite(cooldown) && cooldown > 0) {
      if (this.timers.get(attackerId)?.has("attack")) return;
      this.startTimer(attackerId, "attack", cooldown);
    }

    const range = typeof p.range === "number" ? p.range : DEFAULT_ATTACK_RANGE;
    const targetId = this.resolveTargetId(attackerId, p.targetEntityId, p.targetTag, range);
    if (!targetId) return;

    const damage = Number(p.damage) || 0;
    this.applyDamage(targetId, damage);

    this.adapter.applyAction({
      ...action,
      parameters: { ...p, entityId: attackerId, targetEntityId: targetId, damage },
    });
  }

  /**
   * Health, death and the events either produces. Shared by melee and by a
   * projectile's arrival so a shot and a swing kill by exactly the same rule.
   */
  private applyDamage(targetId: string, damage: number): void {
    const target = this.instances.get(targetId);
    if (!target || typeof target.variables.health !== "number") return;

    target.variables.health = Math.max(0, Number(target.variables.health) - damage);
    this.emit({
      id: `health_${targetId}`,
      type: "OnHealthChanged",
      payload: { health: target.variables.health, damage },
      sourceEntityId: targetId,
    });
    if (target.variables.health > 0) return;

    this.emit({
      id: `defeated_${targetId}`,
      type: "OnCustom",
      payload: { kind: "defeated", entityId: targetId },
      sourceEntityId: targetId,
    });
    this.executeAction(
      { id: `despawn_${targetId}`, type: "DespawnEntity", parameters: { entityId: targetId } },
      undefined
    );
  }

  /**
   * A zoning enemy's shot. Travel time is derived from the gap it actually fired
   * across and its compiled projectile speed — not authored per attack — so the
   * band a zoning enemy fights to keep is the same band that gives the player
   * time to break line, close, or move.
   */
  private runFireProjectile(action: Action, inst?: StateMachineInstance): void {
    const p = action.parameters;
    const attackerId = p.entityId ?? inst?.entityId;
    if (!attackerId) return;

    const cooldown = Number(p.cooldown);
    if (Number.isFinite(cooldown) && cooldown > 0) {
      if (this.timers.get(attackerId)?.has("attack")) return;
      this.startTimer(attackerId, "attack", cooldown);
    }

    const range = typeof p.range === "number" ? p.range : DEFAULT_ATTACK_RANGE;
    const targetId = this.resolveTargetId(attackerId, p.targetEntityId, p.targetTag, range);
    if (!targetId) return;

    const speed = Number(p.projectileSpeed) > 0 ? Number(p.projectileSpeed) : DEFAULT_PROJECTILE_SPEED;
    const gap = this.distanceBetween(attackerId, targetId) ?? range;
    const resolved: Action = {
      ...action,
      parameters: { ...p, entityId: attackerId, targetEntityId: targetId, travelTime: Number((gap / speed).toFixed(3)) },
    };

    this.projectiles.push({
      attackerId,
      targetId,
      damage: Number(p.damage) || 0,
      remaining: gap / speed,
      action: resolved,
    });
    // Released now, resolved later: the adapter draws the shot leaving.
    this.adapter.applyAction(resolved);
  }

  /**
   * Shots land on the core's clock. A target that died or despawned mid-flight
   * takes nothing — the shot simply misses, which is what makes moving out of
   * the way a real answer to a zoning enemy.
   */
  private tickProjectiles(deltaTime: number): void {
    if (!this.projectiles.length) return;
    const landed: ProjectileRuntime[] = [];
    this.projectiles = this.projectiles.filter(projectile => {
      projectile.remaining -= deltaTime;
      if (projectile.remaining > 0) return true;
      landed.push(projectile);
      return false;
    });

    for (const projectile of landed) {
      if (!this.instances.has(projectile.targetId)) continue;
      this.applyDamage(projectile.targetId, projectile.damage);
      // Impact reuses the melee presentation contract rather than inventing a
      // second one: every adapter already flashes an ApplyAttack's target.
      this.adapter.applyAction({
        id: `${projectile.action.id}_impact`,
        type: "ApplyAttack",
        parameters: {
          entityId: projectile.attackerId,
          targetEntityId: projectile.targetId,
          damage: projectile.damage,
        },
      });
    }
    this.drainQueue();
  }

  // ---- narrative sequences ----

  /**
   * Beats fire in order, each holding the stage for a minimum dwell so a whole
   * storyline does not flush in the first frame. A gated beat waits for its
   * BeatCompleted condition; a skippable one advances anyway, which is exactly
   * what `branchTolerance` compiled down to.
   */
  private tickSequences(deltaTime: number): void {
    for (const runtime of this.sequences) {
      const beats = runtime.graph.beats;
      if (!beats.length) continue;

      if (!runtime.started) {
        runtime.started = true;
        runtime.beatElapsed = 0;
        for (const action of beats[0].triggerActions) this.executeAction(action, undefined);
        continue;
      }

      runtime.beatElapsed += deltaTime;
      const current = beats[runtime.beatIndex];
      const next = beats[runtime.beatIndex + 1];
      if (!next) continue;
      if (runtime.beatElapsed < DEFAULT_BEAT_DWELL_SECONDS) continue;

      const transition = runtime.graph.transitions.find(
        t => t.fromBeatId === current.id && t.toBeatId === next.id
      );
      const gatePasses = !transition
        || this.conditionsPass(transition.conditions, { id: "beat", type: "OnCustom" }, undefined);
      if (!gatePasses && !next.skippable) continue;

      runtime.beatIndex += 1;
      runtime.beatElapsed = 0;
      for (const action of next.triggerActions) this.executeAction(action, undefined);
    }
    this.drainQueue();
  }

  // ---- spatial helpers ----

  /**
   * Resolve a target reference to a concrete entity id. A tag resolves to the
   * NEAREST live entity carrying it, optionally inside `maxRange`, so a compiled
   * `targetTag: "player"` works in any scene without the compiler knowing
   * per-scene entity ids.
   */
  private resolveTargetId(
    selfId: string,
    targetEntityId?: string,
    targetTag?: string,
    maxRange?: number
  ): string | null {
    if (targetEntityId && this.entities.has(targetEntityId)) return targetEntityId;
    if (!targetTag) return null;

    const scene = this.activeSceneId ? this.scenes.get(this.activeSceneId) : null;
    // A scene's entity list is compiled and therefore fixed; reinforcements are
    // added here or they would be unhittable ghosts — visible, damaging, and
    // invisible to the player's own targetTag.
    const declared = scene?.entities ?? [...this.entities.keys()];
    const candidates = [...declared, ...this.spawnedEntityIds].filter(entityId => {
      if (entityId === selfId) return false;
      return this.entities.get(entityId)?.tags.includes(targetTag) ?? false;
    });

    let best: { id: string; distance: number } | null = null;
    for (const candidateId of candidates) {
      const gap = this.distanceBetween(selfId, candidateId);
      if (gap === null) continue;
      if (maxRange !== undefined && gap > maxRange) continue;
      if (!best || gap < best.distance) best = { id: candidateId, distance: gap };
    }
    // No position data (a headless adapter, or an entity the adapter dropped):
    // fall back to the first tagged candidate rather than silently doing nothing.
    if (!best) return maxRange === undefined ? candidates[0] ?? null : null;
    return best.id;
  }

  private distanceBetween(a: string, b: string): number | null {
    const from = this.adapter.getEntityPosition(a);
    const to = this.adapter.getEntityPosition(b);
    if (!from || !to) return null;
    return distance(from, to);
  }
}

function distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
