'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FormSynthesisService } = require('../dist/compiler/form-synthesis.service');
const { GameplayDslService } = require('../dist/compiler/gameplay-dsl.service');

/**
 * Stage 2.5 — form synthesis.
 *
 * The claim under test is the one the stage exists for: the KIND of game is
 * derived from the shape of the upload, and the emitter composes that kind
 * rather than parameterizing a fixed platformer. So these check two things
 * together — that different content shapes choose different forms, and that a
 * chosen form actually changes the emitted bundle's geometry, controls, and win
 * condition.
 */

let seq = 0;
function node(kind, attributes, confidence = 0.9) {
  seq += 1;
  return { id: `sem-${seq}`, sourceNodeIds: ['content-1'], kind, attributes, confidence };
}

function model(semanticNodes, contentNodes = [content('text')]) {
  return {
    schemaVersion: '1.0.0',
    kind: 'optomole.SemanticModel',
    experienceId: 'exp-test',
    contentNodes,
    semanticNodes,
    coverage: {},
    stats: { contentNodeCount: contentNodes.length, semanticNodeCount: semanticNodes.length, byKind: {}, meanConfidence: 0.9 },
  };
}

function content(sourceType) {
  return { id: 'content-1', sourceType, raw: { ref: 'r', title: 't', characters: 100 }, origin: 'test' };
}

const forms = new FormSynthesisService();
const emitter = new GameplayDslService();

/** N nodes of one kind, so a shape can be dialed up without repeating literals. */
function many(kind, count, attributes = () => ({})) {
  return Array.from({ length: count }, (_, i) => node(kind, { label: `${kind}-${i}`, ...attributes(i) }));
}

// --- topology is read off the content's shape ---------------------------------

test('a relationship-dense source becomes a node map, not a run', () => {
  const form = forms.synthesize({
    model: model([
      ...many('relationship', 10, (i) => ({ from: `a${i}`, to: `b${i}`, relation: 'relates_to', gating: i < 4 })),
      ...many('actor', 3),
    ]),
  });

  assert.equal(form.topology.id, 'node-map');
  assert.equal(form.topology.gravity, false);
  assert.ok(form.verbs.includes('connect'));
  assert.equal(form.resolution.id, 'connect-all');
});

test('an ordered procedural source becomes a timeline', () => {
  const form = forms.synthesize({
    model: model(many('event', 8, (i) => ({ order: i, sceneType: 'procedure_step', verb: 'step' }))),
  });

  assert.equal(form.topology.id, 'timeline');
  assert.ok(form.verbs.includes('order'));
  assert.equal(form.resolution.id, 'order-sequence');
});

test('a source full of distinct interiors becomes a room graph', () => {
  const form = forms.synthesize({
    model: model([
      ...many('location', 6, () => ({ enclosure: 'interior', type: 'room' })),
      ...many('actor', 4),
    ]),
  });

  assert.equal(form.topology.id, 'room-graph');
  assert.equal(form.topology.layout, 'perimeter');
});

test('a tabular source with resource objectives becomes a board', () => {
  const form = forms.synthesize({
    model: model(
      many('objective', 3, (i) => ({ label: `Allocate budget ${i}`, summary: 'tradeoff between cost and capacity' })),
      [content('table')],
    ),
  });

  assert.equal(form.topology.id, 'board');
  assert.ok(form.verbs.includes('allocate'));
});

test('a shapeless source still compiles to something playable', () => {
  const form = forms.synthesize({ model: model([node('objective', { label: 'Understand it' })]) });

  assert.equal(form.topology.id, 'side-scroll');
  assert.equal(form.topology.gravity, true);
  assert.equal(form.resolution.id, 'reach-goal');
});

// --- verbs are earned by content, never assumed -------------------------------

test('no named risk means no combat verb', () => {
  const form = forms.synthesize({ model: model([...many('item', 3), ...many('actor', 2)]) });

  assert.ok(!form.verbs.includes('strike'), 'invented a fight the source never described');
  assert.ok(form.verbs.includes('collect'));
});

test('a confrontable hazard earns strike; an environmental one earns evade', () => {
  const fight = forms.synthesize({ model: model(many('hazard', 3, () => ({ gameplayType: 'challenge' }))) });
  const dodge = forms.synthesize({ model: model(many('hazard', 3, () => ({ gameplayType: 'avoidance_challenge' }))) });

  assert.ok(fight.verbs.includes('strike'));
  assert.ok(!fight.verbs.includes('evade'));
  assert.ok(dodge.verbs.includes('evade'));
  assert.ok(!dodge.verbs.includes('strike'));
});

test('a planar form binds four directions and no jump', () => {
  const form = forms.synthesize({ model: model(many('relationship', 10, (i) => ({ from: `a${i}`, to: `b${i}` }))) });
  const actions = form.inputBindings.map((b) => b.action);

  assert.deepEqual(actions.filter((a) => a.startsWith('Move')).sort(), ['MoveDown', 'MoveLeft', 'MoveRight', 'MoveUp']);
  assert.ok(!actions.includes('Jump'), 'bound a jump in a world with no gravity');
});

test('every choice carries provenance back to the source', () => {
  const nodes = [...many('relationship', 8, (i) => ({ from: `a${i}`, to: `b${i}` })), ...many('item', 2)];
  const form = forms.synthesize({ model: model(nodes) });
  const ids = new Set(nodes.map((n) => n.id));

  assert.ok(form.rationale.length >= 2, 'chose a form without saying why');
  assert.ok(form.derivedFrom.length > 0);
  assert.ok(form.derivedFrom.every((id) => ids.has(id)), 'cited a node that is not in the model');
});

// --- the emitter composes the form, rather than labelling a platformer --------

function buildFixture(itemCount = 3) {
  return {
    schemaVersion: '1.0.0',
    kind: 'optomole.ExperienceBuild',
    experienceId: 'exp-test',
    templateId: 'arcade-collect-avoid.v1',
    components: {
      world: { identity: { title: 'Test World' }, regions: [{ id: 'region-1', name: 'Region One', description: '' }] },
      inventory: { items: Array.from({ length: itemCount }, (_, i) => ({ name: `Item ${i + 1}`, bindingId: `b${i}` })) },
      cast: { characters: [] },
    },
    loadOrder: [],
    validation: { componentCoverage: {}, bindingCount: 0 },
  };
}

const entityOf = (bundle, suffix) => bundle.entities.find((e) => String(e.id).endsWith(suffix));
const transformOf = (entity) => entity.components.find((c) => c.type === 'TransformComponent').position;

test('without a form the emitter still builds the side-scroller', () => {
  const bundle = emitter.compile({ build: buildFixture() });

  assert.equal(bundle.game.config.gravity.y < 0, true);
  assert.ok(entityOf(bundle, '-ground'), 'dropped the floor from a gravity game');
  assert.equal(bundle.form.topology.id, 'side-scroll');
});

test('a planar form emits no gravity, no ground, and a steering player', () => {
  const form = forms.synthesize({ model: model(many('relationship', 10, (i) => ({ from: `a${i}`, to: `b${i}` }))) });
  const bundle = emitter.compile({ build: buildFixture(), form });

  assert.equal(bundle.game.config.gravity.y, 0);
  assert.equal(entityOf(bundle, '-ground'), undefined, 'built a floor in a world with no down');

  const machine = bundle.stateMachines.find((m) => m.id === 'player_state_machine');
  const actionTypes = machine.states.flatMap((s) => (s.onUpdateActions || []).map((a) => a.type));
  assert.ok(actionTypes.includes('ApplyPlanarMovementFromInput'));
  assert.ok(!machine.states.some((s) => s.id === 'Jumping'), 'kept a jump state nothing can land from');
});

test('a radial topology places content around the player, not ahead of them', () => {
  const form = forms.synthesize({ model: model(many('relationship', 10, (i) => ({ from: `a${i}`, to: `b${i}` }))) });
  const bundle = emitter.compile({ build: buildFixture(4), form });

  const items = bundle.entities.filter((e) => e.archetype === 'collectible').map(transformOf);
  assert.ok(items.length >= 3);
  // A run puts everything at increasing x on one line; a ring does not.
  assert.ok(items.some((p) => p.x < 0), 'every node was placed to the right — this is still a run');
  assert.ok(new Set(items.map((p) => p.y)).size > 1, 'every node shares one y — this is still a line');
});

test('collect-all gates completion on every item, not on arrival', () => {
  const form = forms.synthesize({ model: model([...many('item', 4), node('objective', { label: 'Learn it' })]) });
  assert.equal(form.resolution.id, 'collect-all');

  const bundle = emitter.compile({ build: buildFixture(4), form });
  const goal = bundle.triggers.find((t) => t.id.endsWith('-goal'));
  const gates = goal.conditions.filter((c) => c.type === 'VariableEquals');

  assert.equal(gates.length, 4, 'the marker opens without every item');
  assert.ok(gates.every((g) => g.parameters.scope === 'world'));

  // Each item must actually set the variable its gate reads, or the goal is
  // unreachable — the exact way a composed form becomes unwinnable.
  const setVars = new Set(
    bundle.triggers
      .flatMap((t) => t.actions || [])
      .filter((a) => a.type === 'SetVariable' && a.parameters.scope === 'world')
      .map((a) => a.parameters.var),
  );
  for (const gate of gates) assert.ok(setVars.has(gate.parameters.var), `nothing ever sets ${gate.parameters.var}`);
});

test('order-sequence makes each step require the one before it', () => {
  const form = forms.synthesize({
    model: model(many('event', 8, (i) => ({ order: i, sceneType: 'procedure_step', verb: 'step' }))),
  });
  assert.equal(form.resolution.id, 'order-sequence');

  const bundle = emitter.compile({ build: buildFixture(4), form });
  const collects = bundle.triggers.filter((t) => t.id.endsWith('-collect'));

  assert.equal(collects[0].conditions.filter((c) => c.type === 'VariableEquals').length, 0, 'gated the first step');
  for (let i = 1; i < collects.length; i += 1) {
    const requires = collects[i].conditions.filter((c) => c.type === 'VariableEquals');
    assert.equal(requires.length, 1, `step ${i + 1} is not ordered`);
    const previousSets = (collects[i - 1].actions || []).find((a) => a.type === 'SetVariable');
    assert.equal(requires[0].parameters.var, previousSets.parameters.var, `step ${i + 1} waits on the wrong step`);
  }
});

test('the bundle carries the form it was composed from', () => {
  const form = forms.synthesize({ model: model(many('relationship', 10, (i) => ({ from: `a${i}`, to: `b${i}` }))) });
  const bundle = emitter.compile({ build: buildFixture(), form });

  assert.equal(bundle.form.signature, form.signature);
  assert.ok(bundle.form.rationale.length > 0);
  assert.equal(bundle.validation.contributions.resolutionGates > 0, true);
});

test('two differently shaped sources do not compile to the same game', () => {
  const relational = forms.synthesize({ model: model(many('relationship', 10, (i) => ({ from: `a${i}`, to: `b${i}` }))) });
  const narrative = forms.synthesize({ model: model([...many('item', 3), ...many('hazard', 2, () => ({ gameplayType: 'challenge' }))]) });

  const a = emitter.compile({ build: buildFixture(3), form: relational });
  const b = emitter.compile({ build: buildFixture(3), form: narrative });

  assert.notEqual(a.form.signature, b.form.signature);
  assert.notEqual(a.game.config.gravity.y, b.game.config.gravity.y);
  assert.notDeepEqual(
    entityOf(a, '-player').components.find((c) => c.type === 'InputComponent').bindings,
    entityOf(b, '-player').components.find((c) => c.type === 'InputComponent').bindings,
  );
});
