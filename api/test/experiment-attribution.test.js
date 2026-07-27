'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate the ledger from the developer's real .optomole-data before anything
// reads gatewayConfig() (which resolves env at call time, uncached).
const TMP_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'optomole-experiments-'));
process.env.EXPERIMENT_STORE_PATH = TMP_STORE;

const { ExperimentStore } = require('../dist/signals/experiment.store');
const { ReflectionService } = require('../dist/signals/reflection.service');
const { PersonGraphService } = require('../dist/signals/person-graph.service');

/**
 * Experiment attribution: which play session tested which hypothesis.
 *
 * `experienceId` is a slug of the source title, so every build compiled from the
 * same content shares it — and two untitled sessions both slug to
 * `exp-untitled-session`. These guard the claim that a second build can neither
 * evict the first one's experiment nor inherit its play history.
 */

const NOW = 1_800_000_000_000;
const SHARED_EXPERIENCE = 'exp-untitled-session';

function experiment(overrides) {
  return {
    experienceId: SHARED_EXPERIENCE,
    buildId: 'build-1',
    personId: 'p',
    createdAt: new Date(NOW).toISOString(),
    hypothesis: 'They will engage with arcade play.',
    mode: 'explore',
    genre: 'arcade',
    templateId: 'arcade-collect-avoid.v1',
    topicFocus: null,
    rationale: 'untried genre',
    steered: true,
    status: 'pending',
    ...overrides,
  };
}

/** Signals for one play session. `rooms` drives the engagement score. */
function plays({ buildId, experienceId = SHARED_EXPERIENCE, rooms, durationMs }) {
  const tag = { ts: NOW, receivedAt: new Date(NOW).toISOString(), source: 'runtime', experienceId };
  if (buildId) tag.buildId = buildId;
  const out = [{ type: 'experience_start', ...tag }];
  for (let i = 0; i < rooms; i += 1) out.push({ type: 'room_cleared', ...tag, data: { roomId: `r${i}` } });
  out.push({ type: 'session_end', ...tag, data: { roomsCleared: rooms, durationMs } });
  return out;
}

const ENGAGED = { rooms: 3, durationMs: 200_000 };
const ABANDONED = { rooms: 0, durationMs: 4_000 };

/** A reflection service over a fixed signal log and a real (temp-backed) ledger. */
function reflectionOver(signals, store) {
  const service = new ReflectionService(
    {
      get: () => ({ personId: 'p', firstSeen: '', lastSeen: '', count: signals.length, signals }),
      append: (_id, emitted) => signals.push(...emitted),
    },
    store,
    { build: () => ({ nodes: [] }) },
  );
  return service.reflect('p');
}

/** A fresh ledger per test — the store hydrates lazily from its own directory. */
function freshStore() {
  const dir = fs.mkdtempSync(path.join(TMP_STORE, 'case-'));
  process.env.EXPERIMENT_STORE_PATH = dir;
  return new ExperimentStore();
}

test('two experiments sharing an experienceId both survive the ledger', () => {
  const store = freshStore();
  store.record(experiment({ buildId: 'build-1', hypothesis: 'first' }));
  store.record(experiment({ buildId: 'build-2', hypothesis: 'second' }));

  assert.equal(store.listForPerson('p').length, 2, 'the earlier experiment was evicted');
  assert.equal(store.findByBuild('build-1').hypothesis, 'first');
  assert.equal(store.findByBuild('build-2').hypothesis, 'second');
});

test('updating one build does not restate the other', () => {
  const store = freshStore();
  store.record(experiment({ buildId: 'build-1' }));
  store.record(experiment({ buildId: 'build-2' }));

  store.update('build-1', { status: 'confirmed' });

  assert.equal(store.findByBuild('build-1').status, 'confirmed');
  assert.equal(store.findByBuild('build-2').status, 'pending');
});

test('each experiment is scored by the plays of its own build', () => {
  const store = freshStore();
  store.record(experiment({ buildId: 'build-1' }));
  store.record(experiment({ buildId: 'build-2' }));

  const result = reflectionOver(
    [...plays({ buildId: 'build-1', ...ENGAGED }), ...plays({ buildId: 'build-2', ...ABANDONED })],
    store,
  );

  assert.equal(result.processed, 2);
  // Same slug, same genre, opposite play sessions → opposite verdicts. Joining
  // on experienceId would have given both experiments the merged stream.
  assert.equal(store.findByBuild('build-1').status, 'confirmed');
  assert.equal(store.findByBuild('build-2').status, 'refuted');
});

test('an unplayed build stays pending while its slug-mate is scored', () => {
  const store = freshStore();
  store.record(experiment({ buildId: 'build-1' }));
  store.record(experiment({ buildId: 'build-2' }));

  const result = reflectionOver(plays({ buildId: 'build-1', ...ENGAGED }), store);

  assert.equal(result.processed, 1);
  assert.equal(result.pendingUnplayed, 1);
  assert.equal(store.findByBuild('build-2').status, 'pending', 'scored a build nobody played');
});

test('signals predating buildId still resolve by experienceId', () => {
  const store = freshStore();
  store.record(experiment({ buildId: 'build-legacy' }));

  const result = reflectionOver(plays({ ...ENGAGED }), store); // no buildId on the signals

  assert.equal(result.processed, 1);
  assert.equal(store.findByBuild('build-legacy').status, 'confirmed');
});

test('a new build does not inherit a legacy play history through a shared slug', () => {
  const store = freshStore();
  store.record(experiment({ buildId: 'build-new' }));

  // Untagged plays of some older build with the same title slug, plus this
  // build's own (abandoned) session. Only the tagged ones are its evidence.
  const result = reflectionOver(
    [...plays({ ...ENGAGED }), ...plays({ buildId: 'build-new', ...ABANDONED })],
    store,
  );

  assert.equal(result.processed, 1);
  assert.equal(store.findByBuild('build-new').status, 'refuted', 'absorbed another build\'s engagement');
});

test('reflection reports the build it scored, not just the slug', () => {
  const store = freshStore();
  store.record(experiment({ buildId: 'build-1' }));

  const result = reflectionOver(plays({ buildId: 'build-1', ...ENGAGED }), store);

  assert.equal(result.insights[0].buildId, 'build-1');
  assert.equal(result.insights[0].experienceId, SHARED_EXPERIENCE);
});

// --- the same collision in the identity graph ---------------------------------

function graphOf(signals) {
  return new PersonGraphService({
    get: () => ({ personId: 'p', firstSeen: '', lastSeen: '', count: signals.length, signals }),
  }).build('p', { asOf: NOW });
}

function start(buildId) {
  const s = {
    type: 'experience_start',
    ts: NOW,
    receivedAt: new Date(NOW).toISOString(),
    source: 'runtime',
    experienceId: SHARED_EXPERIENCE,
    template: 'arcade-collect-avoid.v1',
  };
  return buildId ? { ...s, buildId } : s;
}

test('first plays of two different builds are not a replay', () => {
  const graph = graphOf([start('build-1'), start('build-2')]);
  assert.equal(
    graph.nodes.find((n) => n.id === 'trait:persistent'),
    undefined,
    'awarded persistence for playing two different games once each',
  );
});

test('replaying the same build still reads as persistence', () => {
  const graph = graphOf([start('build-1'), start('build-1')]);
  assert.ok(graph.nodes.find((n) => n.id === 'trait:persistent'), 'lost the replay signal');
});
