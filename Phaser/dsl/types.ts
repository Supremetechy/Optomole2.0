// Gameplay DSL — the engine-agnostic contract between compiled content
// and any runtime (Phaser today; Unity/Unreal/Pixi adapters later).
// Mirrors the JSON Schemas in ../../game/*.schema.json.

export interface Vector3 { x: number; y: number; z: number; }

export type SystemType =
  | "physics"
  | "input"
  | "combat"
  | "ui"
  | "animation"
  | "audio";

export interface GameConfig {
  gravity: Vector3;
  pixelPerUnit?: number;
}

export interface Game {
  id: string;
  title: string;
  version: string;
  config: GameConfig;
  scenes: string[];
  globalSystems: SystemType[];
}

export interface Scene {
  id: string;
  name: string;
  systems: SystemType[];
  entities: string[];
  entryTriggers: string[];
  exitTriggers: string[];
  /** The compiled region this scene plays; directors are scoped to it. */
  regionId?: string | null;
  /** Ids of the DirectorPrograms that run while this scene is active. */
  directors?: string[];
  /** Presentation derived from the content's emotional arc. */
  palette?: string[];
  ambientIntensity?: number;
}

export interface Entity {
  id: string;
  archetype: string;
  tags: string[];
  components: Component[];
}

// ---- Components (ECS-style, data-only) ----

export type Component =
  | TransformComponent
  | RenderComponent
  | PhysicsComponent
  | InputComponent
  | StateComponent
  | ScriptComponent
  | UIComponent;

export interface TransformComponent {
  type: "TransformComponent";
  position: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
}

export interface RenderComponent {
  type: "RenderComponent";
  spriteId: string;
  layer: string;
}

/**
 * Collider dimensions are BASE units, before the entity's TransformComponent
 * scale. A 1×1 box on an entity scaled 10× is ten units wide. Adapters and the
 * placeholder-art generator both rely on this, so a wide platform is one tile
 * definition stretched, not a re-declared size in two places that can drift.
 */
export interface ColliderShape {
  type: "box" | "circle" | "capsule" | "polygon";
  width?: number;
  height?: number;
  radius?: number;
}

export interface PhysicsComponent {
  type: "PhysicsComponent";
  bodyType: "static" | "dynamic" | "kinematic";
  mass?: number;
  colliderShape: ColliderShape;
  collisionTags: string[];
}

export interface InputBinding {
  action: string;
  keys: string[];
}

export interface InputComponent {
  type: "InputComponent";
  bindings: InputBinding[];
}

export interface StateComponent {
  type: "StateComponent";
  stateMachineId: string;
  initialState: string;
  variables: Record<string, number | boolean | string>;
}

export interface ScriptComponent {
  type: "ScriptComponent";
  scripts: string[];
}

export interface UIComponent {
  type: "UIComponent";
  widgetType: string;
  layout?: unknown;
  bindings?: unknown;
}

// ---- Events, Conditions, Actions ----

export type EventType =
  | "OnInput"
  | "OnCollision"
  | "OnSceneEnter"
  | "OnSceneExit"
  | "OnSceneComplete"
  | "OnTimer"
  // Combat-side events. The core emits the first three on its own clock so a
  // behavior tree can advance without the player touching anything: perception
  // and distance are polled, timers expire, health changes when damage lands.
  | "OnTimerElapsed"
  | "OnPerception"
  | "OnDistanceCheck"
  | "OnHealthChanged"
  | "OnCustom";

export interface Event {
  id: string;
  type: EventType;
  payload?: any;
  sourceEntityId?: string;
  targetEntityId?: string;
  timestamp?: number;
}

export type ConditionType =
  | "InputIsPressed"
  | "InputReleasedAll"
  | "VariableEquals"
  | "CollisionWithTag"
  | "CollisionPair"
  | "TimerElapsed"
  | "WithinRange"
  | "TargetInSightRange"
  | "HealthBelowThreshold"
  // Granted/denied is the ONLY thing an enemy learns from its squad. All the
  // "why" (pressure, flanking, cooldown) stays in the coordinator.
  | "AttackSlotGranted"
  | "AttackSlotDenied"
  | "BeatCompleted"
  | "Expression";

export interface Condition {
  id: string;
  type: ConditionType;
  parameters: Record<string, any>;
}

export type ActionType =
  | "PlayAnimation"
  | "ApplyImpulse"
  | "ApplyHorizontalMovementFromInput"
  // Four-direction steering for gravity-free topologies (maps, boards, rooms).
  // Separate from the horizontal action rather than a flag on it: a side-scroller
  // must not be one parameter away from letting the player fly.
  | "ApplyPlanarMovementFromInput"
  | "SetVariable"
  | "SpawnEntity"
  | "DespawnEntity"
  | "EmitEvent"
  | "LoadScene"
  | "ShowMessage"
  | "PatrolBetweenPoints"
  // Timers are core-owned so expiry is deterministic across adapters.
  | "StartTimer"
  // Movement toward/away/around a target. The core resolves `targetTag` to a
  // concrete `targetEntityId` before handing these over, so an adapter never
  // searches the world — it just moves a body.
  | "ApplyMovementTowardTarget"
  | "ApplyMovementAwayFromTarget"
  | "ApplyOrbitMovement"
  // Zoning: hold a band around the target rather than closing on it. One action
  // rather than toward/away gated by a condition, because a state machine can
  // only branch on transitions and a standoff has to correct every frame.
  | "ApplyStandoffMovement"
  | "ApplyAttack"
  // A zoning enemy's strike. Damage is core-resolved after `travelTime`, so a
  // shot that is dodged in flight misses — which is what makes range fair.
  | "FireProjectile"
  // Director-emitted. The core samples the curve and passes a scalar; the
  // adapter never decides what "escalating" means.
  | "EvaluateSpawnBudget"
  | "SetMusicIntensity"
  | "TriggerBreather"
  | "ArbitrateSquadAttack"
  | "BroadcastVariable"
  | "PlayCutsceneOrDialogue";

export interface Action {
  id: string;
  type: ActionType;
  parameters: Record<string, any>;
}

// ---- Directors (tick-driven programs: pacing, squad coordination) ----

/**
 * Pacing and squad coordination are not per-entity state machines: they are
 * tick loops plus scheduled events over a region. Same shape for both, so the
 * runtime needs one extra executor rather than two.
 */
export interface DirectorProgram {
  id: string;
  scope: "region" | "level";
  targetId: string;
  tickIntervalSeconds: number;
  onTickActions: Action[];
  scheduledActions: Array<Action & { repeatEverySeconds: number }>;
  /**
   * The beat plan a pacing director walks, in order, looping while the region
   * is occupied. Only the `enemyDensity` half is spent here: the geometry the
   * beats asked for was already compiled into the scene's platform run.
   */
  beats?: LevelBeat[];
}

export type LevelBeatType = "calm" | "build" | "peak" | "release";

export interface LevelBeat {
  type: LevelBeatType;
  duration: number;
  enemyDensity: number;
  traversalComplexity: number;
}

// ---- Sequences (beat-ordered narrative) ----

export interface SequenceBeat {
  id: string;
  order: number;
  label: string;
  /** A skippable beat advances even when its preconditions have not been met. */
  skippable: boolean;
  triggerActions: Action[];
}

export interface SequenceGraph {
  id: string;
  beats: SequenceBeat[];
  transitions: Array<{
    fromBeatId: string;
    toBeatId: string;
    conditions: Condition[];
  }>;
}

// ---- Assets ----

/**
 * The sprite vocabulary a bundle references, declared once by the compiler so
 * the placeholder-art generator and every renderer resolve an id identically.
 */
export interface AssetSpec {
  spriteId: string;
  role: string;
  shape: string;
  width: number;
  height: number;
  tint: string;
  palette: string[];
}

// ---- Triggers (data-driven rule engine) ----

export interface Trigger {
  id: string;
  scope: "scene" | "entity" | "global";
  eventType: EventType;
  conditions: Condition[];
  actions: Action[];
  priority?: number;
  /**
   * Which scene a `scene`-scoped trigger belongs to. Without it the runtime has
   * no way to tell one region's rules from another's, and every scene's entry
   * message fires the moment the first scene loads.
   */
  sceneId?: string;
}

// ---- State machines ----

export interface State {
  id: string;
  onEnterActions?: Action[];
  onExitActions?: Action[];
  onUpdateActions?: Action[];
}

export interface Transition {
  fromStateId: string;
  toStateId: string;
  eventType: EventType;
  conditions: Condition[];
  actions?: Action[];
  priority?: number;
}

export interface StateMachine {
  id: string;
  states: State[];
  transitions: Transition[];
  initialState: string;
}
