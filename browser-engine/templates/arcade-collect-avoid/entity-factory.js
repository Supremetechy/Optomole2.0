/**
 * entity-factory (arcade-collect-avoid) — the concrete end of the mapping bridge
 * for the arcade genre.
 *
 *   EntitySpec (from MappingEngine) -> classifyOrb() -> Orb prefab (good/bad/power)
 *
 * Semantic mapping for this genre:
 *   evidence / key-item / quest-objective / procedure-step  -> GOOD orb (collect)
 *   hazard                                                   -> BAD orb (avoid)
 *   a binding flagged mechanic:'power-up' (or entityType     -> POWER orb
 *     'power-up')
 *
 * buildWaves() chunks the GOOD orbs into short waves (a "level ends when all
 * correct terms are collected" loop) and spreads the decoys/power-ups across
 * them so every wave has correct concepts to grab and wrong ones to dodge.
 */
import { Player } from './prefabs/Player.js';
import { Orb } from './prefabs/Orb.js';

// Types that never spawn as orbs in the arcade genre: NPCs become the coach
// briefing, and gates/locks have no meaning in a score-based arena.
const NON_ORB_TYPES = new Set(['npc', 'lock', 'exit-gate', 'door']);

export function classifyOrb(spec) {
  const t = spec.entityType;
  const mech = spec.mechanic;
  if (NON_ORB_TYPES.has(t)) return null;
  if (t === 'power-up' || mech === 'power-up' || spec.reward?.strategy === 'power-up') return 'power';
  if (t === 'hazard') return 'bad';
  // Everything else the compiler emits as a collectible concept is a "correct" term.
  return 'good';
}

export function createPlayer(ctx, pos) {
  return new Player(ctx, pos);
}

export function createOrb(ctx, spec, opts) {
  return new Orb(ctx, spec, opts);
}

/**
 * Group specs into waves. Each wave carries its own required GOOD orbs plus a
 * share of decoys and power-ups. `difficulty` ramps bad-orb speed/homing per
 * wave so later rounds demand sharper dodging.
 */
export function buildWaves(specs, { waveSize = 4, title = 'Concept Arena', world = null } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const goods = sorted.filter((s) => classifyOrb(s) === 'good');
  const bads = sorted.filter((s) => classifyOrb(s) === 'bad');
  const powers = sorted.filter((s) => classifyOrb(s) === 'power');

  // Guarantee at least one decoy so "avoid" is always part of the loop; if the
  // content had no hazard binding, mint a generic distractor from a good label.
  if (bads.length === 0 && goods.length > 1) {
    bads.push({
      id: 'decoy-generic',
      entityType: 'hazard',
      label: 'Distractor',
      description: 'A wrong answer — dodge it.',
      reward: {},
      priority: 0,
    });
  }

  const waveCount = Math.max(1, Math.ceil(goods.length / waveSize) || 1);
  const waves = [];
  for (let i = 0; i < waveCount; i++) {
    const waveGoods = goods.slice(i * waveSize, (i + 1) * waveSize);
    // 1–3 decoys per wave, scaling up with difficulty, cycled from the pool.
    const decoyCount = Math.min(bads.length, 1 + Math.floor(i / 1));
    const waveBads = [];
    for (let d = 0; d < decoyCount; d++) waveBads.push(bads[(i + d) % bads.length]);
    const wavePower = powers.length ? powers[i % powers.length] : null;

    waves.push({
      id: `wave-${i + 1}`,
      index: i,
      title: world ? world.chunkTitle(i, 'Wave', waveGoods[0]?.label) : `Wave ${i + 1}`,
      flavor: world ? world.chunkDescription(i) : '',
      goods: waveGoods,
      bads: waveBads,
      power: wavePower,
      // Difficulty ramp: faster decoys, and homing kicks in from wave 2.
      badSpeed: 55 + i * 22,
      badHoming: i === 0 ? 0 : Math.min(0.9, 0.25 + i * 0.2),
      timeLimit: Math.max(16, 12 + waveGoods.length * 4),
    });
  }
  return { title, waves };
}

/**
 * Scatter positions inside `bounds`, keeping a clear radius around the player's
 * spawn so nothing lands on top of them at wave start.
 */
export function scatter(count, bounds, avoid, minDist = 120) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard++;
    const x = bounds.x + 40 + Math.random() * (bounds.w - 80);
    const y = bounds.y + 40 + Math.random() * (bounds.h - 80);
    if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < minDist) continue;
    out.push({ x, y });
  }
  return out;
}
