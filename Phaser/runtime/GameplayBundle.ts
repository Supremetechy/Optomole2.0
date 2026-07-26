import {
  Action,
  AssetSpec,
  Component,
  DirectorProgram,
  Entity,
  Game,
  PhysicsComponent,
  RenderComponent,
  Scene,
  SequenceGraph,
  StateMachine,
  TransformComponent,
  Trigger,
} from "../dsl/types";

/**
 * A GameplayBundle is one playable experience as pure data: everything the
 * RuntimeCore needs, and nothing engine-specific. Two sources produce one:
 *
 *  - the static SkyRun content in /game (hand-authored reference), and
 *  - the API's GameplayDslService, which projects a compiled
 *    ExperiencePackage → ExperienceBuild → this shape.
 *
 * Because both sources emit the same bundle, any EngineAdapter can play either
 * without knowing which one it got.
 */
export interface GameplayBundle {
  game: Game;
  scenes: Scene[];
  entities: Entity[];
  stateMachines: StateMachine[];
  triggers: Trigger[];
  /** Tick-driven programs (pacing, squad coordination). Absent in older bundles. */
  directors?: DirectorProgram[];
  /** Beat-ordered narrative graphs. Absent in older bundles. */
  sequences?: SequenceGraph[];
  /** Compiler-declared sprite vocabulary; drives placeholder art when present. */
  assets?: AssetSpec[];
}

/** Where a bundle came from, for the on-screen provenance line. */
export type BundleSource = { kind: "static" } | { kind: "remote"; url: string };

// ---- loading ----

/** The `?bundle=<url>` parameter, if the page was opened with one. */
export function readBundleUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("bundle");
  } catch {
    return null;
  }
}

/**
 * Fetch a compiled bundle. Accepts the API's `{ ok, bundle }` envelope or a
 * bare bundle document, so a bundle served from a static file works too.
 */
export async function fetchBundle(url: string): Promise<GameplayBundle> {
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const body = await response.json();
  const bundle = (body?.bundle ?? body) as GameplayBundle;
  if (!bundle?.game || !Array.isArray(bundle.scenes) || !bundle.scenes.length) {
    throw new Error("Response is not a gameplay bundle (missing game/scenes).");
  }
  return {
    game: bundle.game,
    scenes: bundle.scenes,
    entities: bundle.entities ?? [],
    stateMachines: bundle.stateMachines ?? [],
    triggers: bundle.triggers ?? [],
    directors: bundle.directors ?? [],
    sequences: bundle.sequences ?? [],
    assets: bundle.assets ?? [],
  };
}

/**
 * Resolve what to play: a compiled bundle when `?bundle=` is present, else the
 * hand-authored fallback. A failed fetch never blanks the page — it falls back
 * and reports why, so a broken URL still leaves something playable on screen.
 */
export async function resolveBundle(
  fallback: GameplayBundle
): Promise<{ bundle: GameplayBundle; source: BundleSource; error?: string }> {
  const url = readBundleUrl();
  if (!url) return { bundle: fallback, source: { kind: "static" } };
  try {
    return { bundle: await fetchBundle(url), source: { kind: "remote", url } };
  } catch (err) {
    console.warn(`[bundle] failed to load ${url}:`, err);
    return {
      bundle: fallback,
      source: { kind: "static" },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The scene a bundle opens on: the game's first declared scene. */
export function entrySceneId(bundle: GameplayBundle): string {
  return bundle.game.scenes[0] ?? bundle.scenes[0].id;
}

// ---- placeholder art ----

/**
 * A flat-color stand-in for one sprite id. The prototype ships no binary art:
 * both adapters generate these so any compiled bundle is playable the moment
 * it is emitted, without an asset pipeline.
 */
export interface SpriteSpec {
  id: string;
  widthUnits: number;
  heightUnits: number;
  color: number;
}

/** First matching tag or archetype wins; order is most-specific first. */
const ROLE_COLORS: Array<[string, number]> = [
  ["player", 0x4f8ef7],
  ["ground", 0x5a4632],
  ["platform", 0x5a4632],
  ["enemy", 0xd94f4f],
  ["goal", 0x57d95e],
  ["collectible", 0xf7c948],
  ["npc", 0xb26ff7],
];
const DEFAULT_COLOR = 0x8892b0;
const DEFAULT_SIZE = 1;

/**
 * Derive one spec per sprite id referenced anywhere in the bundle — both
 * RenderComponent sprite ids and PlayAnimation targets, so a state that swaps
 * to `player_jump` finds a texture waiting for it.
 */
export function spriteSpecs(bundle: GameplayBundle): SpriteSpec[] {
  const specs = new Map<string, SpriteSpec>();

  // A compiled bundle declares its own vocabulary, tinted from the palette the
  // content's emotional arc produced. Those win over the role-color table: two
  // experiences built from different sources should not look identical.
  for (const asset of bundle.assets ?? []) {
    specs.set(asset.spriteId, {
      id: asset.spriteId,
      widthUnits: asset.width || DEFAULT_SIZE,
      heightUnits: asset.height || DEFAULT_SIZE,
      color: parseHexColor(asset.tint) ?? colorFor(undefined, asset.spriteId),
    });
  }

  for (const entity of bundle.entities) {
    const render = componentOf<RenderComponent>(entity, "RenderComponent");
    if (!render) continue;
    if (!specs.has(render.spriteId)) specs.set(render.spriteId, specFor(render.spriteId, entity));
  }

  // Animation ids name the same silhouette as the entity that plays them.
  for (const action of everyAction(bundle)) {
    if (action.type !== "PlayAnimation") continue;
    const animationId = action.parameters?.animationId;
    if (typeof animationId !== "string" || specs.has(animationId)) continue;
    const owner = bundle.entities.find(e => e.id === action.parameters?.entityId);
    specs.set(animationId, specFor(animationId, owner));
  }

  return [...specs.values()];
}

/**
 * How far right the world extends, in DSL units — used to size camera and
 * physics bounds for a bundle whose length isn't known in advance.
 */
export function worldWidthUnits(bundle: GameplayBundle): number {
  let max = 0;
  for (const entity of bundle.entities) {
    const transform = componentOf<TransformComponent>(entity, "TransformComponent");
    if (!transform) continue;
    const scale = transform.scale?.x ?? 1;
    const collider = componentOf<PhysicsComponent>(entity, "PhysicsComponent")?.colliderShape;
    const halfWidth = ((collider?.width ?? collider?.radius ?? DEFAULT_SIZE) * scale) / 2;
    max = Math.max(max, transform.position.x + halfWidth);
  }
  return max;
}

/** Look up an entity's component by its discriminant. */
export function componentOf<T extends Component>(entity: Entity, type: T["type"]): T | undefined {
  return entity.components.find((c): c is T => c.type === type);
}

// ---- internals ----

function specFor(spriteId: string, entity?: Entity): SpriteSpec {
  const collider = entity ? componentOf<PhysicsComponent>(entity, "PhysicsComponent")?.colliderShape : undefined;
  const radius = collider?.radius;
  return {
    id: spriteId,
    // Collider dimensions are base units, before transform scale — so one tile
    // definition stretches into a platform instead of tiling a giant texture.
    widthUnits: collider?.width ?? (radius ? radius * 2 : DEFAULT_SIZE),
    heightUnits: collider?.height ?? (radius ? radius * 2 : DEFAULT_SIZE),
    color: colorFor(entity, spriteId),
  };
}

function colorFor(entity: Entity | undefined, spriteId: string): number {
  const words = [...(entity?.tags ?? []), entity?.archetype ?? "", spriteId]
    .join(" ")
    .toLowerCase();
  for (const [role, color] of ROLE_COLORS) {
    if (words.includes(role)) return color;
  }
  return DEFAULT_COLOR;
}

/** "#ff4d4d" -> 0xff4d4d. Returns null for anything that is not a hex color. */
function parseHexColor(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? parseInt(match[1], 16) : null;
}

function* everyAction(bundle: GameplayBundle): Generator<Action> {
  for (const trigger of bundle.triggers) yield* trigger.actions;
  for (const director of bundle.directors ?? []) {
    yield* director.onTickActions;
    yield* director.scheduledActions;
  }
  for (const sequence of bundle.sequences ?? []) {
    for (const beat of sequence.beats) yield* beat.triggerActions;
  }
  for (const machine of bundle.stateMachines) {
    for (const state of machine.states) {
      yield* state.onEnterActions ?? [];
      yield* state.onExitActions ?? [];
      yield* state.onUpdateActions ?? [];
    }
    for (const transition of machine.transitions) yield* transition.actions ?? [];
  }
}
