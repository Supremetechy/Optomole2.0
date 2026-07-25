/**
 * entity-factory (fps-target-gallery) — EntitySpecs into a first-person range.
 *
 *   EntitySpec (from MappingEngine) -> classifyTarget() -> Target billboard
 *
 * Semantic mapping for this genre:
 *   hazard / definition / key-item / quest-objective -> HOSTILE  (shoot it)
 *   anything flagged as a distractor / decoy          -> BYSTANDER (hold fire)
 *   evidence with a power-up reward strategy          -> BONUS    (shoot, ×2)
 *   npc                                               -> range officer briefing
 *
 * The range is not a 3D world — it is a 2D ground plane the camera looks across.
 * Targets carry (x, z) world coordinates; the scene projects them to screen with
 * a pinhole camera each frame. That gives real depth, occlusion ordering, and
 * "further targets are smaller and harder" without a mesh pipeline.
 */
import { Target } from './prefabs/Target.js';

const BYSTANDER_HINTS = ['distractor', 'decoy', 'bystander', 'safe', 'benign'];

export function classifyTarget(spec) {
  // Non-target bindings: the NPC becomes the range officer's brief, and a metric
  // marker becomes the qualification threshold on the result card.
  if (spec.entityType === 'npc' || spec.entityType === 'range-marker') return null;
  const mech = String(spec.mechanic || '').toLowerCase();
  const type = String(spec.entityType || '').toLowerCase();

  if (BYSTANDER_HINTS.some((h) => type.includes(h) || mech.includes(h))) return 'bystander';
  if (type === 'bystander-target') return 'bystander';
  if (type === 'bonus-target' || spec.reward?.strategy === 'score-multiplier') return 'bonus';
  return 'hostile';
}

export function createTarget(ctx, spec, opts) {
  return new Target(ctx, spec, opts);
}

/**
 * Group targets into rounds. Each round mixes hostiles with at least one
 * bystander, because the whole point of the drill is fire discipline: hitting
 * everything downrange must not be a winning strategy.
 */
export function buildRounds(specs, { roundSize = 4, title = 'The Range', world = null } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const hostiles = sorted.filter((s) => classifyTarget(s) === 'hostile');
  const bystanders = sorted.filter((s) => classifyTarget(s) === 'bystander');
  const bonuses = sorted.filter((s) => classifyTarget(s) === 'bonus');

  // Without an explicit decoy the drill degenerates into "shoot everything", so
  // mint one generic bystander from the content's own framing.
  if (bystanders.length === 0 && hostiles.length > 1) {
    bystanders.push({
      id: 'bystander-generic',
      entityType: 'bystander-target',
      label: 'Routine / expected activity',
      description: 'Normal behaviour — engaging this costs accuracy.',
      reward: {},
      priority: 0,
    });
  }

  const roundCount = Math.max(1, Math.ceil(hostiles.length / roundSize) || 1);
  const rounds = [];

  for (let i = 0; i < roundCount; i++) {
    const roundHostiles = hostiles.slice(i * roundSize, (i + 1) * roundSize);
    const bystanderCount = bystanders.length ? Math.min(bystanders.length, 1 + Math.floor(i / 2)) : 0;
    const roundBystanders = [];
    for (let b = 0; b < bystanderCount; b++) {
      roundBystanders.push(bystanders[(i + b) % bystanders.length]);
    }
    const roundBonus = bonuses.length ? bonuses[i % bonuses.length] : null;

    const all = [...roundHostiles, ...roundBystanders, ...(roundBonus ? [roundBonus] : [])];

    rounds.push({
      id: `round-${i + 1}`,
      index: i,
      title: world ? world.chunkTitle(i, 'Round', roundHostiles[0]?.label) : `Round ${i + 1}`,
      flavor: world ? world.chunkDescription(i) : '',
      hostiles: roundHostiles,
      bystanders: roundBystanders,
      bonus: roundBonus,
      placements: layoutDownrange(all, i),
      // Later rounds: less time, and targets that strafe.
      timeLimit: Math.max(18, 16 + roundHostiles.length * 5 - i * 2),
      strafeSpeed: i === 0 ? 0 : Math.min(2.6, 0.6 + i * 0.5),
    });
  }

  return { title, rounds };
}

/**
 * Place targets on the ground plane in front of the camera.
 *
 * Lanes fan out across the field of view and depth alternates near/far so the
 * player must actually look around and judge distance, rather than sweeping a
 * single line. `round` shifts the pattern so consecutive rounds do not repeat.
 */
export function layoutDownrange(specs, round = 0) {
  const out = new Map();
  const count = specs.length || 1;
  const spread = 9.5; // world units left-to-right across the whole lineup

  specs.forEach((spec, i) => {
    // Even indices sit deeper; odd ones step forward. Small round offset avoids
    // an identical silhouette every round.
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = (t - 0.5) * spread * 2;
    const depthBand = i % 2 === 0 ? 15 : 9.5;
    const z = depthBand + ((i * 2.7 + round * 1.9) % 5);
    out.set(spec.id, { x, z, homeX: x });
  });

  return out;
}

/**
 * Camera height above the ground plane, in world units. Also the constant the
 * ground grid is drawn with, so targets and lane lines agree on where the floor
 * is — get these out of sync and targets appear to float.
 */
export const CAMERA_HEIGHT = 0.9;

/** Height of a standing target in world units, used to size its billboard. */
export const TARGET_WORLD_HEIGHT = 1.8;

/**
 * Project a world point onto the screen through a pinhole camera.
 *
 *   camera: { x, z, yaw }   world position + heading (radians)
 *
 * Returns the screen position of the point's *base* on the ground plane, plus
 * `scale` (screen pixels per world unit at that depth) and `depth` for sorting.
 * Returns null when the point is behind the near plane.
 */
export function project(point, camera, view) {
  const dx = point.x - camera.x;
  const dz = point.z - camera.z;

  // Rotate into camera space (yaw only — the range is a flat plane).
  // Yaw is measured as atan2(x, z): 0 looks straight down +z, positive turns
  // toward +x. This rotation must invert exactly that, or a target the camera
  // is pointed at won't land on the crosshair.
  const cos = Math.cos(camera.yaw);
  const sin = Math.sin(camera.yaw);
  const cx = dx * cos - dz * sin;
  const cz = dx * sin + dz * cos;

  if (cz <= 0.6) return null; // behind or too close to the near plane

  const focal = view.focal;
  return {
    screenX: view.cx + (cx / cz) * focal,
    // Where this point's ground contact lands below the horizon.
    screenY: view.horizon + (focal * CAMERA_HEIGHT) / cz,
    scale: focal / cz, // screen pixels per world unit at this depth
    depth: cz,
  };
}

/** Camera field-of-view geometry for a given viewport. */
export function makeView(width, height) {
  return {
    cx: width / 2,
    horizon: height * 0.52,
    focal: Math.min(width, height * 1.6) * 0.9,
    width,
    height,
  };
}
