/**
 * QuestBook — the runtime half of the `quests` component.
 *
 * The mapping manifest flattens a compiled questline into loose bindings, so the
 * runtime used to see an undifferentiated pile of objectives and had to invent
 * its own chunking ("Chapter 3" = the next 5 items). The gateway now projects a
 * `quests` component whose entries reference their objective/evidence bindings
 * by id, so the questline the compiler designed survives to the playable.
 *
 *   components.quests.quests[] --(objectiveIds)--> EntitySpec[] --> chapters/rooms
 *
 * Everything degrades: a manifest with no component, or quests that reference no
 * bindings, yields `usable === false` and callers keep their existing chunking.
 */

const arr = (v) => (Array.isArray(v) ? v : []);

export function createQuestBook(manifest = {}, specs = []) {
  const component = manifest.components?.quests || null;
  const byId = new Map(specs.map((spec) => [String(spec.id), spec]));

  const quests = arr(component?.quests)
    .map((quest, order) => {
      const objectives = arr(quest.objectiveIds).map((id) => byId.get(String(id))).filter(Boolean);
      const evidence = arr(quest.evidenceIds).map((id) => byId.get(String(id))).filter(Boolean);
      return {
        id: String(quest.id || `quest-${order + 1}`),
        order: Number.isFinite(quest.order) ? quest.order : order,
        title: String(quest.title || `Quest ${order + 1}`),
        summary: String(quest.summary || ''),
        objectives,
        evidence,
        // Every spec this quest owns, in one list — what a chapter/room is built from.
        specs: [...objectives, ...evidence],
        reward: quest.reward || {},
        completion: quest.completion || null,
      };
    })
    .filter((quest) => quest.specs.length)
    .sort((a, b) => a.order - b.order);

  const claimed = new Set(quests.flatMap((quest) => quest.specs.map((spec) => String(spec.id))));

  return {
    quests,
    /** Specs no quest claims — graph-derived content the compiler never bound to a quest. */
    unclaimed: specs.filter((spec) => !claimed.has(String(spec.id))),
    /**
     * Only worth driving layout from a questline that actually structures the
     * content. A single quest is the compiler's "one blob of pasted text" shape,
     * which chunking handles better than a one-chapter campaign would.
     */
    usable: quests.length >= 2,
    questFor(specId) {
      return quests.find((quest) => quest.specs.some((spec) => String(spec.id) === String(specId))) || null;
    },
  };
}
