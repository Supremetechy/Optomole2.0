import {
  Game,
  Scene,
  Entity,
  Event,
  StateMachine,
  StateComponent,
  Trigger,
  Transition,
  Condition,
  Action,
  DirectorProgram,
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
      case "DespawnEntity": {
        // Core-side cleanup first so a dead entity stops running its machine
        // and stops holding a squad slot; the adapter still removes the sprite.
        const entityId = action.parameters.entityId ?? inst?.entityId;
        if (entityId) {
          this.instances.delete(entityId);
          this.timers.delete(entityId);
          this.releaseAttackSlot(entityId);
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
      this.executeAction(
        {
          ...action,
          parameters: {
            ...action.parameters,
            tension,
            elapsedSeconds: Number(director.elapsed.toFixed(2)),
            // The compiled base rate scaled by where the curve is now — the
            // spawn budget an adapter actually applies.
            resolvedRate:
              typeof action.parameters.baseRate === "number"
                ? Number((action.parameters.baseRate * tension).toFixed(3))
                : undefined,
          },
        },
        undefined
      );
      return;
    }
    this.executeAction(action, undefined);
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

    const target = this.instances.get(targetId);
    const damage = Number(p.damage) || 0;
    if (target && typeof target.variables.health === "number") {
      target.variables.health = Math.max(0, Number(target.variables.health) - damage);
      this.emit({
        id: `health_${targetId}`,
        type: "OnHealthChanged",
        payload: { health: target.variables.health, damage },
        sourceEntityId: targetId,
      });
      if (target.variables.health <= 0) {
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
    }

    this.adapter.applyAction({
      ...action,
      parameters: { ...p, entityId: attackerId, targetEntityId: targetId, damage },
    });
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
    const candidates = (scene?.entities ?? [...this.entities.keys()]).filter(entityId => {
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
