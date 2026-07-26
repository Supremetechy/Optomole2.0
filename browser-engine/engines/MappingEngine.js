/**
 * MappingEngine — the bridge from a Semantic Mapping Manifest to spawnable
 * game objects. This is the runtime half of Optomole's "this work item becomes
 * a hazard/key/NPC" promise.
 *
 *   mapping binding -> entity spec -> (entity factory) -> sprite + body + behavior
 *
 * It consumes the manifest shape produced by the pipeline:
 *   {
 *     templateId, experienceId, requiredRuntimeSystems, assetSlots,
 *     bindings: [{ id, sourceElement:{type,label,description,evidence,...},
 *                  gameBinding:{ gameEntityType, interactionType, mechanic,
 *                                templateSlot, reward:{xp,currency},
 *                                successConditions, failureConditions,
 *                                spawnRules:{placement,priority} } }]
 *   }
 *
 * Output: normalized EntitySpec objects the entity-factory understands, grouped
 * into rooms so the template can lay out a room graph.
 */

import { createChallengeBook } from './ChallengeBook.js';
import { createKnowledgeIndex } from './KnowledgeIndex.js';
import { createQuestBook } from './QuestBook.js';
import { createWorldContext } from './WorldContext.js';

let _seq = 0;
const uid = (p = 'ent') => `${p}-${Date.now().toString(36)}-${(_seq++).toString(36)}`;

/** Normalize one manifest binding into an EntitySpec. */
export function bindingToEntitySpec(binding = {}) {
  const src = binding.sourceElement || {};
  const gb = binding.gameBinding || {};
  const reward = gb.reward || {};
  return {
    id: binding.id || uid('spec'),
    entityType: gb.gameEntityType || 'quest-objective',
    interaction: gb.interactionType || 'inspect',
    mechanic: gb.mechanic || gb.gameEntityType || 'objective',
    slot: gb.templateSlot || null,
    label: src.label || src.title || 'Objective',
    description: src.description || src.evidence || src.text || '',
    evidence: src.evidence || src.description || '',
    priority: gb.spawnRules?.priority ?? 50,
    placement: gb.spawnRules?.placement || 'template-default',
    reward: { xp: reward.xp || 0, currency: reward.currency || 0, strategy: reward.strategy || null },
    feedback: gb.feedback || null,
    success: gb.successConditions || [],
    failure: gb.failureConditions || [],
    media: Array.isArray(src.mediaRefs) ? src.mediaRefs : [],
    dialogue: Array.isArray(gb.dialogue) ? gb.dialogue : [],
    sourceRef: src.sourceRef || binding.sourceRef || null,
  };
}

/**
 * Group entity specs into rooms. Key-lock adventures play best as short rooms;
 * we chunk objectives/keys/hazards so every room has something to do and a gate
 * to leave through.
 */
export function buildRoomGraph(specs, { roomSize = 6, title = 'Training Facility', world = null, questBook = null, knowledge = null } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);

  const gates = sorted.filter((s) => s.entityType === 'lock' || s.entityType === 'exit-gate');
  const npcs = sorted.filter((s) => s.entityType === 'npc');
  const playable = sorted.filter(
    (s) => !['lock', 'exit-gate', 'npc'].includes(s.entityType),
  );

  // A room consumes at most one gate. Surplus gates used to be dropped on the
  // floor — with a decision-heavy source that silently discarded most of the
  // content (11 locks, 1 room, 10 elements never rendered). Demote the extras to
  // in-room objectives instead, then size the room count to hold everything.
  let roomCount = Math.max(1, Math.ceil(playable.length / roomSize) || 1);
  for (let pass = 0; pass < 4; pass++) {
    const contentCount = playable.length + Math.max(0, gates.length - Math.min(gates.length, roomCount));
    const next = Math.max(1, Math.ceil(contentCount / roomSize) || 1);
    if (next === roomCount) break;
    roomCount = next;
  }

  const doors = gates.slice(0, roomCount);
  const demoted = gates.slice(roomCount).map((spec) => ({
    ...spec,
    entityType: 'quest-objective',
    interaction: spec.interaction === 'branch' ? 'inspect' : spec.interaction,
    demotedFrom: spec.entityType,
  }));
  const contents = [...playable, ...demoted].sort((a, b) => b.priority - a.priority);

  // A compiled questline defines the rooms when it has real structure; the
  // fixed-size chunking below is the fallback for unstructured content.
  const questRooms = questBook?.usable
    ? questBook.quests
      .map((quest) => ({ quest, entities: quest.specs.filter((spec) => contents.includes(spec)) }))
      .filter((entry) => entry.entities.length)
    : [];
  const useQuests = questRooms.length >= 2;
  if (useQuests) {
    const claimed = new Set(questRooms.flatMap((entry) => entry.entities));
    contents.filter((spec) => !claimed.has(spec))
      .forEach((spec, i) => questRooms[i % questRooms.length].entities.push(spec));
  }

  const rooms = [];
  const chunkCount = useQuests ? questRooms.length : Math.max(1, Math.ceil(contents.length / roomSize) || 1);
  for (let i = 0; i < chunkCount; i++) {
    const quest = useQuests ? questRooms[i].quest : null;
    const chunk = useQuests ? questRooms[i].entities : contents.slice(i * roomSize, (i + 1) * roomSize);
    // Ensure every room has at least one collectible key to open its gate.
    const keys = chunk.filter((s) => s.entityType === 'key-item');
    const requiredKeys = keys.map((k) => k.id);
    rooms.push({
      id: quest ? quest.id : `room-${i + 1}`,
      index: i,
      // Room identity, most specific first: the compiled quest that owns this
      // content, then the world map's region name, then the first entity label.
      title: quest
        ? `Room ${i + 1}: ${short(quest.title)}`
        : world
          ? world.chunkTitle(i, 'Room', chunk[0]?.label)
          : chunk[0]?.label ? `Room ${i + 1}: ${short(chunk[0].label)}` : `Room ${i + 1}`,
      flavor: quest?.summary || (world ? world.chunkDescription(i) : ''),
      questId: quest?.id || null,
      entities: chunk,
      npc: npcs[i] || npcs[0] || null,
      door: doors[i] || {
        id: `gate-${i + 1}`,
        entityType: 'exit-gate',
        interaction: 'unlock',
        label: 'Exit Gate',
        description: keys.length
          ? 'Collect the required key items, then unlock to proceed.'
          : 'Clear the room objectives to unlock.',
        requiredKeys,
        reward: { xp: 40, currency: 5 },
        isFinal: i === chunkCount - 1,
      },
      requiredKeys,
    });
  }
  if (doors.length) {
    // Carry real door metadata (required keys derived from room keys) onto rooms.
    rooms.forEach((room, i) => {
      if (doors[i]) {
        room.door = { ...doors[i], requiredKeys: room.requiredKeys, isFinal: i === rooms.length - 1 };
      }
    });
  }
  annotatePrerequisites(rooms, knowledge);
  return { title, rooms };
}

/**
 * Tell the player what a chunk builds on.
 *
 * Prerequisite ordering already put foundational content in earlier chunks
 * (KnowledgeIndex.applyOrdering raises its priority), so by the time a chunk is
 * reached its prerequisites have been met. Naming them turns that invisible
 * ordering into something the player can see: "Builds on: containment".
 *
 * Deliberately NOT folded into `requiredKeys` — those resolve through
 * `state.hasKey`, so a prerequisite that isn't a collectible key-item would lock
 * the door forever. Ordering is the enforcement; this is the explanation.
 */
export function annotatePrerequisites(chunks, knowledge, entitiesOf = (chunk) => chunk.entities) {
  if (!knowledge?.usable) return chunks;
  const chunkOf = new Map();
  chunks.forEach((chunk, index) => {
    for (const spec of entitiesOf(chunk) || []) chunkOf.set(String(spec.id), index);
  });

  chunks.forEach((chunk, index) => {
    const names = new Set();
    for (const spec of entitiesOf(chunk) || []) {
      for (const prereq of knowledge.prerequisites(spec.id)) {
        // Only cite prerequisites the player has actually already passed.
        const at = chunkOf.get(String(prereq.id));
        if (at === undefined || at >= index) continue;
        if (prereq.label) names.add(short(prereq.label, 28));
      }
    }
    chunk.buildsOn = [...names].slice(0, 3);
    if (chunk.buildsOn.length && chunk.door) {
      chunk.door = { ...chunk.door, buildsOn: chunk.buildsOn };
    }
  });
  return chunks;
}

function short(text, max = 34) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export class MappingEngine {
  constructor(manifest = {}) {
    this.manifest = manifest;
    this.templateId = manifest.templateId || 'action-adventure-key-lock.v1';
    this.assetSlots = manifest.assetSlots || [];
    this.requiredSystems = manifest.requiredRuntimeSystems || [];
    this.specs = (manifest.bindings || []).map(bindingToEntitySpec);
    // World-building layers (proceduralMap / storyboard / world / skillTree)
    // projected once so every genre names its chunks from the person's content.
    this.world = createWorldContext(manifest);
    // The compiled questline, rejoined to its bindings. `usable` is false when
    // the content has no real quest structure, and callers keep chunking.
    this.questBook = createQuestBook(manifest, this.specs);
    // How the content relates to itself: drives related quiz distractors and
    // prerequisite ordering. applyOrdering folds prerequisite depth into
    // priority, so every genre's layout honours it without builder changes.
    this.knowledge = createKnowledgeIndex(manifest, this.specs);
    this.knowledge.applyOrdering(this.specs);
    // The analyst challenge, resolved to real specs. Distractors are synthesized
    // from the person's content when the compiler supplied none.
    this.challenges = createChallengeBook(manifest, this.specs, this.knowledge);
  }

  /** Resolve an asset slot's fallback/url for a given slot id. */
  resolveSlot(slotId) {
    return this.assetSlots.find((s) => s.id === slotId) || null;
  }

  toRoomGraph(options = {}) {
    return buildRoomGraph(this.specs, {
      title: this.world.title || this.manifest.title || options.title || 'Training Facility',
      roomSize: options.roomSize || 6,
      world: this.world,
      questBook: this.questBook,
      knowledge: this.knowledge,
    });
  }
}