/**
 * entity-factory (open-world-courier) — EntitySpecs into a drivable city.
 *
 *   EntitySpec (from MappingEngine) -> classifyCourier() -> contracts + patrols
 *
 * Semantic mapping for this genre:
 *   procedure-step / key-item / quest-objective -> a CONTRACT: a pickup marker
 *     somewhere in the city and a drop-off somewhere else. Driving the cargo
 *     from one to the other is the act of "doing the task".
 *   evidence                                    -> the contract's drop-off brief
 *     (the "why" the player reads on delivery), or a standalone bonus contract
 *   hazard                                      -> a PATROL that raises heat
 *   npc / decision                              -> the district dispatcher
 *
 * The city itself is generated, not authored: `buildCity()` lays out a grid of
 * blocks separated by roads, then places every marker on a road tile so nothing
 * spawns inside a building.
 */
import { Vehicle } from './prefabs/Vehicle.js';
import { Waypoint } from './prefabs/Waypoint.js';
import { Patrol } from './prefabs/Patrol.js';

export const TILE = 96;

const PATROL_TYPES = new Set(['hazard', 'patrol']);
const HUB_TYPES = new Set(['npc', 'district-hub', 'decision', 'lock', 'exit-gate']);

export function classifyCourier(spec) {
  if (PATROL_TYPES.has(spec.entityType)) return 'patrol';
  if (HUB_TYPES.has(spec.entityType)) return 'hub';
  if (spec.entityType === 'evidence' || spec.mechanic === 'evidence') return 'brief';
  return 'contract';
}

export function createVehicle(ctx, pos) {
  return new Vehicle(ctx, pos);
}

export function createWaypoint(ctx, spec, opts) {
  return new Waypoint(ctx, spec, opts);
}

export function createPatrol(ctx, spec, opts) {
  return new Patrol(ctx, spec, opts);
}

/**
 * Lay out a grid city.
 *
 * `cols`/`rows` count *cells*; every third row and column is a road, the rest
 * are solid blocks. Returns the tile map plus the list of road tiles, which is
 * what every spawn placement draws from.
 */
export function buildCity({ cols = 15, rows = 15 } = {}) {
  const tiles = [];
  const roads = [];

  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      // Roads on a 3-cell lattice, plus a ring road around the whole map so the
      // player can always drive the perimeter back to anything they missed.
      const isRoad = c % 3 === 0 || r % 3 === 0 || c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
      row.push(isRoad ? 'road' : 'block');
      if (isRoad) roads.push({ c, r, x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
    }
    tiles.push(row);
  }

  return {
    cols,
    rows,
    tiles,
    roads,
    width: cols * TILE,
    height: rows * TILE,
    isRoad: (c, r) => (tiles[r]?.[c] === 'road'),
  };
}

/**
 * Build the contract list.
 *
 * Every contract gets a pickup and a drop-off at genuinely different corners of
 * the map — a delivery you can complete without driving is not a delivery. The
 * spread walks the road list at a stride so contracts fan out across districts
 * instead of clustering near the spawn.
 */
export function buildContracts(specs, city, { title = 'The City', districtSize = 4, world = null } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const contractSpecs = sorted.filter((s) => classifyCourier(s) === 'contract');
  const briefs = sorted.filter((s) => classifyCourier(s) === 'brief');
  const patrolSpecs = sorted.filter((s) => classifyCourier(s) === 'patrol');
  const hubs = sorted.filter((s) => classifyCourier(s) === 'hub');

  const roads = city.roads;
  const contracts = [];

  contractSpecs.forEach((spec, i) => {
    // Pickups walk forward through the road list; drop-offs walk from the far
    // end, guaranteeing a real distance between the two.
    const pickup = roads[(i * 7 + 3) % roads.length];
    const dropoff = roads[(roads.length - 1 - ((i * 11 + 5) % roads.length))];

    contracts.push({
      id: spec.id,
      spec,
      // The "why" attached to this delivery, cycled from evidence bindings.
      brief: briefs.length ? briefs[i % briefs.length] : null,
      pickup: { x: pickup.x, y: pickup.y },
      dropoff: { x: dropoff.x, y: dropoff.y },
      fare: spec.reward?.xp || 100,
      currency: spec.reward?.currency || 8,
      state: 'available', // available -> carrying -> delivered
    });
  });

  // Patrols get their own road tiles and a patrol axis.
  const patrols = patrolSpecs.map((spec, i) => {
    const tile = roads[(i * 13 + 8) % roads.length];
    return {
      spec,
      x: tile.x,
      y: tile.y,
      // Alternate horizontal/vertical beats so the city feels criss-crossed.
      axis: i % 2 === 0 ? 'x' : 'y',
      range: TILE * 3,
      speed: 70 + i * 12,
    };
  });

  // Districts chunk the contract list so the HUD can show meaningful progress
  // and the run has a shape rather than one undifferentiated pile of jobs.
  const districts = [];
  const districtCount = Math.max(1, Math.ceil(contracts.length / districtSize) || 1);
  for (let i = 0; i < districtCount; i++) {
    const slice = contracts.slice(i * districtSize, (i + 1) * districtSize);
    districts.push({
      id: `district-${i + 1}`,
      index: i,
      title: world
        ? world.chunkTitle(i, 'District', hubs[i]?.label)
        : hubs[i]?.label ? `District ${i + 1}: ${short(hubs[i].label)}` : `District ${i + 1}`,
      flavor: world ? world.chunkDescription(i) : '',
      dispatcher: hubs[i % Math.max(1, hubs.length)] || null,
      contracts: slice,
      isFinal: i === districtCount - 1,
    });
  }

  return { title, city, contracts, patrols, districts, dispatcher: hubs[0] || null };
}

/** A road tile far from `avoid`, used to place the player's spawn. */
export function spawnPoint(city, avoid = null, minDist = TILE * 4) {
  const roads = city.roads;
  const center = { x: city.width / 2, y: city.height / 2 };
  let best = roads[0];
  let bestScore = -Infinity;
  for (const tile of roads) {
    const distToCenter = -Math.hypot(tile.x - center.x, tile.y - center.y);
    const clear = avoid ? Math.hypot(tile.x - avoid.x, tile.y - avoid.y) : minDist;
    if (clear < minDist) continue;
    if (distToCenter > bestScore) {
      bestScore = distToCenter;
      best = tile;
    }
  }
  return { x: best.x, y: best.y };
}

function short(text, max = 26) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
