'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { StoryboardService } = require('../dist/preprocessing/storyboard.service');
const { KnowledgeGraphService } = require('../dist/preprocessing/knowledge-graph.service');

/**
 * The storyboard decides how many beats an experience has.
 *
 * It selects the SHORTEST path from an anchor node to the goal, which is two to
 * four nodes by construction, then attached a fixed three branches. On a real
 * document that produced an eight-node trajectory out of a 102-node graph,
 * segmented into a single scene: everything the extractor found was discarded
 * at the last step and the narrative layer compiled to one beat.
 */

const storyboard = new StoryboardService();
const knowledgeGraph = new KnowledgeGraphService();

/**
 * A graph shaped like a real one: a goal, a chain of concepts leading to it,
 * and side material hanging off the chain.
 */
function graphOf({ concepts = 30, mistakes = 2, impacts = 4 } = {}) {
  const nodes = [
    { id: 'goal-1', type: 'learning_objective', layer: 'semantic', label: 'Understand the system', properties: { salience: 0.9 } },
  ];
  const edges = [];
  const edge = (from, to, relation = 'related_to') => edges.push({
    id: `e-${edges.length}`, from, to, relation, layer: 'semantic', confidence: 0.7,
  });

  for (let i = 0; i < concepts; i += 1) {
    nodes.push({ id: `c-${i}`, type: 'concept', layer: 'semantic', label: `Concept ${i}`, properties: { salience: 0.5 } });
    if (i > 0) edge(`c-${i - 1}`, `c-${i}`);
  }
  // Several concepts reach the goal, so there are many competing anchors.
  for (let i = 0; i < concepts; i += 3) edge(`c-${i}`, 'goal-1');

  for (let i = 0; i < mistakes; i += 1) {
    nodes.push({ id: `m-${i}`, type: 'common_mistake', layer: 'semantic', label: `Mistake ${i}`, properties: { salience: 0.6 } });
    edge(`c-${i * 2}`, `m-${i}`);
  }
  for (let i = 0; i < impacts; i += 1) {
    nodes.push({
      id: `i-${i}`, type: 'impact', layer: 'semantic', label: `Impact ${i}`,
      properties: { salience: 0.6, polarity: i % 2 ? 'negative-or-mitigating' : 'positive-or-causal' },
    });
    edge(`c-${i + 1}`, `i-${i}`, 'produces_impact');
  }
  return { nodes, edges };
}

// ---- the regression ----

test('a graph with material in it produces a multi-beat narrative, not one scene', () => {
  const result = storyboard.build({ knowledgeGraph: graphOf({ concepts: 30 }) });

  assert.ok(result.scenes.length > 1, `expected several scenes, got ${result.scenes.length}`);
  assert.ok(
    result.selectedPath.nodeIds.length > 8,
    `the trajectory should cover more than a shortest path (got ${result.selectedPath.nodeIds.length})`
  );
});

test('a document-sized graph carries a full arc', () => {
  // The real failure was a 102-node graph collapsing to one scene, so the
  // claim is stated at that scale rather than on a toy fixture.
  const result = storyboard.build({ knowledgeGraph: graphOf({ concepts: 100, mistakes: 4, impacts: 8 }) });

  assert.ok(result.scenes.length >= 5, `expected a real arc, got ${result.scenes.length} scenes`);
  const types = result.scenes.map(scene => scene.sceneType);
  assert.ok(new Set(types).size > 1, `the arc should not be one note: ${types.join(', ')}`);
});

test('the narrative scales with the material, and stays bounded', () => {
  const small = storyboard.build({ knowledgeGraph: graphOf({ concepts: 6, mistakes: 0, impacts: 0 }) });
  const large = storyboard.build({ knowledgeGraph: graphOf({ concepts: 300, mistakes: 10, impacts: 20 }) });

  assert.ok(small.scenes.length >= 1, 'a thin source still yields something playable');
  assert.ok(large.scenes.length > small.scenes.length, 'more material means more beats');
  assert.ok(large.scenes.length <= 10, `an arc is not a slog (got ${large.scenes.length} scenes)`);
});

test('every scene references nodes that actually exist', () => {
  const graph = graphOf();
  const result = storyboard.build({ knowledgeGraph: graph });
  const ids = new Set(graph.nodes.map(node => node.id));

  for (const scene of result.scenes) {
    for (const nodeId of scene.nodeIds) {
      assert.ok(ids.has(nodeId), `scene ${scene.order} references missing node ${nodeId}`);
    }
    assert.ok(scene.title, `scene ${scene.order} has a title`);
  }
});

test('scenes are ordered, contiguous, and connected by transitions', () => {
  const result = storyboard.build({ knowledgeGraph: graphOf() });

  result.scenes.forEach((scene, index) => assert.equal(scene.order, index, 'scene order is dense'));
  assert.equal(result.transitions.length, result.scenes.length - 1, 'one transition between each pair');
  assert.equal(result.scenes[0].sceneType, 'briefing', 'the arc opens on a briefing');
  assert.equal(result.scenes[result.scenes.length - 1].sceneType, 'resolution', 'and closes on a resolution');
});

test('no node is visited twice in the trajectory', () => {
  const result = storyboard.build({ knowledgeGraph: graphOf() });
  const seen = new Set(result.selectedPath.nodeIds);
  assert.equal(seen.size, result.selectedPath.nodeIds.length, 'the walk does not repeat itself');
});

test('an explicit maxBranches still caps the weave', () => {
  const capped = storyboard.build({ knowledgeGraph: graphOf(), maxBranches: 0 });
  const open = storyboard.build({ knowledgeGraph: graphOf() });
  assert.ok(
    capped.selectedPath.nodeIds.length < open.selectedPath.nodeIds.length,
    'a caller asking for no branches gets the bare primary path'
  );
});

test('each path is reported once, under its own kind', () => {
  const result = storyboard.build({ knowledgeGraph: graphOf() });
  const signatures = result.narrativePaths.map(path => `${path.kind}:${path.nodeIds.join(',')}`);
  assert.equal(new Set(signatures).size, signatures.length, 'weaving a path must not also duplicate its record');
});

// ---- impacts are graph citizens ----

test('impacts become nodes, so consequence edges do not dangle', () => {
  // semanticEdges has always emitted `produces_impact` edges pointing at these
  // ids; without nodes for them the storyboard reported "references unknown
  // node impact_…" thirteen times on a real document.
  const semantic = {
    learningObjectives: [{ id: 'o1', goalStatement: 'Understand containment' }],
    concepts: [{ id: 'c1', text: 'containment', salience: 0.6 }],
    actions: [{ id: 'a1', text: 'Isolate the host', label: 'the host', verb: 'isolate' }],
    impacts: [
      { id: 'imp1', statement: 'Isolation reduces blast radius.', label: 'blast radius', polarity: 'negative-or-mitigating' },
      { id: 'imp2', statement: 'Rotation restores trust.', label: 'restored trust', polarity: 'positive-or-causal' },
    ],
    relationships: [
      { id: 'r1', type: 'impact', from: 'a1', to: 'imp1', relation: 'produces_impact', confidence: 0.7 },
      { id: 'r2', type: 'impact', from: 'c1', to: 'imp2', relation: 'produces_impact', confidence: 0.7 },
    ],
  };

  const graph = knowledgeGraph.build({ semanticExtraction: semantic, gameplayNormalization: {}, storyboard: {} });
  const impactNodes = graph.nodes.filter(node => node.type === 'impact');
  assert.equal(impactNodes.length, 2, 'both impacts became nodes');
  assert.equal(impactNodes[0].label, 'blast radius', 'the node carries the readable label, not the whole statement');

  const ids = new Set(graph.nodes.map(node => node.id));
  const dangling = graph.edges.filter(e => !ids.has(e.from) || !ids.has(e.to));
  assert.deepEqual(dangling, [], 'no edge points at a node that does not exist');
});

test('tension follows adverse consequences, not just explicit mistakes', () => {
  // A source that states its risks as outcomes ("this leads to duplicated
  // scoring") rather than as warnings left every scene flat.
  const result = storyboard.build({ knowledgeGraph: graphOf({ concepts: 30, mistakes: 4, impacts: 10 }) });
  const tensions = new Set(result.scenes.map(scene => scene.tension));
  assert.ok(tensions.size > 1, `the arc should vary, got ${[...tensions]}`);
});

test('an empty graph is reported, not crashed through', () => {
  const result = storyboard.build({ knowledgeGraph: { nodes: [], edges: [] } });
  assert.equal(result.scenes.length, 0);
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.issues[0], 'it says why');
});
