/**
 * ChallengeBook — the runtime half of the `challenges` component.
 *
 * The compiler produces an analyst challenge: a summary to verify, the evidence
 * that supports it, and distractors to reject. The gateway resolves those
 * snippets onto binding ids, so the runtime can present real content rather
 * than re-deriving text.
 *
 * One thing the compiler cannot be relied on for: DISTRACTORS. It builds them
 * from evidence flagged `correct: false`, and the deterministic compile path
 * marks every extracted snippet correct — so a real build arrives with five
 * correct options and zero wrong ones, which is not a challenge, it is a
 * "select all" button. When that happens we synthesize distractors from the
 * person's own content: real material that does NOT support this particular
 * summary. The instruction text changes to match, because those snippets are
 * genuine source content — they simply belong to a different part of it.
 *
 * Knowledge relations pick the distractors when available: content adjacent to
 * (but not part of) the answer set is a harder, fairer wrong answer than
 * something from an unrelated corner of the material.
 */

const arr = (v) => (Array.isArray(v) ? v : []);

/** Options shown at once. Enough to require reading, few enough to fit a panel. */
const MAX_OPTIONS = 6;

export function createChallengeBook(manifest = {}, specs = [], knowledge = null) {
  const items = arr(manifest.components?.challenges?.items);
  const byId = new Map(specs.map((spec) => [String(spec.id), spec]));

  const challenges = items.map((item, index) => build(item, index, byId, specs, knowledge)).filter(Boolean);

  return {
    challenges,
    /** Only playable with at least one correct answer AND one wrong one. */
    usable: challenges.some((challenge) => challenge.playable),
    first() {
      return challenges.find((challenge) => challenge.playable) || null;
    },
  };
}

function build(item, index, byId, specs, knowledge) {
  const resolve = (ids) => arr(ids).map((id) => byId.get(String(id))).filter(Boolean);

  // Dedupe: the gateway matches snippets to bindings by text, and two snippets
  // from the same sentence can land on one binding.
  const correct = unique(resolve(item.correctIds));
  const declaredWrong = unique(resolve(item.distractorIds)).filter((spec) => !correct.includes(spec));

  if (!correct.length) return null;

  const correctIds = new Set(correct.map((spec) => String(spec.id)));
  const synthesized = declaredWrong.length
    ? []
    : synthesizeDistractors(correct, correctIds, specs, knowledge, String(item.prompt || ''));
  const wrong = declaredWrong.length ? declaredWrong : synthesized;

  // Keep the panel readable: cap each side, always leaving room for both.
  const half = Math.floor(MAX_OPTIONS / 2);
  const shownCorrect = correct.slice(0, Math.max(2, MAX_OPTIONS - Math.min(wrong.length, half)));
  const shownWrong = wrong.slice(0, Math.max(0, MAX_OPTIONS - shownCorrect.length));

  const options = interleave(
    shownCorrect.map((spec) => ({ id: String(spec.id), label: spec.label, detail: spec.description || spec.evidence || '', correct: true })),
    shownWrong.map((spec) => ({ id: String(spec.id), label: spec.label, detail: spec.description || spec.evidence || '', correct: false })),
  );

  return {
    id: String(item.id || `challenge-${index + 1}`),
    type: String(item.type || 'analyst'),
    // When we minted the wrong answers ourselves, say what the real task is:
    // these distractors are source-backed, just not evidence for THIS summary.
    instructions: synthesized.length
      ? 'Select every snippet that supports the briefing below. Reject the ones that belong elsewhere in the source.'
      : String(item.instructions || 'Select every source-backed snippet and reject the distractors.'),
    prompt: String(item.prompt || ''),
    options,
    playable: options.some((o) => o.correct) && options.some((o) => !o.correct),
    synthesizedDistractors: synthesized.length > 0,
  };
}

/**
 * Wrong answers drawn from the person's own material. Preference order:
 * content related to the answer set (adjacent, so it demands real reading),
 * then anything else that isn't part of the answer.
 */
function synthesizeDistractors(correct, correctIds, specs, knowledge, prompt) {
  const picked = [];
  const taken = new Set(correctIds);
  const briefing = normalize(prompt);

  // NPCs and gates are furniture, not claims about the content.
  const answerable = (spec) => !['npc', 'lock', 'exit-gate', 'door', 'region-gate'].includes(spec.entityType);

  const push = (spec) => {
    const key = String(spec.id);
    if (taken.has(key) || !spec.label || !answerable(spec)) return;
    // A snippet that appears in the briefing DOES support it — offering it as a
    // wrong answer would mark a correct rejection as an error. Knowledge
    // neighbours are especially prone to this: content related to the evidence
    // is often drawn from the very same sentences.
    if (briefing && briefing.includes(normalize(spec.label))) return;
    taken.add(key);
    picked.push(spec);
  };

  if (knowledge?.usable) {
    for (const answer of correct) {
      for (const neighbour of knowledge.related(answer.id, 4)) {
        if (picked.length >= 3) break;
        push(neighbour);
      }
      if (picked.length >= 3) break;
    }
  }

  for (const spec of specs) {
    if (picked.length >= 3) break;
    push(spec);
  }
  return picked;
}

/** Lowercase, collapse whitespace, drop punctuation — for containment checks. */
function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Alternate the two lists so correct answers are not clustered at the top. */
function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (b[i]) out.push(b[i]);
    if (a[i]) out.push(a[i]);
  }
  return out;
}

function unique(list) {
  const seen = new Set();
  return list.filter((spec) => {
    const key = String(spec.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
