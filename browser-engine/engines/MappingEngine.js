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
    sourceRef: src.sourceRef || binding.sourceRef || null,
  };
}

/**
 * Group entity specs into rooms. Key-lock adventures play best as short rooms;
 * we chunk objectives/keys/hazards so every room has something to do and a gate
 * to leave through.
 */
export function buildRoomGraph(specs, { roomSize = 6, title = 'Training Facility' } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);

  const doors = sorted.filter((s) => s.entityType === 'lock' || s.entityType === 'exit-gate');
  const npcs = sorted.filter((s) => s.entityType === 'npc');
  const playable = sorted.filter(
    (s) => !['lock', 'exit-gate', 'npc'].includes(s.entityType),
  );

  const rooms = [];
  const chunkCount = Math.max(1, Math.ceil(playable.length / roomSize) || 1);
  for (let i = 0; i < chunkCount; i++) {
    const chunk = playable.slice(i * roomSize, (i + 1) * roomSize);
    // Ensure every room has at least one collectible key to open its gate.
    const keys = chunk.filter((s) => s.entityType === 'key-item');
    const requiredKeys = keys.map((k) => k.id);
    rooms.push({
      id: `room-${i + 1}`,
      index: i,
      title: chunk[0]?.label ? `Room ${i + 1}: ${short(chunk[0].label)}` : `Room ${i + 1}`,
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
  return { title, rooms };
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
  }

  /** Resolve an asset slot's fallback/url for a given slot id. */
  resolveSlot(slotId) {
    return this.assetSlots.find((s) => s.id === slotId) || null;
  }

  toRoomGraph(options = {}) {
    return buildRoomGraph(this.specs, {
      title: this.manifest.title || options.title || 'Training Facility',
      roomSize: options.roomSize || 6,
    });
  }
}