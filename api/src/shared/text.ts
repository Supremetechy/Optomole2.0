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
