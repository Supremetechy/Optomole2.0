/**
 * shared/Types.js — shared JSDoc type definitions for Optomole.
 *
 * Plain-JavaScript ES module (no TypeScript). These `@typedef`s document the
 * data contracts that flow through the pipeline:
 *
 *   Content → AI Compiler → Semantic Mapping Manifest → Browser Engine → Game
 *
 * They mirror the shapes the browser-engine's MappingEngine actually consumes,
 * so editors get autocomplete/checking via `@type` / `import('./Types.js')`
 * without any build step. Import the enums for runtime use; the typedefs are
 * erased at runtime (JSDoc only).
 */

/** Canonical game entity types a binding can map a source element to. */
export const GameEntityType = Object.freeze({
  NPC: 'npc',
  KEY_ITEM: 'key-item',
  QUEST_OBJECTIVE: 'quest-objective',
  HAZARD: 'hazard',
  LOCK: 'lock',
  EXIT_GATE: 'exit-gate',
  DOOR: 'door',
  POWER_UP: 'power-up',
});

/** Interaction verbs the runtime understands for an entity. */
export const InteractionType = Object.freeze({
  TALK: 'talk',
  COLLECT: 'collect',
  SEQUENCE: 'sequence',
  AVOID: 'avoid',
  UNLOCK: 'unlock',
  INSPECT: 'inspect',
});

/** Template (genre) ids shipped by the browser engine. */
export const TemplateId = Object.freeze({
  KEY_LOCK: 'action-adventure-key-lock',
  ARCADE: 'arcade-collect-avoid',
  IDLE: 'idle-progress',
  BOARD: 'board-resource-sim',
  MEMORY_PALACE: 'memory-palace',
  QUEST_RPG: 'quest-rpg-progression',
  FPS_GALLERY: 'fps-target-gallery',
  COURIER: 'open-world-courier',
  SANDBOX: 'sandbox-craft-build',
  RUNNER: 'runner-gauntlet',
});

/**
 * @typedef {Object} SourceElement
 * @property {string} type            Source-content kind (e.g. 'evidence', 'procedure-step', 'hazard', 'npc-dialogue').
 * @property {string} label           Human-readable name.
 * @property {string} [description]   Longer description / teaching text.
 * @property {string} [evidence]      The underlying fact this element encodes.
 * @property {string[]} [mediaRefs]   Optional media reference ids.
 * @property {string} [sourceRef]     Back-reference into the source document.
 */

/**
 * @typedef {Object} Reward
 * @property {string} [strategy]  Reward strategy (e.g. 'score', 'grant-key-item', 'unlock-next-room', 'power-up').
 * @property {number} [xp]        Experience/score granted.
 * @property {number} [currency]  Soft currency granted.
 */

/**
 * @typedef {Object} SpawnRules
 * @property {string} [placement]  Placement hint (e.g. 'template-default').
 * @property {number} [priority]   Higher = placed/spawned earlier.
 */

/**
 * @typedef {Object} GameBinding
 * @property {string} gameEntityType         One of {@link GameEntityType}.
 * @property {string} interactionType        One of {@link InteractionType}.
 * @property {string} [mechanic]             Mechanic key the template dispatches on.
 * @property {string|null} [templateSlot]    Named asset/logic slot in the template.
 * @property {Reward} [reward]               Reward on success.
 * @property {string[]} [successConditions]  Conditions that mark success.
 * @property {string[]} [failureConditions]  Conditions that mark failure.
 * @property {SpawnRules} [spawnRules]       Placement/priority hints.
 */

/**
 * @typedef {Object} EntitySpec
 * The normalized shape the MappingEngine produces from a binding — the unit the
 * genre entity-factories turn into live game objects.
 * @property {string} id
 * @property {string} entityType
 * @property {string} interaction
 * @property {string} mechanic
 * @property {string|null} slot
 * @property {string} label
 * @property {string} description
 * @property {string} evidence
 * @property {number} priority
 * @property {string} placement
 * @property {Reward} reward
 * @property {string[]} success
 * @property {string[]} failure
 * @property {string[]} media
 * @property {string|null} sourceRef
 */

export {};
