/**
 * waves.js — pure mapping-to-gameplay logic for the Phaser arcade build.
 *
 * This mirrors the semantic classification + wave chunking in the Pixi build's
 * templates/arcade-collect-avoid/entity-factory.js, but kept dependency-free
 * (no Pixi prefab imports) so the Phaser template stays self-contained. The
 * gameplay meaning of a binding is intentionally identical across both builds:
 *
 *   evidence / key-item / quest-objective / procedure-step -> GOOD orb (collect)
 *   hazard                                                  -> BAD orb (avoid)
 *   mechanic/entityType/reward.strategy 'power-up'          -> POWER orb
 */

const NON_ORB_TYPES = new Set(['npc', 'lock', 'exit-gate', 'door']);

export function classifyOrb(spec) {
  const t = spec.entityType;
  const mech = spec.mechanic;
  if (NON_ORB_TYPES.has(t)) return null;
  if (t === 'power-up' || mech === 'power-up' || spec.reward?.strategy === 'power-up') return 'power';
  if (t === 'hazard') return 'bad';
  return 'good';
}

/**
 * Group specs into waves. Each wave carries its own required GOOD orbs plus a
 * share of decoys and power-ups; difficulty ramps bad-orb speed/homing per wave.
 */
export function buildWaves(specs, { waveSize = 4, title = 'Concept Arena' } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const goods = sorted.filter((s) => classifyOrb(s) === 'good');
  const bads = sorted.filter((s) => classifyOrb(s) === 'bad');
  const powers = sorted.filter((s) => classifyOrb(s) === 'power');

  // Guarantee at least one decoy so "avoid" is always part of the loop.
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
    const decoyCount = Math.min(bads.length, 1 + i);
    const waveBads = [];
    for (let d = 0; d < decoyCount; d++) waveBads.push(bads[(i + d) % bads.length]);
    const wavePower = powers.length ? powers[i % powers.length] : null;

    waves.push({
      id: `wave-${i + 1}`,
      index: i,
      title: `Wave ${i + 1}`,
      goods: waveGoods,
      bads: waveBads,
      power: wavePower,
      badSpeed: 55 + i * 22,
      badHoming: i === 0 ? 0 : Math.min(0.9, 0.25 + i * 0.2),
      timeLimit: Math.max(16, 12 + waveGoods.length * 4),
    });
  }
  return { title, waves };
}

/**
 * Scatter `count` positions inside a {x,y,w,h} bounds rect, keeping a clear
 * radius around `avoid` (the player's spawn) so nothing lands on top of them.
 * Uses the injected `rng` (defaults to Math.random) for testability.
 */
export function scatter(count, bounds, avoid, minDist = 120, rng = Math.random) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard++;
    const x = bounds.x + 40 + rng() * (bounds.w - 80);
    const y = bounds.y + 40 + rng() * (bounds.h - 80);
    if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < minDist) continue;
    out.push({ x, y });
  }
  return out;
}
