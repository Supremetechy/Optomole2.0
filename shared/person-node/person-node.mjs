/**
 * shared/person-node/person-node.js — the canonical, framework-free PersonNode
 * contract shared across Optomole services.
 *
 * ONE source of truth for "a Person Node" and how it crosses the boundary between
 * the AdminConsole training pipeline (which BUILDS a Person Node from a user's
 * content) and the Optomole api pipeline (which CONSUMES it to compile an
 * ExperienceManifest). Both sides import THIS module:
 *
 *   AdminConsole  →  import { knowledgeGraphToPersonNode } from '.../person-node.js'  (ESM)
 *   Optomole api  →  await import('.../person-node.js') via PersonNodeAdapterService (CJS→ESM)
 *
 * The JSON Schema (`person-node.schema.json` in this folder) is the structural
 * contract; the functions here are the pure adapters that map a Person Node to
 * the api's IRX ingest request and back. Plain ESM JavaScript with JSDoc types —
 * no build step, matching the repo's existing `shared/` convention.
 */

export const PERSON_NODE_SCHEMA_VERSION = '1.0.0';

/**
 * @typedef {Object} PersonNodeIrxItem
 * @property {string} id
 * @property {string} sourceType
 * @property {string} title
 * @property {string} text
 * @property {string} origin
 * @property {Record<string, unknown>} metadata
 */

/**
 * @typedef {Object} PersonNodeIrxRequest
 * @property {{ sourceType: string, title: string, text: string, metadata: Record<string, unknown> }} source
 * @property {PersonNodeIrxItem[]} items
 * @property {string} goals - newline-joined; the api's IRX layer splits on newline/comma
 * @property {string} achievements - newline-joined
 * @property {Record<string, unknown>} options
 */

/** Best-effort display name from a Person Node's identity block. */
export function personNodeDisplayName(personNode = {}) {
  const identity = personNode.identity || {};
  const name = identity.name || {};
  const parts = [name.firstName, name.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (typeof name.displayName === 'string' && name.displayName) return name.displayName;
  if (typeof identity.preferredName === 'string' && identity.preferredName) return identity.preferredName;
  return personNode.displayName || personNode.id || 'Optomole Learner';
}

/** Pull the goal statements Optomole should optimize the experience toward. */
export function personNodeGoals(personNode = {}) {
  const profile = personNode.optomoleProfile || {};
  const goals = Array.isArray(profile.goals) ? profile.goals : [];
  return goals.map((goal) => (typeof goal === 'string' ? goal : goal?.statement || goal?.label)).filter(Boolean);
}

/** Success metrics / desired outcomes, used as the experience's "achievements". */
export function personNodeAchievements(personNode = {}) {
  const profile = personNode.optomoleProfile || {};
  const raw = profile.successMetrics || profile.desiredOutcomes || profile.achievements || [];
  const list = Array.isArray(raw) ? raw : [];
  return list.map((entry) => (typeof entry === 'string' ? entry : entry?.statement || entry?.label)).filter(Boolean);
}

/**
 * Turn a Person Node into content items the api's semantic pipeline can chew on.
 * We surface the substance an experience should be built from — the evidence
 * graph's claims, capabilities, values, and pain points — as short text units,
 * never dumping raw PII. Each item keeps a provenance pointer back to the node.
 */
export function personNodeToContentItems(personNode = {}) {
  const items = [];
  const push = (sourceType, title, text) => {
    const body = String(text || '').trim();
    if (body) items.push({ id: `pn-${sourceType}-${items.length + 1}`, sourceType, title, text: body, origin: 'person-node', metadata: { personNodeId: personNode.id } });
  };

  const profile = personNode.optomoleProfile || {};
  const goals = personNodeGoals(personNode);
  if (goals.length) push('goal', 'Learner goals', goals.map((g) => `- ${g}`).join('\n'));
  if (Array.isArray(profile.painPoints) && profile.painPoints.length) {
    push('painpoint', 'Pain points to address', profile.painPoints.map((p) => `- ${typeof p === 'string' ? p : p?.statement || ''}`).filter(Boolean).join('\n'));
  }

  // Capabilities → the concepts/skills the experience should exercise.
  const capabilities = Array.isArray(personNode.capabilities) ? personNode.capabilities : profile.capabilities || [];
  if (Array.isArray(capabilities) && capabilities.length) {
    push('capability', 'Current capabilities', capabilities.map((c) => `- ${c.label || c.capability || c.id || ''}${c.level ? ` (level: ${c.level})` : ''}`).filter((l) => l.trim() !== '-').join('\n'));
  }

  // Values → framing/tone anchors.
  const values = Array.isArray(personNode.values) ? personNode.values : personNode.values?.items || [];
  if (Array.isArray(values) && values.length) {
    push('value', 'Values and motivations', values.map((v) => `- ${v.label || v.value || v.statement || ''}`).filter((l) => l.trim() !== '-').join('\n'));
  }

  // Evidence-graph claims → the factual substance, already sanitized upstream.
  const claims = personNode.evidenceGraph?.claims || [];
  if (Array.isArray(claims) && claims.length) {
    const claimLines = claims
      .map((claim) => claim.statement || claim.text || claim.label)
      .filter(Boolean)
      .slice(0, 40)
      .map((statement) => `- ${statement}`);
    if (claimLines.length) push('claim', 'Established claims about the learner', claimLines.join('\n'));
  }

  // Fallback so the pipeline always has at least one item to work from.
  if (!items.length) {
    push('profile', 'Learner profile', `Experience for ${personNodeDisplayName(personNode)}.`);
  }
  return items;
}

/**
 * Map a Person Node to the api's NormalizeIrxRequest shape. The api then runs its
 * existing IRX → preprocessing → compiler chain unchanged to emit an
 * ExperienceManifest, now grounded in this specific person.
 * @returns {PersonNodeIrxRequest}
 */
export function personNodeToIrxRequest(personNode = {}, options = {}) {
  const title = options.title || personNodeDisplayName(personNode) + ' — Personalized Experience';
  const items = personNodeToContentItems(personNode);
  const goalList = personNodeGoals(personNode);
  const achievementList = personNodeAchievements(personNode);
  const profile = personNode.optomoleProfile || {};

  return {
    source: {
      sourceType: 'person-node',
      title,
      text: '',
      metadata: {
        personNodeId: personNode.id || null,
        personNodeSchemaVersion: personNode.system?.schemaVersion || PERSON_NODE_SCHEMA_VERSION,
        displayName: personNodeDisplayName(personNode),
      },
    },
    items,
    // Newline-joined so the api's IRX layer (which expects a string it splits on
    // newline/comma) consumes them directly.
    goals: goalList.join('\n'),
    achievements: achievementList.join('\n'),
    options: {
      title,
      target: options.target || 'browser',
      genre: options.genre || profile.preferredGenre,
      audience: options.audience || profile.audience || 'personalized learner',
      worldTitle: options.worldTitle,
      personNodeId: personNode.id || null,
      ...(options.extraOptions || {}),
    },
  };
}

/**
 * Build a canonical Person Node from the AdminConsole pipeline's outputs so the
 * console can persist/hand off a schema-shaped node instead of a raw graph. This
 * is the inverse direction: knowledge graph + extraction → Person Node.
 */
export function knowledgeGraphToPersonNode({ knowledgeGraph = {}, semanticExtraction = {}, identity = {}, optomoleProfile = {}, id, asOf } = {}) {
  const nodes = knowledgeGraph.nodes || [];
  const objectives = semanticExtraction.learningObjectives || [];
  const concepts = semanticExtraction.concepts || [];

  const claims = nodes
    .filter((node) => node.label)
    .slice(0, 200)
    .map((node, index) => ({
      id: `claim-${index + 1}`,
      statement: node.label,
      claimType: node.type || node.layer || 'concept',
      confidence: { tier: 'medium', score: 0.6 },
      sourceIds: node.id ? [node.id] : [],
    }));

  return {
    id: id || knowledgeGraph.id || `person-${Date.now().toString(36)}`,
    system: {
      schemaVersion: PERSON_NODE_SCHEMA_VERSION,
      asOf: asOf || knowledgeGraph.generatedAt || new Date().toISOString(),
      generatedBy: 'admin-console-pipeline',
    },
    identity: {
      name: identity.name || { displayName: identity.displayName || 'Learner' },
      ...identity,
    },
    optomoleProfile: {
      goals: optomoleProfile.goals || objectives.map((objective) => objective.goalStatement).filter(Boolean),
      painPoints: optomoleProfile.painPoints || [],
      preferences: optomoleProfile.preferences || {},
      ...optomoleProfile,
    },
    evidenceGraph: {
      claims,
      evidence: [],
      conflicts: [],
      resolvedFields: [],
    },
    provenance: {
      knowledgeGraphId: knowledgeGraph.id || null,
      semanticExtractionId: semanticExtraction.id || null,
      conceptCount: concepts.length,
      nodeCount: nodes.length,
    },
  };
}

/** Lightweight structural validation (not a full JSON-Schema validation). */
export function validatePersonNode(personNode) {
  const errors = [];
  if (!personNode || typeof personNode !== 'object') {
    return { valid: false, errors: ['Person Node must be an object.'] };
  }
  for (const key of ['id', 'identity', 'system']) {
    if (!(key in personNode)) errors.push(`Missing required top-level field: "${key}".`);
  }
  if (personNode.evidenceGraph && !Array.isArray(personNode.evidenceGraph.claims || [])) {
    errors.push('evidenceGraph.claims must be an array when present.');
  }
  return { valid: errors.length === 0, errors };
}
