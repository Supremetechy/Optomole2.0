/**
 * entity-factory (sandbox-craft-build) — EntitySpecs into a gatherable world.
 *
 *   EntitySpec (from MappingEngine) -> classifySandbox() -> nodes + recipes
 *
 * Semantic mapping for this genre:
 *   evidence / definition / key-item -> RESOURCE NODE. Mining it yields units of
 *     one of three materials and reveals the underlying fact while you mine.
 *   procedure-step / quest-objective -> RECIPE. Costs resources, and crafting it
 *     produces a structure you place on the map. Doing the step *is* the craft.
 *   decision / lock / exit-gate      -> BLUEPRINT GOAL. The run completes when
 *     every blueprint's required structures are standing.
 *   hazard                           -> HAZARD ZONE that drains energy.
 *   npc                              -> the foreman's opening brief.
 *
 * Resource typing is deterministic (hashed from the spec id) so a given piece of
 * content always mines the same material — recipes stay legible across replays.
 */
import { Builder } from './prefabs/Builder.js';
import { ResourceNode } from './prefabs/ResourceNode.js';
import { Structure } from './prefabs/Structure.js';

export const TILE = 64;

export const MATERIALS = [
  { id: 'ore', label: 'Insight Ore', texture: 'node-ore', color: 0x38bdf8 },
  { id: 'wood', label: 'Practice Timber', texture: 'node-wood', color: 0xb45309 },
  { id: 'stone', label: 'Principle Stone', texture: 'node-stone', color: 0x94a3b8 },
];

const RECIPE_TYPES = new Set(['procedure-step', 'quest-objective', 'recipe']);
const GOAL_TYPES = new Set(['decision', 'lock', 'exit-gate', 'blueprint-goal']);
const HAZARD_TYPES = new Set(['hazard', 'hazard-zone']);

export function classifySandbox(spec) {
  if (spec.entityType === 'npc') return 'foreman';
  if (HAZARD_TYPES.has(spec.entityType)) return 'hazard';
  if (GOAL_TYPES.has(spec.entityType)) return 'goal';
  if (RECIPE_TYPES.has(spec.entityType) || RECIPE_TYPES.has(spec.mechanic)) return 'recipe';
  return 'node';
}

export function createBuilder(ctx, pos) {
  return new Builder(ctx, pos);
}

export function createNode(ctx, spec, opts) {
  return new ResourceNode(ctx, spec, opts);
}

export function createStructure(ctx, spec, opts) {
  return new Structure(ctx, spec, opts);
}

/** Stable hash so the same content always yields the same material. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function materialFor(spec) {
  return MATERIALS[hash(spec.id) % MATERIALS.length];
}

/**
 * Build the world: a tile field with nodes, hazard zones, recipes, and
 * blueprints.
 *
 * Node placement uses a jittered grid rather than pure random so nothing spawns
 * in a clump the player can strip without walking, and nothing lands on the
 * spawn pad.
 */
export function buildWorld(specs, { title = 'The Claim', cols = 20, rows = 15 } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const nodeSpecs = sorted.filter((s) => classifySandbox(s) === 'node');
  const recipeSpecs = sorted.filter((s) => classifySandbox(s) === 'recipe');
  const goalSpecs = sorted.filter((s) => classifySandbox(s) === 'goal');
  const hazardSpecs = sorted.filter((s) => classifySandbox(s) === 'hazard');
  const foreman = sorted.find((s) => classifySandbox(s) === 'foreman') || null;

  const width = cols * TILE;
  const height = rows * TILE;
  const spawn = { x: width / 2, y: height / 2 };

  const nodes = scatterOnGrid(nodeSpecs, { cols, rows, spawn, minDist: TILE * 2 })
    .map(({ spec, x, y }) => {
      const material = materialFor(spec);
      return {
        spec,
        x,
        y,
        material,
        // Denser content yields more: a long fact is worth more than a one-liner.
        yield: 2 + Math.min(3, Math.floor((spec.description || '').length / 90)),
        hits: 3,
      };
    });

  const hazards = scatterOnGrid(hazardSpecs, { cols, rows, spawn, minDist: TILE * 3, offset: 7 })
    .map(({ spec, x, y }) => ({ spec, x, y, radius: TILE * 1.4, drain: 12 }));

  // Recipes cost materials in proportion to their position in the procedure:
  // later steps are more expensive, so the world has a natural progression.
  const recipes = recipeSpecs.map((spec, i) => {
    const primary = materialFor(spec);
    const secondary = MATERIALS[(MATERIALS.indexOf(primary) + 1) % MATERIALS.length];
    const tier = 1 + Math.floor(i / 3);
    return {
      id: spec.id,
      spec,
      tier,
      cost: {
        [primary.id]: 2 + tier,
        [secondary.id]: 1 + Math.floor(tier / 2),
      },
      crafted: false,
      placed: false,
    };
  });

  // Blueprints group recipes into milestones. Without explicit decision bindings
  // we mint one blueprint covering everything, so the run still has an end.
  const blueprints = [];
  if (goalSpecs.length) {
    const per = Math.max(1, Math.ceil(recipes.length / goalSpecs.length));
    goalSpecs.forEach((spec, i) => {
      blueprints.push({
        id: spec.id,
        spec,
        requires: recipes.slice(i * per, (i + 1) * per).map((r) => r.id),
        complete: false,
      });
    });
  } else {
    blueprints.push({
      id: 'blueprint-main',
      spec: {
        id: 'blueprint-main',
        label: 'The Build',
        description: 'Craft and place every structure to complete the build.',
        reward: { xp: 200, currency: 25 },
      },
      requires: recipes.map((r) => r.id),
      complete: false,
    });
  }

  return {
    title,
    cols,
    rows,
    width,
    height,
    spawn,
    nodes,
    hazards,
    recipes,
    blueprints,
    foreman,
    materials: MATERIALS,
  };
}

/**
 * Place specs on a jittered grid, skipping cells too close to the spawn pad.
 * `offset` shifts which cells are used so two calls (nodes, hazards) do not
 * fight for the same tiles.
 */
function scatterOnGrid(specs, { cols, rows, spawn, minDist = 128, offset = 0 }) {
  const out = [];
  const cells = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) cells.push({ c, r });
  }

  // Walk the cell list at a stride so placements spread across the whole map.
  const stride = Math.max(1, Math.floor(cells.length / Math.max(1, specs.length)));
  let cursor = offset % Math.max(1, cells.length);

  for (const spec of specs) {
    let placed = null;
    for (let attempt = 0; attempt < cells.length && !placed; attempt++) {
      const cell = cells[cursor % cells.length];
      cursor += stride;
      // Deterministic jitter keeps the grid from reading as a grid.
      const jx = ((hash(spec.id + attempt) % 40) - 20);
      const jy = ((hash(`${spec.id}y${attempt}`) % 40) - 20);
      const x = cell.c * TILE + TILE / 2 + jx;
      const y = cell.r * TILE + TILE / 2 + jy;
      if (Math.hypot(x - spawn.x, y - spawn.y) < minDist) continue;
      placed = { spec, x, y };
    }
    if (placed) out.push(placed);
  }

  return out;
}

/** Can this recipe be afforded from `inventory` ({ ore: n, wood: n, stone: n })? */
export function canAfford(recipe, inventory) {
  return Object.entries(recipe.cost).every(([mat, n]) => (inventory[mat] || 0) >= n);
}

/** Spend a recipe's cost. Returns the new inventory (does not mutate). */
export function spendCost(recipe, inventory) {
  const next = { ...inventory };
  for (const [mat, n] of Object.entries(recipe.cost)) {
    next[mat] = Math.max(0, (next[mat] || 0) - n);
  }
  return next;
}
