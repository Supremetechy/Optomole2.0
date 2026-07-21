/**
 * entity-factory (idle-progress) — the mapping bridge for the idle genre.
 *
 *   EntitySpec (from MappingEngine) -> generator | upgrade
 *
 * Semantic mapping for this genre:
 *   evidence / key-item / quest-objective / procedure-step / decision-point
 *        -> GENERATOR (invest to passively produce Insight; buying it "teaches"
 *           the concept by revealing its description)
 *   hazard
 *        -> UPGRADE ("Address <bottleneck>": a one-time global ×mult boost — the
 *           risk content becomes something you resolve, not a punishment)
 *   npc  -> folded into the coach briefing (see template-runtime)
 *
 * buildEconomy() also derives a small set of learning MILESTONES for the shared
 * QuestEngine so the HUD shows a completion checklist, and guarantees at least
 * one click-power upgrade and one global upgrade so both upgrade kinds exist for
 * any manifest.
 */

const GENERATOR_TYPES = new Set(['evidence', 'key-item', 'quest-objective', 'procedure-step', 'decision-point']);

export function buildEconomy(specs, { title = 'Mastery Lab' } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const conceptSpecs = sorted.filter((s) => GENERATOR_TYPES.has(s.entityType));
  const hazardSpecs = sorted.filter((s) => s.entityType === 'hazard');

  // Generators: earlier (higher-priority) concepts are cheaper and slower;
  // later ones cost far more but produce far more — the classic idle curve.
  const generators = conceptSpecs.map((s, i) => ({
    id: s.id,
    label: s.label,
    description: s.description || s.evidence || '',
    baseCost: Math.ceil(8 * Math.pow(7.2, i)),
    baseRate: round2(0.2 * Math.pow(7.5, i)),
    costGrowth: 1.15,
  }));

  // Upgrades from hazards → global multipliers ("resolve the bottleneck").
  const upgrades = hazardSpecs.map((s, i) => ({
    id: s.id,
    label: `Resolve: ${s.label}`,
    description: s.description || s.evidence || 'Clearing this bottleneck lifts all output.',
    kind: 'global',
    mult: 1.5,
    cost: Math.ceil(250 * Math.pow(9, i)),
  }));

  // Guarantee one of each upgrade kind so the panel is always meaningful.
  if (!upgrades.some((u) => u.kind === 'click')) {
    upgrades.unshift({
      id: 'up-focus',
      label: 'Deep Focus',
      description: 'Doubles the Insight you earn from each manual study click.',
      kind: 'click',
      mult: 2,
      cost: 60,
    });
  }
  if (!upgrades.some((u) => u.kind === 'global')) {
    upgrades.push({
      id: 'up-studygroup',
      label: 'Study Group',
      description: 'Peer review lifts all passive Insight output by 50%.',
      kind: 'global',
      mult: 1.5,
      cost: 1200,
    });
  }

  const milestones = buildMilestones(generators, upgrades);
  return { title, generators, upgrades, milestones };
}

/** Learning milestones surfaced through the QuestEngine (HUD checklist). */
export function buildMilestones(generators, upgrades) {
  const list = [
    { id: 'ms-first', label: 'Unlock your first concept', kind: 'generatorsOwned', target: 1 },
    { id: 'ms-half', label: `Unlock half the concepts (${Math.ceil(generators.length / 2)})`, kind: 'generatorsOwned', target: Math.max(1, Math.ceil(generators.length / 2)) },
    { id: 'ms-all', label: 'Unlock every concept', kind: 'generatorsOwned', target: generators.length },
    { id: 'ms-insight-1k', label: 'Reach 1K lifetime Insight', kind: 'lifetime', target: 1000 },
    { id: 'ms-insight-100k', label: 'Reach 100K lifetime Insight', kind: 'lifetime', target: 100000 },
    { id: 'ms-upgrades', label: 'Buy every upgrade', kind: 'upgradesBought', target: upgrades.length },
  ];
  // Drop degenerate duplicates (e.g. first == half when there's only 1 concept).
  const seen = new Set();
  return list.filter((m) => {
    const key = `${m.kind}:${m.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
