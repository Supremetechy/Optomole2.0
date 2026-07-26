/**
 * KnowledgeIndex — the runtime half of the `knowledge` component.
 *
 * The compile pipeline extracts how the person's content relates to itself
 * (this concept co-occurs with that one; this step precedes that one; this fact
 * requires that one). The gateway projects those edges onto binding ids, and
 * this is where they become gameplay:
 *
 *   co_occurs_with -> quiz distractors that are genuinely related, so a wrong
 *                     answer is plausible instead of a random other topic
 *   precedes / requires -> prerequisite ordering, so foundational content is
 *                     met before the content that depends on it
 *
 * Relation direction, as the pipeline emits it:
 *   A precedes B  => A is a prerequisite of B
 *   A requires B  => B is a prerequisite of A
 *
 * Everything degrades. A manifest with no component, or relations that resolve
 * to nothing, yields `usable === false` and callers keep their existing
 * behaviour — pool-strided distractors and priority ordering.
 */

const arr = (v) => (Array.isArray(v) ? v : []);

/** How far a prerequisite chain may be walked before we call it a cycle. */
const MAX_DEPTH = 12;

export function createKnowledgeIndex(manifest = {}, specs = []) {
  const relations = arr(manifest.components?.knowledge?.relations);
  const byId = new Map(specs.map((spec) => [String(spec.id), spec]));

  // Undirected association, used for distractors: relatedness is symmetric even
  // when the underlying edge is not.
  const neighbours = new Map();
  // Directed prerequisite edges: prereqs.get(X) = specs that must come before X.
  const prereqs = new Map();

  const link = (map, key, value, weight) => {
    if (!map.has(key)) map.set(key, new Map());
    const bucket = map.get(key);
    bucket.set(value, Math.max(bucket.get(value) || 0, weight));
  };

  let resolved = 0;
  for (const relation of relations) {
    const from = String(relation.from || '');
    const to = String(relation.to || '');
    if (!byId.has(from) || !byId.has(to) || from === to) continue;
    resolved++;

    const weight = typeof relation.confidence === 'number' ? relation.confidence : 0.6;
    link(neighbours, from, to, weight);
    link(neighbours, to, from, weight);

    if (!relation.gating) continue;
    const type = String(relation.type || '').toLowerCase();
    if (/requires|depends/.test(type)) link(prereqs, from, to, weight);
    else link(prereqs, to, from, weight);
  }

  /** Longest prerequisite chain ending at this spec. Cycles stop at MAX_DEPTH. */
  const depthCache = new Map();
  const depthOf = (specId, seen = new Set()) => {
    const key = String(specId);
    if (depthCache.has(key)) return depthCache.get(key);
    if (seen.has(key) || seen.size > MAX_DEPTH) return 0;
    seen.add(key);
    let depth = 0;
    for (const parent of (prereqs.get(key) || new Map()).keys()) {
      depth = Math.max(depth, depthOf(parent, seen) + 1);
    }
    seen.delete(key);
    depthCache.set(key, depth);
    return depth;
  };

  const maxDepth = specs.reduce((max, spec) => Math.max(max, depthOf(spec.id)), 0);

  return {
    relations,
    stats: { declared: relations.length, resolved, gating: prereqs.size, maxDepth },
    /** Only drive behaviour from a graph that actually related some content. */
    usable: resolved > 0,

    /** Specs related to this one, most confident first. */
    related(specId, limit = 6) {
      const bucket = neighbours.get(String(specId));
      if (!bucket) return [];
      return [...bucket.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => byId.get(id))
        .filter(Boolean)
        .slice(0, limit);
    },

    /** Specs that should be met before this one. */
    prerequisites(specId) {
      const bucket = prereqs.get(String(specId));
      if (!bucket) return [];
      return [...bucket.keys()].map((id) => byId.get(id)).filter(Boolean);
    },

    depthOf(specId) {
      return depthOf(specId);
    },

    /**
     * Fold prerequisite depth into `priority` so every genre's layout honours it
     * without changing a single builder: they all sort by descending priority,
     * so a foundational spec sorting higher lands in an earlier room, wave,
     * chapter or round. Specs outside the prerequisite graph are left alone, so
     * this only reorders content the pipeline actually made claims about.
     */
    applyOrdering(list) {
      if (!prereqs.size || !maxDepth) return list;
      const involved = new Set(prereqs.keys());
      for (const bucket of prereqs.values()) for (const id of bucket.keys()) involved.add(id);
      const step = 4;
      for (const spec of list) {
        if (!involved.has(String(spec.id))) continue;
        spec.knowledgeDepth = depthOf(spec.id);
        spec.priority += (maxDepth - spec.knowledgeDepth) * step;
      }
      return list;
    },
  };
}
