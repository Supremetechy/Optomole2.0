/**
 * entity-factory (board-resource-sim) — the mapping bridge for the board genre.
 *
 *   EntitySpec (from MappingEngine) -> board space
 *
 * Semantic mapping for this genre:
 *   evidence / key-item / quest-objective  -> CONCEPT space (collect for Knowledge)
 *   procedure-step / decision-point        -> EVENT space (a learning beat on landing)
 *   hazard                                 -> HAZARD space (setback on landing)
 *   npc                                    -> folded into the coach briefing
 *
 * buildBoard() prepends a START square (lap bonus + refuel) and orders the rest
 * so concepts, events, and hazards interleave around the loop. layoutRing()
 * places every space evenly around the perimeter of the play area.
 */

// Not board spaces: NPCs become the coach briefing; gates/locks have no board role.
const SKIP_TYPES = new Set(['npc', 'lock', 'exit-gate', 'door']);
// Source procedure/decision types (if the compiler passes them through directly).
const EVENT_TYPES = new Set(['procedure-step', 'decision-point']);

/**
 * Classify a spec into a board space kind. The compiler collapses procedure
 * steps onto `entityType: 'quest-objective'`, so the surviving signal that a
 * binding is a *sequence step* (→ event) rather than a *collectible* (→ concept)
 * is `interaction: 'sequence'` vs `'collect'`.
 */
function spaceKind(s) {
  if (s.entityType === 'hazard') return 'hazard';
  if (s.interaction === 'sequence' || EVENT_TYPES.has(s.entityType)) return 'event';
  return 'concept';
}

export function buildBoard(specs, { title = 'Resource Board' } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const concepts = [];
  const events = [];
  const hazards = [];
  for (const s of sorted) {
    if (SKIP_TYPES.has(s.entityType)) continue;
    const kind = spaceKind(s);
    if (kind === 'hazard') hazards.push(s);
    else if (kind === 'event') events.push(s);
    else concepts.push(s);
  }

  // Interleave so a lap mixes gains, events, and setbacks. Walk concepts and
  // drop an event or hazard in after every couple of squares.
  const rest = [];
  let ei = 0;
  let hi = 0;
  concepts.forEach((c, i) => {
    rest.push(toSpace(c, 'concept', i));
    if (i % 2 === 1 && ei < events.length) rest.push(toSpace(events[ei], 'event', ei++));
    if (i % 3 === 2 && hi < hazards.length) rest.push(toSpace(hazards[hi], 'hazard', hi++));
  });
  while (ei < events.length) rest.push(toSpace(events[ei], 'event', ei++));
  while (hi < hazards.length) rest.push(toSpace(hazards[hi], 'hazard', hi++));

  const start = {
    id: 'space-start',
    type: 'start',
    label: 'START',
    description: 'Pass or land here for a lap bonus: +20 coins and an energy refuel.',
    knowledge: 0,
    coins: 0,
    energy: 0,
  };

  return { title, spaces: [start, ...rest] };
}

function toSpace(spec, type, i) {
  if (type === 'concept') {
    return { id: spec.id, type, label: spec.label, description: spec.description || spec.evidence || '', knowledge: 20 + i * 5, coins: 5, energy: 0 };
  }
  if (type === 'event') {
    return { id: spec.id, type, label: spec.label, description: spec.description || spec.evidence || '', knowledge: 10, coins: 0, energy: 0 };
  }
  // hazard
  return { id: spec.id, type, label: spec.label, description: spec.description || spec.evidence || '', knowledge: 0, coins: 3, energy: 15 };
}

/** Even positions around the perimeter of the {x,y,w,h} rectangle. */
export function layoutRing(count, { x, y, w, h }) {
  const perim = 2 * (w + h);
  const pts = [];
  for (let i = 0; i < count; i++) {
    const d = (i / count) * perim;
    let px;
    let py;
    if (d < w) {
      px = x + d;
      py = y;
    } else if (d < w + h) {
      px = x + w;
      py = y + (d - w);
    } else if (d < w + h + w) {
      px = x + w - (d - w - h);
      py = y + h;
    } else {
      px = x;
      py = y + h - (d - w - h - w);
    }
    pts.push({ x: px, y: py });
  }
  return pts;
}
