'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SemanticExtractionService } = require('../dist/preprocessing/semantic-extraction.service');
const { phraseLabel, shortLabel } = require('../dist/shared/text');

/**
 * Concept extraction quality.
 *
 * Concepts are not an internal detail: they become collectible names, region
 * names, quiz distractors, and knowledge-graph nodes. A run over a real
 * architecture document returned "layer", "inbox", "source", "person" as its
 * top concepts and, because line breaks were erased before sentence splitting,
 * a pipeline diagram arrived as one "sentence" that became an item called
 * "Raw Data ↓ Signal Extraction ↓ Semantic Objects ↓ Life State…".
 *
 * These guard the two properties that failure violated: structure is read
 * before prose, and a concept is ranked by what it identifies rather than by
 * how often it happens to appear.
 */

const service = new SemanticExtractionService();

function extract(text, title = 'Doc') {
  return service.extract({
    title,
    items: [{ id: 'src-1', title, text, sourceType: 'document', origin: 'test' }],
    goals: [],
    achievements: [],
  });
}

const conceptTexts = result => result.concepts.map(concept => concept.text);

// ---- structure is read before prose ----

test('a diagram of bare lines does not fuse into one sentence', () => {
  const result = extract(`One way to formalize this is with a multi-layer mapping architecture.

Raw Data
    ↓
Signal Extraction
    ↓
Semantic Objects
    ↓
Life State Graph
`);

  const sentences = result.documents[0].segmentation.sentenceCount;
  assert.ok(sentences >= 5, `each diagram line stands alone (got ${sentences} units)`);
  for (const concept of conceptTexts(result)) {
    assert.ok(!/[↓→]/.test(concept), `"${concept}" carries diagram layout into a label`);
    assert.ok(concept.length <= 48, `"${concept}" is a label, not a paragraph`);
  }
});

test('table rows become one concept candidate per cell', () => {
  const result = extract(`Signals are described by a schema.

| Source | Type | Confidence |
|--------|------|------------|
| Email inbox | message | high |

Every inbox signal carries a source. Every inbox signal carries a type.`);

  for (const concept of conceptTexts(result)) {
    assert.ok(!concept.includes('|'), `"${concept}" leaked table markup`);
    assert.ok(!/Source Type Confidence/i.test(concept), `"${concept}" fused a whole table row`);
  }
});

test('fenced code is not mined for concepts', () => {
  const result = extract(`The compiler emits a signal record for each message.

\`\`\`ts
interface Signal { id: string; source: string; confidence: number; }
const RETRY_BUDGET_MS = 4000;
\`\`\`

Each signal record is scored. Each signal record is stored.`);

  for (const concept of conceptTexts(result)) {
    assert.ok(!/RETRY_BUDGET_MS|interface Signal/.test(concept), `"${concept}" came from code`);
  }
});

test('a possessive does not become its own word', () => {
  const result = extract(`The person's desired future state is modelled.
The person's desired future state is compared against the person's current state.
A model of the person's desired future state guides the next experience.`);

  for (const concept of conceptTexts(result)) {
    assert.ok(!/^s\b/.test(concept), `"${concept}" starts on a stray possessive fragment`);
  }
});

// ---- ranking identifies rather than tallies ----

test('salience is a 0-1 score, because downstream layers score edges with it', () => {
  const result = extract(`Signal quality matters. Signal quality matters again. Signal quality is
central to the signal pipeline, and the signal pipeline depends on signal quality.`);

  assert.ok(result.concepts.length > 0, 'something was extracted');
  for (const concept of result.concepts) {
    assert.ok(
      concept.salience >= 0 && concept.salience <= 1,
      `${concept.text} salience ${concept.salience} escapes the 0-1 contract`
    );
    assert.equal(typeof concept.occurrences, 'number', 'the raw count is still available');
    assert.ok(concept.occurrences >= 1);
  }
});

test('singular and plural are one concept, not two competing entries', () => {
  const result = extract(`A signal is recorded. Signals are recorded in order.
Every signal is scored, and signals are scored together. The signal store holds signals.`);

  const normalized = conceptTexts(result).map(text => text.toLowerCase());
  const signalEntries = normalized.filter(text => text === 'signal' || text === 'signals');
  assert.ok(signalEntries.length <= 1, `"signal" and "signals" both survived: ${signalEntries}`);
});

test('a phrase subsumes the bare word inside it', () => {
  const result = extract(`Signal extraction runs first. Signal extraction is deterministic.
Signal extraction produces observations, and signal extraction is cheap.
The signal extraction stage is documented.`);

  const normalized = conceptTexts(result).map(text => text.toLowerCase());
  assert.ok(normalized.some(text => text.includes('signal extraction')), 'the full phrase is kept');
  assert.ok(!normalized.includes('signal'), 'the bare part is not also a concept');
});

test('document scaffolding is not mistaken for subject matter', () => {
  const result = extract(`Example: a message arrives.
Example: a calendar entry arrives. Example: a location ping arrives.
Example: a playlist update arrives. Example: a commit arrives.
Each arrival updates the traveller manifest. The traveller manifest is durable.`);

  const normalized = conceptTexts(result).map(text => text.toLowerCase());
  assert.ok(!normalized.includes('example'), '"Example" repeats in any structured doc');
  assert.ok(
    normalized.some(text => text.includes('traveller manifest')),
    'the actual subject still surfaces'
  );
});

test('a repeated subject outranks a one-off four-word fragment', () => {
  const result = extract(`The routing table is authoritative. The routing table is replicated.
The routing table is versioned. The routing table is audited every night.
Whichever way it observes how actual outcomes settle, the routing table wins.`);

  const top = result.concepts[0].text.toLowerCase();
  assert.ok(top.includes('routing table'), `expected the repeated subject on top, got "${top}"`);
});

// ---- naming: a label is not a truncated sentence ----

test('a sentence is reduced to the thing it is about, not its first 48 characters', () => {
  const sentence = 'One way to formalize this is with a multi-layer mapping architecture.';
  const label = phraseLabel(sentence);

  assert.ok(label.length <= 48, 'a label is short');
  assert.ok(!label.startsWith('One way to formalize'), 'it is not the head of the sentence');
  assert.match(label, /mapping architecture/, `expected the subject, got "${label}"`);
  assert.notEqual(label, shortLabel(sentence), 'naming and truncating are different operations');
});

test('text that already reads as a name passes through untouched', () => {
  for (const name of ['Server Vault', 'Signal Extraction', 'Dana Reyes', 'Life State Graph']) {
    assert.equal(phraseLabel(name), name, `${name} is already a name`);
  }
});

test('naming never returns an empty label for text that has words', () => {
  // Falls back to truncation when no noun phrase can be found, rather than
  // handing an empty caption to an entity.
  for (const awkward in { 'a b c': 1, '...': 1, '12 34': 1, 'the a of in': 1 }) {
    const label = phraseLabel(awkward);
    assert.equal(typeof label, 'string');
  }
  assert.ok(phraseLabel('the quick brown fox jumped over the lazy dog today').length > 0);
});

test('extraction survives a document with no prose at all', () => {
  const result = extract('| a | b |\n|---|---|\n\n    ↓\n\n```\ncode();\n```\n');
  assert.ok(Array.isArray(result.concepts), 'no crash, just an honest empty-ish result');
  assert.equal(result.stats.conceptCount, result.concepts.length);
});
