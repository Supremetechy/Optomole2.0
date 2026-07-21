/**
 * Runtime archetype catalog — the bridge between the compiler's 6 experience
 * archetypes and the browser-engine's playable template registry.
 *
 * The compiler classifies each source into one of six archetypes. Each archetype
 * maps to a concrete playable template id (see templates/registry.json), which is
 * what boot.js selectTemplate() actually loads. This is how the six archetypes
 * create a *variety* of real games instead of every experience playing the same
 * mission-rpg runtime.
 *
 *   source -> archetype (AI or heuristic) -> playableTemplateId -> runtime engine
 */

export type ArchetypeId =
  | 'mission-rpg'
  | 'escape-room'
  | 'adventure'
  | 'business-sim'
  | 'detective'
  | 'AI-generated';

export interface RuntimeArchetype {
  id: ArchetypeId;
  title: string;
  loop: string[];
  mechanics: string[];
  completionVerb: string;
  evidenceLabel: string;
  sceneLabel: string;
  /**
   * The browser-engine template this archetype plays on. Must match an id in
   * templates/registry.json (minus/with the version suffix). `null` means "let
   * the registry scorer recommend the best-fit template" (used by AI-generated).
   */
  playableTemplateId: string | null;
}

const EVIDENCE_LOOP = ['briefing', 'map', 'evidence', 'profile', 'completion'];
const EVIDENCE_MECHANICS = ['evidence-gates', 'xp', 'domain-progression', 'skill-unlocks', 'worker-artifacts'];

/**
 * The six archetypes, keyed by id. Order here is the classification priority for
 * the heuristic fallback (first match wins on ties).
 */
export const RUNTIME_ARCHETYPES: Record<ArchetypeId, RuntimeArchetype> = {
  'mission-rpg': {
    id: 'mission-rpg',
    title: 'Mission RPG',
    loop: EVIDENCE_LOOP,
    mechanics: EVIDENCE_MECHANICS,
    completionVerb: 'Complete Mission',
    evidenceLabel: 'Evidence',
    sceneLabel: 'Mission',
    playableTemplateId: 'quest-rpg-progression.v1',
  },
  'escape-room': {
    id: 'escape-room',
    title: 'Escape Room',
    loop: ['room', 'clue', 'lock', 'solution', 'unlock'],
    mechanics: ['clues', 'locks', 'timers', 'ordered-procedures'],
    completionVerb: 'Unlock Room',
    evidenceLabel: 'Clue Lock',
    sceneLabel: 'Puzzle Room',
    playableTemplateId: 'action-adventure-key-lock.v1',
  },
  adventure: {
    id: 'adventure',
    title: 'Adventure',
    loop: ['briefing', 'map', 'delivery', 'profile', 'completion'],
    mechanics: ['free-roam', 'objectives', 'xp', 'domain-progression', 'worker-artifacts'],
    completionVerb: 'Complete Adventure',
    evidenceLabel: 'Waypoint',
    sceneLabel: 'Adventure',
    playableTemplateId: 'open-world-courier.v1',
  },
  'business-sim': {
    id: 'business-sim',
    title: 'Business Simulation',
    loop: ['scenario', 'resource-choice', 'tradeoff', 'outcome', 'upgrade'],
    mechanics: ['resources', 'economy', 'upgrade-tree', 'scenario-events'],
    completionVerb: 'Run Decision',
    evidenceLabel: 'Decision Inputs',
    sceneLabel: 'Simulation Floor',
    playableTemplateId: 'board-resource-sim.v1',
  },
  detective: {
    id: 'detective',
    title: 'Detective',
    loop: ['briefing', 'recall', 'evidence', 'deduction', 'completion'],
    mechanics: ['evidence-gates', 'memory-recall', 'xp', 'domain-progression', 'worker-artifacts'],
    completionVerb: 'Close Case',
    evidenceLabel: 'Clue',
    sceneLabel: 'Case',
    playableTemplateId: 'memory-palace.v1',
  },
  'AI-generated': {
    id: 'AI-generated',
    title: 'AI-generated',
    loop: EVIDENCE_LOOP,
    mechanics: EVIDENCE_MECHANICS,
    completionVerb: 'Complete Mission',
    evidenceLabel: 'Evidence',
    sceneLabel: 'Mission',
    playableTemplateId: null,
  },
};

export const ARCHETYPE_IDS = Object.keys(RUNTIME_ARCHETYPES) as ArchetypeId[];

/** Full catalog as an array (for embedding in the runtimeContract). */
export function archetypeCatalog(): RuntimeArchetype[] {
  return ARCHETYPE_IDS.map((id) => RUNTIME_ARCHETYPES[id]);
}

/** Normalize a free-form archetype hint to a known id, or null if unrecognized. */
export function normalizeArchetypeId(value: unknown): ArchetypeId | null {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase().replace(/[\s_]+/g, '-');
  const direct = ARCHETYPE_IDS.find((id) => id.toLowerCase() === raw);
  if (direct) return direct;
  // Common aliases the AI or callers might emit.
  const aliases: Record<string, ArchetypeId> = {
    mission: 'mission-rpg',
    'mission-rpg': 'mission-rpg',
    rpg: 'mission-rpg',
    quest: 'mission-rpg',
    escape: 'escape-room',
    'escape-room': 'escape-room',
    puzzle: 'escape-room',
    'visual-novel': 'adventure',
    visualnovel: 'adventure',
    story: 'adventure',
    adventure: 'adventure',
    courier: 'adventure',
    business: 'business-sim',
    'business-sim': 'business-sim',
    sim: 'business-sim',
    simulation: 'business-sim',
    strategy: 'business-sim',
    detective: 'detective',
    mystery: 'detective',
    investigation: 'detective',
    ai: 'AI-generated',
    'ai-generated': 'AI-generated',
    generated: 'AI-generated',
  };
  return aliases[raw] || null;
}

/**
 * Turn a genre/template hint into a human display label.
 * `quest-rpg-progression.v1` -> `Quest RPG Progression`.
 * Used so the displayed genre matches the user's selection instead of the
 * content-inferred runtime archetype.
 */
export function humanizeGenre(hint: string): string {
  const acronyms = new Set(['rpg', 'fps', 'ai', 'npc', 'hud', 'ui']);
  return String(hint || '')
    .replace(/\.v\d+$/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (acronyms.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * The genre object to display for an experience. An explicit user selection
 * (a template id, family, or archetype) wins; otherwise fall back to the
 * content-inferred runtime archetype's identity.
 */
export function displayGenre(preference: string | undefined, archetype: RuntimeArchetype): { id: string; title: string } {
  const pref = String(preference || '').trim();
  if (pref) return { id: pref.replace(/\.v\d+$/i, ''), title: humanizeGenre(pref) };
  return { id: archetype.id, title: archetype.title };
}

/**
 * Heuristic archetype choice from domain + genre + free text. Used when the AI
 * compiler did not supply an explicit archetype (or on the non-AI code path).
 */
export function heuristicArchetype(input: { domain?: string; genre?: string; text?: string }): ArchetypeId {
  const domain = String(input.domain || '').toLowerCase();
  const genre = String(input.genre || '').toLowerCase();
  const text = String(input.text || '').toLowerCase();
  const hay = `${genre} ${text}`;

  const has = (...terms: string[]) => terms.some((term) => hay.includes(term));

  // Explicit genre signals win first.
  const fromGenre = normalizeArchetypeId(genre);
  if (fromGenre) return fromGenre;

  if (has('escape', 'puzzle', 'lock', 'sequence', 'procedure', 'runbook', 'checklist')) return 'escape-room';
  if (has('detective', 'mystery', 'investigat', 'forensic', 'incident', 'breach', 'threat', 'clue')) return 'detective';
  if (has('business', 'market', 'budget', 'revenue', 'tradeoff', 'roadmap', 'resource', 'economy', 'pricing')) {
    return 'business-sim';
  }
  if (has('journey', 'story', 'narrative', 'tour', 'explore', 'delivery', 'courier', 'field')) return 'adventure';

  // Domain-based fallback.
  if (domain === 'strategy') return 'business-sim';
  if (domain === 'defense') return 'detective';
  if (domain === 'science' || domain === 'research') return 'mission-rpg';

  return 'mission-rpg';
}

/**
 * Build the runtimeContract block for a chosen archetype: the active `template`
 * (the selected archetype), the full `catalog` (all six, so every archetype is
 * present and traceable), and the `playableTemplateId` that drives the engine.
 */
export function buildRuntimeContract(input: {
  archetypeId: ArchetypeId;
  xpModel?: string;
  xpMultiplier?: number;
  xpThreshold?: number;
  map?: unknown;
}): Record<string, unknown> {
  const active = RUNTIME_ARCHETYPES[input.archetypeId] || RUNTIME_ARCHETYPES['mission-rpg'];
  return {
    template: active,
    activeArchetype: active.id,
    playableTemplateId: active.playableTemplateId,
    catalog: archetypeCatalog(),
    xpModel: input.xpModel || 'quest-completion',
    xpMultiplier: input.xpMultiplier ?? 1,
    xpThreshold: input.xpThreshold ?? 0,
    map: input.map ?? null,
  };
}
