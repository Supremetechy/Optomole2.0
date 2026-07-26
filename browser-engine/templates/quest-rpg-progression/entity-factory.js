/**
 * entity-factory (quest-rpg-progression) — turns EntitySpecs into an RPG
 * campaign structure.
 *
 *   EntitySpec (from MappingEngine) -> classifyRpg() -> chapter graph
 *
 * Semantic mapping for this genre:
 *   procedure-step / quest-objective / key-item / evidence -> quest objective
 *     (walk over it to log the fact; each one advances the chapter's questline)
 *   hazard                                                 -> enemy encounter
 *     (engaging opens a recall check built from sibling content)
 *   npc                                                    -> quest-giver
 *     (hands out the chapter briefing; one per chapter, cycled if scarce)
 *   lock / exit-gate / decision                            -> region gate
 *     (opens once the chapter's required objectives are logged)
 *
 * buildCampaign() chunks objectives into chapters so every chapter has a giver,
 * a handful of facts to collect, at least one encounter, and a gate to leave by
 * — the classic "region cleared, next region unlocked" RPG rhythm.
 */
import { annotatePrerequisites } from '../../engines/MappingEngine.js';
import { Hero } from './prefabs/Hero.js';
import { QuestGiver } from './prefabs/QuestGiver.js';
import { QuestObjective } from './prefabs/QuestObjective.js';
import { Enemy } from './prefabs/Enemy.js';

const ENEMY_TYPES = new Set(['hazard', 'enemy']);
const GIVER_TYPES = new Set(['npc', 'quest-giver']);
const GATE_TYPES = new Set(['lock', 'exit-gate', 'door', 'region-gate']);

export function classifyRpg(spec) {
  if (ENEMY_TYPES.has(spec.entityType)) return 'enemy';
  if (GIVER_TYPES.has(spec.entityType)) return 'giver';
  if (GATE_TYPES.has(spec.entityType)) return 'gate';
  return 'objective';
}

export function createHero(ctx, pos) {
  return new Hero(ctx, pos);
}

export function createQuestGiver(ctx, spec, pos) {
  return new QuestGiver(ctx, spec, pos);
}

export function createObjective(ctx, spec, pos) {
  return new QuestObjective(ctx, spec, pos);
}

export function createEnemy(ctx, spec, pos) {
  return new Enemy(ctx, spec, pos);
}

/**
 * The three skill branches every campaign exposes. They are deliberately
 * content-neutral so any source material maps onto them: what you *know*, how
 * fast you *act*, and how much pressure you can *absorb*.
 */
export const SKILL_BRANCHES = [
  { id: 'insight', label: 'Insight', blurb: '+1 answer hint per encounter', icon: '◆' },
  { id: 'resolve', label: 'Resolve', blurb: '+15 max focus, less encounter damage', icon: '❖' },
  { id: 'momentum', label: 'Momentum', blurb: '+20% XP and faster travel', icon: '➤' },
];

/**
 * Build the chapter graph.
 *
 * Each chapter gets `chapterSize` objectives, one giver, a slice of enemies, and
 * a gate. Enemies are spread rather than clustered so no chapter is pure combat
 * or pure pickup.
 */
export function buildCampaign(specs, { chapterSize = 5, title = 'The Campaign', world = null, questBook = null, knowledge = null } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const objectives = sorted.filter((s) => classifyRpg(s) === 'objective');
  const enemies = sorted.filter((s) => classifyRpg(s) === 'enemy');
  const givers = sorted.filter((s) => classifyRpg(s) === 'giver');
  const gates = sorted.filter((s) => classifyRpg(s) === 'gate');

  // A real questline beats arbitrary chunking: one chapter per compiled quest,
  // carrying that quest's own title, summary and reward. When the content has no
  // quest structure (`usable === false`) we chunk objectives as before.
  const questChapters = questBook?.usable
    ? questBook.quests.map((quest) => ({
      objectives: quest.objectives.filter((spec) => classifyRpg(spec) === 'objective'),
      quest,
    })).filter((entry) => entry.objectives.length)
    : [];
  const useQuests = questChapters.length >= 2;

  // Content no quest claims still has to be playable — spread it across chapters.
  if (useQuests) {
    const unclaimed = (questBook.unclaimed || []).filter((spec) => classifyRpg(spec) === 'objective');
    unclaimed.forEach((spec, i) => questChapters[i % questChapters.length].objectives.push(spec));
  }

  const chapterCount = useQuests
    ? questChapters.length
    : Math.max(1, Math.ceil(objectives.length / chapterSize) || 1);
  const chapters = [];

  for (let i = 0; i < chapterCount; i++) {
    const quest = useQuests ? questChapters[i].quest : null;
    const chapterObjectives = useQuests
      ? questChapters[i].objectives
      : objectives.slice(i * chapterSize, (i + 1) * chapterSize);
    // One enemy per chapter by default; from chapter 3 on, two, so difficulty ramps.
    const enemyCount = enemies.length ? Math.min(enemies.length, i >= 2 ? 2 : 1) : 0;
    const chapterEnemies = [];
    for (let e = 0; e < enemyCount; e++) {
      chapterEnemies.push(enemies[(i * 2 + e) % enemies.length]);
    }

    const giver = givers.length ? givers[i % givers.length] : null;
    const gate = gates.length ? gates[i % gates.length] : null;

    chapters.push({
      id: quest ? quest.id : `chapter-${i + 1}`,
      index: i,
      // A compiled quest names its own chapter; otherwise fall back to the world
      // map's region name, then to the chapter's first objective.
      title: quest
        ? `Chapter ${i + 1}: ${short(quest.title)}`
        : world
          ? world.chunkTitle(i, 'Chapter', chapterObjectives[0]?.label)
          : chapterObjectives[0]?.label
            ? `Chapter ${i + 1}: ${short(chapterObjectives[0].label)}`
            : `Chapter ${i + 1}`,
      flavor: quest?.summary || (world ? world.chunkDescription(i) : ''),
      questId: quest?.id || null,
      objectives: chapterObjectives,
      enemies: chapterEnemies,
      giver,
      gate: gate || {
        id: `gate-${i + 1}`,
        entityType: 'region-gate',
        label: i === chapterCount - 1 ? 'Final Passage' : 'Region Gate',
        description: quest
          ? `Complete "${short(quest.title, 40)}" to open the way onward.`
          : 'Log every objective in this region to open the way onward.',
        reward: quest?.reward?.xp ? { xp: quest.reward.xp, currency: 8 } : { xp: 60, currency: 8 },
      },
      isFinal: i === chapterCount - 1,
      // Enemies get tougher as the campaign progresses.
      enemyHp: 2 + Math.floor(i / 2),
    });
  }

  // The compiled manifest's own skillTree (domain-specific names from the
  // person's content) takes precedence over the generic fallback branches.
  // Name the earlier content each chapter builds on, where the knowledge graph
  // established a prerequisite. Ordering already guarantees it came first.
  annotatePrerequisites(chapters, knowledge, (chapter) => chapter.objectives);

  const skillBranches = world?.skillTree?.length >= 3 ? world.skillTree.slice(0, 3) : SKILL_BRANCHES;
  return { title, chapters, skillBranches, questDriven: useQuests };
}

/**
 * Build a recall check for an encounter. The enemy's own description is the
 * "correct counter"; distractors are other content from the campaign, so every
 * wrong answer is still plausible, on-topic material.
 *
 * When the manifest carries a knowledge graph, distractors are drawn from the
 * content actually RELATED to this enemy rather than strided across the whole
 * pool. That is the difference between "which of these three unrelated topics"
 * (guessable by elimination) and a genuine discrimination between neighbouring
 * concepts. Unrelated content still tops up a thin pool.
 */
export function buildEncounterQuiz(enemySpec, pool, { choices = 3, knowledge = null } = {}) {
  const correct = {
    id: enemySpec.id,
    label: short(enemySpec.label, 60),
    correct: true,
    detail: enemySpec.description || enemySpec.evidence || '',
  };

  const asOption = (s) => ({ id: s.id, label: short(s.label, 60), correct: false, detail: s.description || '' });
  // Guides and gates are furniture, not answers — offering "Optomole Guide" as a
  // choice makes the question solvable by elimination without knowing anything.
  const answerable = (s) => s.label && !GIVER_TYPES.has(s.entityType) && !GATE_TYPES.has(s.entityType);
  const others = pool
    .filter((s) => s.id !== enemySpec.id && answerable(s))
    .slice(0, 40)
    .map(asOption);

  const picked = [correct];
  const taken = new Set([String(enemySpec.id)]);

  // Related content first — the plausible wrong answers.
  if (knowledge?.usable) {
    for (const spec of knowledge.related(enemySpec.id, choices * 2)) {
      if (picked.length >= choices) break;
      if (taken.has(String(spec.id)) || !answerable(spec)) continue;
      taken.add(String(spec.id));
      picked.push(asOption(spec));
    }
  }

  // Deterministic-ish spread through the pool so distractors vary per enemy.
  const stride = Math.max(1, Math.floor(others.length / Math.max(1, choices - 1)) || 1);
  for (let i = 0; picked.length < choices && i < others.length; i += stride) {
    if (taken.has(String(others[i].id))) continue;
    taken.add(String(others[i].id));
    picked.push(others[i]);
  }
  // Top up if the pool was thin.
  for (let i = 0; picked.length < choices && i < others.length; i++) {
    if (taken.has(String(others[i].id))) continue;
    taken.add(String(others[i].id));
    picked.push(others[i]);
  }

  return {
    prompt: `Which threat is "${short(enemySpec.label, 40)}" — and what stops it?`,
    question: enemySpec.description || enemySpec.evidence || `Identify: ${enemySpec.label}`,
    options: shuffleStable(picked, enemySpec.id),
  };
}

/**
 * Order-stable shuffle keyed by a seed string, so the correct answer is not
 * always first but a given encounter always reads the same on replay.
 */
function shuffleStable(list, seed = '') {
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Ring-shaped placement around a region center — reads as a explorable map. */
export function ringPlacement(count, center, radius, startAngle = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = startAngle + (i / Math.max(1, count)) * Math.PI * 2;
    out.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return out;
}

function short(text, max = 34) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}