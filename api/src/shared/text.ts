/**
 * Text helpers for turning raw source excerpts into things a game can display.
 *
 * The compiler's AI step is allowed to return loosely-shaped nodes — an
 * objective may arrive as `{ title, prompt }`, as a bare string, or as an object
 * with neither. Downstream we need two distinct values from any of those:
 * a SHORT label (room titles, entity captions) and the FULL text (prompts,
 * evidence bodies). Collapsing both to the same raw excerpt is what made builds
 * render 200-character markdown blobs as entity names.
 */

/** Keys an AI-shaped node might carry its text under, most specific first. */
const TEXT_KEYS = ['text', 'prompt', 'description', 'title', 'label', 'name', 'summary'] as const;

/**
 * Coerce an unknown node to a plain string. Unlike `String(value)` this never
 * produces "[object Object]" — an object without any recognizable text key
 * yields an empty string, so callers can fall back deliberately.
 */
export function plainText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join(' ').trim();
  if (typeof value === 'object') {
    for (const key of TEXT_KEYS) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return '';
}

/**
 * Split source text into sentences, respecting the document's structure.
 *
 * Collapsing all whitespace before splitting on terminal punctuation fuses
 * every line that lacks a full stop into one run. A pipeline diagram written as
 *
 *     Raw Data
 *         ↓
 *     Signal Extraction
 *         ↓
 *     Semantic Objects
 *
 * arrived as the single "sentence" "Raw Data ↓ Signal Extraction ↓ Semantic
 * Objects ↓ …", which became the displayed name of a collectible. Headings,
 * table rows, and bullets fused with their neighbours the same way.
 *
 * This lives here because three services had each written the naive version —
 * semantic extraction, IRX normalization, and emotional intelligence — so the
 * same blob reached gameplay by three different routes and fixing one left the
 * others emitting it.
 */
export function documentSentences(text: string): string[] {
  return textUnits(text)
    .flatMap((unit) => unit.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** One coherent run of prose per entry, with document structure already resolved. */
export function textUnits(text: string): string[] {
  const withoutCode = String(text || '')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n');

  const units: string[] = [];
  let open = '';
  const flush = () => {
    const unit = open.trim();
    if (unit) units.push(unit);
    open = '';
  };

  for (const rawLine of withoutCode.split('\n')) {
    if (isLayoutLine(rawLine)) {
      flush();
      continue;
    }
    // A table row is a list of cells, not a sentence: "| Source | id | type |"
    // read as prose produced "Source id type timestamp content metadata".
    if (rawLine.trim().startsWith('|')) {
      flush();
      for (const cell of rawLine.split('|')) {
        const value = cleanLine(cell);
        if (value) units.push(value);
      }
      continue;
    }
    const line = cleanLine(rawLine);
    if (!line) {
      flush();
      continue;
    }
    // Two lines join only when the first genuinely ends mid-sentence and the
    // second resumes it — a wrapped paragraph, not two adjacent headings.
    const wrapped = open && !/[.!?:;]$/.test(open) && /^[a-z,;]/.test(line);
    if (wrapped) open = `${open} ${line}`;
    else {
      flush();
      open = line;
    }
  }
  flush();
  return units;
}

/**
 * True for a line carrying layout rather than content: an arrow, a rule, a
 * table separator. Judged by how much of it is alphanumeric, so it holds for
 * box-drawing and ASCII diagrams without enumerating every character.
 */
function isLayoutLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const letters = (trimmed.match(/[A-Za-z0-9]/g) || []).length;
  return letters === 0 || letters / trimmed.length < 0.4;
}

/** Strip markdown decoration so a phrase is never extracted with its markup. */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|\*|_)([^*_]+)\1/g, '$2')
    .replace(/<[^>]*>/g, ' ')
    // A possessive is not a word. The tokenizer splits on the apostrophe, so
    // "the person's desired state" left a stray "s" that then led a phrase.
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Leading decoration we strip before reading a label out of source text. */
const LEADING_NOISE = /^\s*(?:[#>*\-+•]+\s*|\d+[.)]\s+|\[[^\]]{1,40}\]\s*)+/;
/** Clause boundaries, in the order we prefer to cut on. */
const CLAUSE_BREAK = /(?<=[.!?])\s+|\s+[·–—|]\s+|:\s+|;\s+/;
/** Shortest leading clause we'll accept as a label rather than a stray fragment. */
const MIN_CLAUSE = 24;

/**
 * Reduce text to a short, human-readable label.
 *
 * Strips markdown/bullet/tag decoration, collapses whitespace, cuts at the first
 * sentence or clause boundary, and caps the result. Text that is already short
 * comes back essentially unchanged, so an AI-supplied real title survives intact.
 */
export function shortLabel(value: unknown, max = 64): string {
  const raw = plainText(value).replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const stripped = raw.replace(LEADING_NOISE, '').trim() || raw;
  const [firstClause] = stripped.split(CLAUSE_BREAK);
  // A very short leading clause is usually a fragment ("target: game · arc: …"),
  // not a title — fall back to the capped full text so the label still says
  // something. Only trust a clause break that yields a meaningful phrase.
  const candidate = (firstClause || '').trim();
  let label = candidate.length >= MIN_CLAUSE || candidate.length === stripped.length ? candidate : stripped;

  if (label.length > max) {
    // Prefer breaking on a word boundary rather than mid-token.
    const cut = label.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(' ');
    label = `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  return label;
}

// ---- noun-phrase extraction ----

/**
 * Phrase machinery, shared because naming is not one layer's problem.
 *
 * These word lists and the scanner over them were private to semantic
 * extraction, so every other layer that needed a NAME from a sentence could
 * only truncate one. An IRX objective is a sentence by design ("The compiler
 * extracts meaning, models the person's current state, and proposes…"), and it
 * travelled through the manifest and the mapping layer as a quest title,
 * arriving on screen as a collectible called "The compiler extracts meaning,
 * models the person current…". Truncation at 64 characters is not a name.
 */

/** Determiners and quantifiers. A word right after one of these opens a noun phrase. */
const DETERMINERS = [
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'each', 'every', 'some', 'any', 'no', 'all',
  'both', 'either', 'neither', 'much', 'many', 'more', 'most', 'few', 'several', 'such', 'own',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
];

const PREPOSITIONS = [
  'of', 'in', 'on', 'at', 'to', 'from', 'by', 'for', 'with', 'without', 'into', 'onto', 'upon',
  'about', 'across', 'after', 'before', 'during', 'through', 'between', 'among', 'against',
  'over', 'under', 'above', 'below', 'within', 'inside', 'outside', 'toward', 'towards', 'via', 'per',
  // verb particles — they attach to the verb, so a phrase must not open on one
  // ("out costs nothing later" came from "…rules it out costs nothing later")
  'out', 'up', 'down', 'off', 'back', 'away', 'along', 'around',
  // participial prepositions — they head a modifier clause, not a concept
  'using', 'including', 'regarding', 'concerning', 'following', 'based', 'given', 'despite',
];

const SUBORDINATORS = [
  'and', 'or', 'but', 'nor', 'so', 'yet', 'as', 'than', 'because', 'if', 'unless', 'while',
  'when', 'where', 'whether', 'though', 'although', 'since', 'until',
  // wh-words that open a clause: without them "observes how actual outcomes"
  // survived as a single phrase spanning the verb and its complement.
  'how', 'why',
];

/**
 * Words after which a lone following word is almost certainly a verb, not a
 * concept: modals, the infinitive marker, copulas, do-support, negation, and
 * the adverbs that introduce an imperative step ("First, isolate the host").
 */
const VERB_LEAD = new Set([
  'to', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'need', 'ought', 'let', 'not', 'never', 'also', 'then', 'first', 'second', 'third',
  'next', 'finally', 'likely', 'probably', 'typically', 'generally', 'simply', 'actually',
  'really', 'clearly', 'certainly', 'often', 'usually', 'always',
]);

/**
 * Words that end a noun phrase rather than belong to one. A phrase is never
 * allowed to start or end on one of these, which is what keeps concepts from
 * coming out as mid-sentence fragments.
 */
const PHRASE_BOUNDARY = new Set([
  ...DETERMINERS,
  ...PREPOSITIONS,
  ...SUBORDINATORS,
  // pronouns / wh-words
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'us', 'them',
  'who', 'whom', 'whose', 'which', 'what', 'there', 'here',
  // auxiliaries / modals / copulas
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'done',
  'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could',
  'may', 'might', 'must', 'need', 'ought', 'let',
  // sequence / discourse / manner adverbs — these surfaced as standalone "concepts"
  'first', 'second', 'third', 'next', 'then', 'finally', 'also', 'however', 'therefore',
  'thus', 'meanwhile', 'furthermore', 'moreover', 'instead', 'rather', 'again', 'once',
  'very', 'just', 'only', 'even', 'still', 'not', 'never', 'always', 'often', 'usually',
  // temporal / degree adverbs: a noun phrase never ends on one, and without
  // them "the second consumer later" yielded the label "Consumer Later"
  'later', 'earlier', 'soon', 'now', 'today', 'yesterday', 'tomorrow', 'already',
  'together', 'anymore', 'everywhere', 'anywhere', 'somewhere', 'well', 'far', 'ever',
  'likely', 'probably', 'typically', 'generally', 'simply', 'actually', 'really', 'clearly',
  'certainly',
  // high-frequency verbs — splitting on these leaves the noun phrases on either side
  'get', 'gets', 'got', 'make', 'makes', 'made', 'take', 'takes', 'took', 'give', 'gives',
  'use', 'uses', 'used', 'show', 'shows', 'showed', 'know', 'knows', 'knew', 'see', 'sees',
  'come', 'comes', 'came', 'go', 'goes', 'went', 'say', 'says', 'said', 'find', 'finds',
  'found', 'keep', 'keeps', 'kept', 'put', 'puts', 'call', 'calls', 'called', 'become',
  'becomes', 'became', 'includes', 'include', 'included', 'contains', 'contain', 'allows',
  'allow', 'produces', 'produce', 'produced', 'requires', 'require', 'required', 'means',
  'converts', 'convert', 'absorbs', 'absorb', 'splits', 'split', 'fixes', 'fix', 'hosts',
  'host', 'regulates', 'regulate', 'catalyzes', 'catalyze', 'releases', 'release',
  'identify', 'identifies', 'review', 'reviews', 'avoid', 'avoids', 'complete', 'completes',
  'build', 'builds', 'create', 'creates', 'verify', 'verifies', 'compare', 'compares',
  'analyze', 'analyzes', 'configure', 'configures', 'select', 'selects', 'improve',
  'improves', 'increase', 'increases', 'explain', 'explains', 'learn', 'learns',
  'holds', 'hold', 'wants', 'want', 'remains', 'remain', 'depends', 'depend', 'rise', 'rises',
  'encrypt', 'encrypts', 'revoke', 'revokes', 'rotate', 'rotates', 'isolate', 'isolates',
  'restart', 'restarts', 'decide', 'decides', 'enter', 'enters', 'capture', 'captures',
]);

/** Longest phrase we keep. English noun phrases are head-final, so we trim the front. */
const MAX_PHRASE_TOKENS = 4;

/**
 * Words that describe the document rather than its subject. They repeat
 * heavily in any structured source — "Example" appeared nine times in an
 * architecture doc, "Layer" thirteen — so frequency alone promotes them above
 * the real topics. Only single-word concepts are judged against this: "layer
 * cake" or "example query" are about something.
 */
export const SCAFFOLDING_WORDS = new Set([
  'example', 'examples', 'layer', 'layers', 'note', 'notes', 'figure', 'table',
  'section', 'chapter', 'step', 'steps', 'summary', 'overview', 'introduction',
  'conclusion', 'appendix', 'diagram', 'above', 'below', 'following', 'detail',
  'details', 'point', 'points', 'case', 'cases', 'part', 'parts', 'thing', 'things',
  'way', 'ways', 'kind', 'kinds', 'sort', 'type', 'types', 'version', 'result', 'results',
]);

/** A third-person verb form ("holds", "reviews") rather than a plural noun ("logs", "class"). */
function looksThirdPerson(word: string): boolean {
  return /s$/.test(word) && !/(?:ss|us|is|as|os)$/.test(word) && word.length > 3;
}

/**
 * Extract noun-phrase-shaped concepts from one sentence.
 *
 * The previous implementation slid a non-overlapping 1-3 word window across the
 * sentence, which chopped clauses at arbitrary points: "Chlorophyll absorbs blue
 * and red light inside the chloroplast" became "Chlorophyll absorbs blue" /
 * "and red light" / "inside the chloroplast". Those fragments became gameplay
 * atom labels, entity captions, and world location names.
 *
 * Instead, split on function words and punctuation and keep the content-word
 * runs between them, then use the surrounding function words to tell a noun
 * phrase from a bare verb — a single word after a modal ("must decide") or
 * before a determiner ("isolate the endpoint") is the predicate, not a concept.
 * Phrases are sliced from the original sentence so real capitalization survives.
 */
export function keyPhrases(sentence: string): string[] {
  const tokens: Array<{ lower: string; start: number; end: number }> = [];
  const wordPattern = /[A-Za-z][A-Za-z0-9-]*/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(sentence)) !== null) {
    tokens.push({ lower: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }

  const phrases: string[] = [];
  const seen = new Set<string>();
  let run: typeof tokens = [];
  // The function words bracketing the current run; '' means punctuation or
  // the sentence edge, which carries no part-of-speech evidence.
  let leading = '';

  const flush = (trailing: string) => {
    const candidate = run;
    run = [];
    if (!candidate.length) return;

    // "The forensic analyst reviews the logs" -> drop the trailing verb.
    const trailingIsDeterminer = DETERMINERS.includes(trailing);
    let kept = candidate;
    if (kept.length > 1 && trailingIsDeterminer && looksThirdPerson(kept[kept.length - 1].lower)) {
      kept = kept.slice(0, -1);
    }
    // Mirror image: a run opening on a third-person verb is predicate-first
    // ("observes actual outcomes"), and the noun phrase is what follows it.
    // Only when a function word preceded the run, so a subject noun that
    // merely ends in -s ("signals arrive") is not mistaken for a verb.
    if (kept.length > 1 && leading && looksThirdPerson(kept[0].lower)) {
      kept = kept.slice(1);
    }
    // Head-final: "the primary electron transport chain" -> "electron transport chain".
    if (kept.length > MAX_PHRASE_TOKENS) {
      kept = kept.slice(-MAX_PHRASE_TOKENS);
    }
    if (!kept.length) return;

    if (kept.length === 1) {
      const word = kept[0];
      // A lone short word ("red", "gas") is noise, not a concept.
      if (word.end - word.start < 5) return;
      // Positional verb test: "must decide whether", "isolate the endpoint".
      const followsVerbLead = VERB_LEAD.has(leading);
      const precedesFunctionWord = trailingIsDeterminer
        || PREPOSITIONS.includes(trailing)
        || SUBORDINATORS.includes(trailing);
      if (followsVerbLead && precedesFunctionWord) return;
      if (trailingIsDeterminer && !DETERMINERS.includes(leading)) return;
    }

    const phrase = sentence.slice(kept[0].start, kept[kept.length - 1].end).trim();
    const key = phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    phrases.push(phrase);
  };

  for (const token of tokens) {
    if (PHRASE_BOUNDARY.has(token.lower)) {
      flush(token.lower);
      leading = token.lower;
      continue;
    }
    // Punctuation between two words also ends the phrase — a comma or dash is
    // a clause boundary, not part of the concept.
    const previous = run[run.length - 1];
    if (previous && /[^\s]/.test(sentence.slice(previous.end, token.start))) {
      flush('');
      leading = '';
    }
    run.push(token);
  }
  flush('');

  return phrases.slice(0, 8);
}

/**
 * A short display NAME for a piece of text.
 *
 * `shortLabel` cuts text down; this one picks the noun phrase the text is
 * about, which is what a caption, an entity name, or a quest title needs. Text
 * that already reads as a name is passed through untouched — only sentences
 * are reduced.
 */
export function phraseLabel(value: unknown, max = 48): string {
  const text = plainText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // Already a name: short, few words, and not punctuated as a sentence.
  const looksLikeAName = text.length <= max
    && !/[.!?]\s*$/.test(text)
    && text.split(/\s+/).length <= 6;
  if (looksLikeAName) return shortLabel(text, max);

  const phrases = keyPhrases(text)
    .filter((phrase) => !SCAFFOLDING_WORDS.has(phrase.toLowerCase()));
  if (!phrases.length) return shortLabel(text, max);

  // Most specific wins. Ties go to the earliest, which in a head-final language
  // is usually the subject rather than something in a trailing clause.
  const best = phrases.reduce((winner, phrase) =>
    phrase.split(/\s+/).length > winner.split(/\s+/).length ? phrase : winner);
  return shortLabel(best, max);
}

