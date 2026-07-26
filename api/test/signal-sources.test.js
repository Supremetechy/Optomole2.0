'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate the store from the developer's real .optomole-data before anything
// reads gatewayConfig() (which resolves env at call time, uncached).
const TMP_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'optomole-signals-'));
process.env.SIGNAL_STORE_PATH = TMP_STORE;

const { PersonGraphService } = require('../dist/signals/person-graph.service');
const { SignalStore } = require('../dist/signals/signals.store');
const { SignalsService } = require('../dist/signals/signals.service');

/**
 * Step 1 + 2 of the EmailStreamEngine build order: a `source` discriminator on
 * the signal stream, and per-sensor calibration in the graph fold.
 *
 * The claim these guard is that adding a second sensor cannot quietly rewrite
 * what the system already believes — neither by changing existing graphs, nor
 * by letting a high-volume sensor out-shout a low-volume one.
 */

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed so decay is deterministic

/** A graph service backed by a fixed log — no disk, no ingestion path. */
function graphOf(signals) {
  const service = new PersonGraphService({
    get: () => ({ personId: 'p', firstSeen: '', lastSeen: '', count: signals.length, signals }),
  });
  return service.build('p', { asOf: NOW });
}

function signal(overrides) {
  return { type: 'key_collected', ts: NOW, receivedAt: new Date(NOW).toISOString(), ...overrides };
}

function nodeById(graph, id) {
  return graph.nodes.find((n) => n.id === id);
}

// --- step 1: the discriminator -------------------------------------------

test('a batch with no source is stored as runtime', () => {
  const store = new SignalStore();
  const service = new SignalsService(store);
  const result = service.ingest('p-default', { signals: [{ type: 'experience_start' }] });

  assert.equal(result.source, 'runtime');
  assert.equal(store.get('p-default').signals[0].source, 'runtime');
});

test('a declared known source is preserved through ingestion', () => {
  const store = new SignalStore();
  const service = new SignalsService(store);
  const result = service.ingest('p-inbox', { source: 'inbox', signals: [{ type: 'key_collected' }] });

  assert.equal(result.source, 'inbox');
  assert.equal(store.get('p-inbox').signals[0].source, 'inbox');
});

test('an unknown source is rejected, not coerced to runtime', () => {
  const store = new SignalStore();
  const service = new SignalsService(store);

  // Coercing would silently admit an uncalibrated sensor weighted as gameplay
  // telemetry — the exact failure the discriminator exists to prevent.
  assert.throws(
    () => service.ingest('p-bad', { source: 'twitter', signals: [{ type: 'key_collected' }] }),
    /Unknown signal source 'twitter'/,
  );
  assert.equal(store.get('p-bad'), null, 'nothing was written');
});

test('logs written before sources existed are backfilled as runtime on read', () => {
  const personId = 'legacy-person';
  const legacy = {
    personId,
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    count: 2,
    // Exactly the shape found in .optomole-data/signals: no `source` key.
    signals: [
      { type: 'experience_start', ts: NOW, receivedAt: '2026-01-01T00:00:00.000Z', template: 'quest-rpg.v1' },
      { type: 'room_cleared', ts: NOW, receivedAt: '2026-01-01T00:00:00.000Z', template: 'quest-rpg.v1' },
    ],
  };
  fs.mkdirSync(TMP_STORE, { recursive: true });
  fs.writeFileSync(
    path.join(TMP_STORE, `${Buffer.from(personId).toString('base64url')}.json`),
    JSON.stringify(legacy),
  );

  const log = new SignalStore().get(personId);
  assert.equal(log.signals.length, 2);
  assert.ok(log.signals.every((s) => s.source === 'runtime'), 'every legacy signal is stamped');
});

// --- step 2: calibration --------------------------------------------------

test('a runtime-only graph is bit-for-bit the pre-calibration model', () => {
  // The safety property. Noisy-OR over one sensor at kMultiplier 1 must
  // collapse to support/(support+K) — the formula that produced every graph
  // already on disk. If this drifts, historical graphs silently change.
  const signals = [
    signal({ type: 'experience_start', template: 'quest-rpg.v1' }),
    signal({ type: 'key_collected', data: { label: 'Ledger' } }),
    signal({ type: 'key_collected', data: { label: 'Ledger' }, ts: NOW - 10 * DAY }),
    signal({ type: 'room_cleared', template: 'quest-rpg.v1' }),
    signal({ type: 'session_end', data: { roomsCleared: 2, durationMs: 120_000 } }),
  ];
  const graph = graphOf(signals);
  const K = graph.params.k;

  const observed = graph.nodes.filter((n) => Object.keys(n.bySource).length > 0);
  assert.ok(observed.length >= 4, 'the fold produced evidence-backed nodes');
  for (const node of observed) {
    const expected = Math.round((node.support / (node.support + K)) * 1e4) / 1e4;
    assert.equal(node.confidence, expected, `${node.id} matches the original closed form`);
  }
});

/**
 * Frozen output of the pre-calibration implementation (commit f138a72) for the
 * aged, low-support signal set below — the regime real logs actually live in,
 * where confidence sits around 0.001–0.06 and small numeric changes hide.
 *
 * Captured by running the old build, not derived: reconstructing it in-test
 * from the published `support` field is impossible, because that field is
 * itself rounded to 4dp. (Trying to derive it is how an earlier version of
 * this test reported drift that did not exist.) If these values change, the
 * fold's arithmetic changed — decide whether that was intended before
 * re-capturing them.
 */
const PRE_CALIBRATION_CONFIDENCE = {
  'interest:ledger': 0.0606,
  'trait:risk-taking': 0.0291,
  'trait:collector': 0.0169,
  'mastery:genre:quest-rpg': 0.0103,
  'trait:finisher': 0.0045,
  'tendency:completionist': 0.0045,
  'trait:progresses': 0.0031,
  'context:pace:measured': 0.0031,
  'engaged:genre:quest-rpg': 0.0026,
  'prefers:genre:quest-rpg': 0.0026,
  'context:active:night': 0.0007,
  'context:pace:deliberate': 0.0001,
};

const AGED_SIGNALS = [
  signal({ type: 'experience_start', template: 'quest-rpg.v1', ts: NOW - 210 * DAY }),
  signal({ type: 'room_cleared', template: 'quest-rpg.v1', ts: NOW - 180 * DAY }),
  signal({ type: 'session_end', ts: NOW - 150 * DAY, data: { roomsCleared: 1, durationMs: 120_000 } }),
  signal({ type: 'session_end', ts: NOW - 300 * DAY, data: { roomsCleared: 3, durationMs: 400_000 } }),
  signal({ data: { label: 'Ledger' }, ts: NOW - 240 * DAY }),
  signal({ data: { label: 'Ledger' }, ts: NOW - 90 * DAY }),
  signal({ type: 'xp_gain', template: 'quest-rpg.v1', ts: NOW - 120 * DAY, data: { amount: 30 } }),
  signal({ type: 'focus_damage', ts: NOW - 60 * DAY, data: { amount: 12 } }),
];

test('aged low-support nodes match the pre-calibration output exactly', () => {
  // Computing confidence as 1 − (1 − c) instead of c drops a digit down here
  // and silently rewrites every weak belief in every graph already on disk.
  const graph = graphOf(AGED_SIGNALS);
  const actual = Object.fromEntries(graph.nodes.map((n) => [n.id, n.confidence]));

  assert.deepEqual(actual, PRE_CALIBRATION_CONFIDENCE);
});

test('signals with no source at all fold identically to explicit runtime ones', () => {
  const withSource = graphOf([signal({ source: 'runtime', data: { label: 'Ledger' } })]);
  const withoutSource = graphOf([signal({ data: { label: 'Ledger' } })]);

  assert.deepEqual(
    nodeById(withoutSource, 'interest:ledger').confidence,
    nodeById(withSource, 'interest:ledger').confidence,
  );
  assert.deepEqual(nodeById(withoutSource, 'interest:ledger').bySource, { runtime: 1.5 });
});

test('a high-volume sensor cannot out-shout a low-volume one', () => {
  // 100 inbox observations of one topic against 4 runtime observations of
  // another. Uncalibrated, inbox would reach ~0.98 confidence and runtime
  // ~0.67, so the model's top interest would be a readout of emission rate.
  const inbox = Array.from({ length: 100 }, () =>
    signal({ source: 'inbox', data: { label: 'Shipping' } }),
  );
  const runtime = Array.from({ length: 4 }, () =>
    signal({ source: 'runtime', data: { label: 'Ledger' } }),
  );
  const graph = graphOf([...inbox, ...runtime]);

  const shipping = nodeById(graph, 'interest:shipping');
  const ledger = nodeById(graph, 'interest:ledger');

  assert.ok(shipping && ledger, 'both interests were folded');
  assert.ok(
    ledger.confidence > shipping.confidence,
    `4 deliberate acts should outweigh 100 incidental ones (ledger ${ledger.confidence} vs shipping ${shipping.confidence})`,
  );
  assert.ok(shipping.confidence < 0.6, 'inbox volume alone does not reach strong belief');
});

test('two sensors agreeing beat either alone', () => {
  const runtimeOnly = graphOf([signal({ source: 'runtime', data: { label: 'Ledger' } })]);
  const both = graphOf([
    signal({ source: 'runtime', data: { label: 'Ledger' } }),
    ...Array.from({ length: 10 }, () => signal({ source: 'inbox', data: { label: 'Ledger' } })),
  ]);

  const alone = nodeById(runtimeOnly, 'interest:ledger');
  const corroborated = nodeById(both, 'interest:ledger');

  assert.ok(
    corroborated.confidence > alone.confidence,
    'independent corroboration compounds rather than averaging away',
  );
  assert.deepEqual(Object.keys(corroborated.bySource).sort(), ['inbox', 'runtime']);
});

test('a sensor whose types the fold does not model yet is visibly received', () => {
  // The wiring gap that must not look like an absence of data: calendar
  // signals arrive, produce no nodes, and say so in the stats.
  const graph = graphOf([
    signal({ source: 'runtime', data: { label: 'Ledger' } }),
    { type: 'meeting_attended', ts: NOW, receivedAt: '', source: 'calendar' },
    { type: 'meeting_attended', ts: NOW, receivedAt: '', source: 'calendar' },
  ]);

  assert.equal(graph.stats.signalsBySource.calendar, 2, 'received count is reported');
  assert.ok(
    graph.nodes.every((n) => !Object.keys(n.bySource).includes('calendar')),
    'but nothing was modeled from them',
  );
});

test('reflection writes back under its own sensor, not as gameplay', () => {
  const graph = graphOf([
    signal({ type: 'reflection', source: 'reflection', data: { insight: 'Enjoys puzzles', weight: 0.8 } }),
  ]);
  const insight = nodeById(graph, 'insight:enjoys-puzzles');

  assert.ok(insight, 'reflection still produces an emergent insight node');
  assert.deepEqual(Object.keys(insight.bySource), ['reflection']);
});

test('the calibration in force is reported on every graph', () => {
  const graph = graphOf([signal({ data: { label: 'Ledger' } })]);
  assert.equal(graph.params.sourceCalibration.runtime.weight, 1);
  assert.equal(graph.params.sourceCalibration.runtime.kMultiplier, 1);
  assert.ok(graph.params.sourceCalibration.inbox.kMultiplier > 1, 'inbox is volume-corrected');
});
