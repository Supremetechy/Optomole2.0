'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SemanticModelService } = require('../dist/compiler/semantic-model.service');
const { ExperienceDirectiveService } = require('../dist/compiler/experience-directive.service');
const { BehaviorCompilerService } = require('../dist/compiler/behavior-compiler.service');
const { ExperienceBuildService } = require('../dist/compiler/experience-build.service');
const { GameplayDslService } = require('../dist/compiler/gameplay-dsl.service');

/**
 * The 5-stage content-to-experience compiler, end to end:
 *
 *   raw content -> SemanticNode[] -> ExperienceDirective[] -> behaviors -> bundle
 *
 * The claim these guard is the one the whole pipeline exists for: what the user
 * uploaded is what gets played. A generated experience must differ when the
 * source differs, and nothing extracted may vanish silently between stages.
 */

const semanticModel = new SemanticModelService();
const directives = new ExperienceDirectiveService();
const behaviors = new BehaviorCompilerService();
const experienceBuild = new ExperienceBuildService();
const gameplayDsl = new GameplayDslService();

/** A package shaped like one the preprocessing pipeline produces. */
function packageFor({ emotions, arc, locations, hazards }) {
  return {
    id: 'exp-test',
    experience: { id: 'exp-test', title: 'Incident Review' },
    blueprint: {
      proceduralMap: {
        regionName: 'Operations Floor',
        locations: locations.map((name, index) => ({
          id: `loc-${index + 1}`,
          name,
          type: index === 0 ? 'lab' : 'field',
          description: `${name} description`,
          hazards: [],
        })),
      },
      characters: [{ id: 'char-1', name: 'Dana Reyes', role: 'analyst', lines: ['Start with the logs.'] }],
      quests: [{ id: 'quest-1', title: 'Contain the breach', summary: 'Trace and isolate.' }],
    },
    specification: {
      preprocessing: {
        contentSanitization: {
          items: [{ id: 'src-1', title: 'Incident Report', text: 'x'.repeat(400), sourceType: 'text', origin: 'upload.md' }],
        },
        semanticExtraction: {
          people: [{ id: 'p1', text: 'Dana Reyes', sourceId: 'src-1', confidence: 0.8 }],
          places: locations.map((name, index) => ({ id: `pl-${index}`, text: name, sourceId: 'src-1', confidence: 0.7 })),
          actions: [{ id: 'a1', text: 'Isolate the host', verb: 'isolate', sourceId: 'src-1', confidence: 0.7 }],
          learningObjectives: [{ id: 'o1', goalStatement: 'Understand containment', successMetric: 'Isolates the host' }],
          relationships: [{ id: 'r1', from: 'p1', to: 'a1', relation: 'requires', confidence: 0.7 }],
        },
        emotionalIntelligence: {
          emotions: emotions.map((emotion, index) => ({ id: `e${index}`, emotion, score: 10 - index })),
          emotionArc: arc,
        },
        gameplayNormalization: {
          npcs: [{ id: 'npc-1', name: 'Dana Reyes', role: 'Knowledge Mentor', trust: 50, missionId: 'm1' }],
          missions: [{ id: 'm1', title: 'Contain the breach', summary: 'Trace and isolate.', objectives: [], reward: { xp: 150 } }],
          bosses: [{ id: 'boss-1', name: 'Credential Leak', sourceActionId: 'a1', defeatCondition: 'Rotate the keys' }],
          gameplayAtoms: [
            { id: 'atom-1', sourceId: 'a1', sourceKind: 'hazard', label: 'Unrotated keys', gameplayType: 'challenge', salience: 0.8, successCondition: 'rotate them' },
            ...hazards.map((label, index) => ({
              id: `atom-h${index}`, sourceId: 'a1', sourceKind: 'hazard', label, gameplayType: 'challenge', salience: 0.7, successCondition: 'resolve',
            })),
            { id: 'atom-2', sourceId: 'a1', sourceKind: 'concept', label: 'Access Token', gameplayType: 'inventory_item', interactionType: 'collect', salience: 0.6, reward: { xp: 75 } },
          ],
        },
        storyboard: {
          scenes: [
            { id: 'sc-1', order: 0, title: 'The alert fires', sceneType: 'setup', gameplayAtomIds: ['atom-1'] },
            { id: 'sc-2', order: 1, title: 'Tracing the breach', sceneType: 'rising', gameplayAtomIds: ['atom-2'] },
            { id: 'sc-3', order: 2, title: 'Keys rotated', sceneType: 'resolution', gameplayAtomIds: [] },
          ],
        },
        knowledgeGraph: {
          edges: [{ id: 'ed1', from: 'atom-1', to: 'atom-2', relation: 'requires', confidence: 0.8 }],
        },
      },
    },
  };
}

const TENSE = packageFor({
  emotions: ['fear', 'urgency'],
  arc: { beginning: 'fear', middle: 'urgency', end: 'relief', stages: [] },
  locations: ['Server Vault', 'Loading Bay'],
  hazards: ['Stale credentials'],
});

const CALM = packageFor({
  emotions: ['calm', 'trust'],
  arc: { beginning: 'calm', middle: 'trust', end: 'joy', stages: [] },
  locations: ['Reading Room', 'Garden Path'],
  hazards: [],
});

/** Run every stage, the way CompilerController does. */
function compile(pkg) {
  const model = semanticModel.project({ package: pkg, mappingManifest: { bindings: [] } });
  const directiveSet = directives.resolve({ model, package: pkg });
  const compiled = behaviors.compile({ directives: directiveSet, model });
  const build = experienceBuild.project({ package: pkg, mappingManifest: { bindings: [] } });
  const bundle = gameplayDsl.compile({ build, behaviors: compiled });
  return { model, directiveSet, compiled, bundle };
}

// ---- Stage 1 ----

test('semantic extraction folds every preprocessing layer into typed nodes', () => {
  const { model } = compile(TENSE);
  const kinds = model.stats.byKind;

  assert.ok(kinds.actor >= 2, 'the mentor NPC and the boss both became actors');
  assert.equal(kinds.location, 2, 'both map locations became locations');
  assert.equal(kinds.event, 3, 'all three storyboard scenes became events');
  assert.ok(kinds.mood >= 2, 'the emotion arc became ordered mood nodes');
  assert.ok(kinds.hazard >= 2, 'hazard atoms became hazard nodes');
  assert.ok(kinds.item >= 1, 'the collectible atom became an item node');

  const boss = model.semanticNodes.find(n => n.attributes.label === 'Credential Leak');
  assert.ok(boss, 'the boss survived Stage 1');
  assert.equal(boss.attributes.hostile, true, 'a boss is hostile, which is what earns it a combat directive');
  assert.deepEqual(boss.sourceNodeIds, ['a1'], 'provenance points back at the extracted action');
});

test('confidence stays inside its 0-1 contract even when upstream scores do not', () => {
  // knowledge-graph edges carry a gameplay atom's `salience`, which upstream
  // computes as an occurrence count — a real package produced edges scoring 10.
  const noisy = JSON.parse(JSON.stringify(TENSE));
  noisy.specification.preprocessing.knowledgeGraph.edges.push(
    { id: 'ed-count', from: 'atom-1', to: 'atom-2', relation: 'normalizes_to', confidence: 10 },
    { id: 'ed-neg', from: 'atom-2', to: 'atom-1', relation: 'related_to', confidence: -3 }
  );

  const { model } = compile(noisy);
  for (const node of model.semanticNodes) {
    assert.ok(node.confidence >= 0 && node.confidence <= 1, `${node.kind} confidence in range`);
  }
  assert.ok(model.stats.meanConfidence <= 1, 'the reported mean is a real mean, not a count average');
});

test('gameplay atoms shaped like map locations do not become regions', () => {
  // A real upload produced six "locations" that were actually high-salience
  // concepts the compiler promoted, giving one scene per common noun.
  const noisy = JSON.parse(JSON.stringify(TENSE));
  noisy.blueprint.proceduralMap.locations.push(
    { id: 'loc-x', name: 'layer', type: 'quiz', description: '', hazards: [] },
    { id: 'loc-y', name: 'inbox', type: 'inventory_item', description: '', hazards: [] },
    { id: 'loc-z', name: 'signals', type: 'mission_node', description: '', hazards: [] }
  );

  const { model } = compile(noisy);
  const labels = model.semanticNodes.filter(n => n.kind === 'location').map(n => n.attributes.label);
  assert.ok(labels.includes('Server Vault'), 'a real place survives');
  for (const junk of ['layer', 'inbox', 'signals']) {
    assert.ok(!labels.includes(junk), `${junk} is a concept, not a region`);
  }
  assert.match(
    model.coverage.locations.note || '',
    /were gameplay atoms, not places/,
    'the filter reports what it dropped instead of hiding it'
  );
});

test('every semantic layer reports whether it produced anything', () => {
  const { model } = compile(CALM);
  for (const [layer, entry] of Object.entries(model.coverage)) {
    assert.ok(['emitted', 'empty'].includes(entry.status), `${layer} reported a status`);
    if (entry.status === 'empty') assert.ok(entry.note, `${layer} explained why it was empty`);
  }
});

// ---- Stage 2 ----

test('directives are derived from content, not from constants', () => {
  const tense = compile(TENSE).directiveSet;
  const calm = compile(CALM).directiveSet;

  const speedOf = set => set.directives.find(d => d.family === 'movement').parameters.moveSpeed;
  assert.ok(speedOf(tense) > speedOf(calm), 'a tense source produces a quicker player than a calm one');

  const pacingOf = set => set.directives.filter(d => d.family === 'pacing');
  assert.ok(
    pacingOf(tense)[0].parameters.enemySpawnRate > pacingOf(calm)[0].parameters.enemySpawnRate,
    'spawn pressure follows the emotional arc'
  );

  const paletteOf = set => set.directives.find(d => d.family === 'asset').parameters.palette.join();
  assert.notEqual(paletteOf(tense), paletteOf(calm), 'palette is themed by emotional tone');
});

test('the player jumps a height a level can be built around', () => {
  // A raw impulse of ~12 against gravity 9.81 is an 8m jump for a 1.8m
  // character: a playtest had the player sail over every collectible and the
  // exit flag. Jump is derived from an apex height for exactly this reason.
  const GRAVITY = 9.81;
  for (const set of [compile(TENSE).directiveSet, compile(CALM).directiveSet]) {
    const movement = set.directives.find(d => d.family === 'movement').parameters;
    const apex = (movement.jumpForce ** 2) / (2 * GRAVITY);
    assert.ok(apex >= 1.5 && apex <= 4, `apex ${apex.toFixed(2)}m clears a platform without clearing the level`);
    assert.ok(
      Math.abs(apex - movement.jumpApexHeight) < 0.05,
      'the declared apex height is what the impulse actually produces'
    );
  }
});

test('every directive traces back to the semantic nodes it was derived from', () => {
  const { model, directiveSet } = compile(TENSE);
  const nodeIds = new Set(model.semanticNodes.map(n => n.id));
  for (const directive of directiveSet.directives) {
    for (const sourceId of directive.derivedFrom) {
      assert.ok(nodeIds.has(sourceId), `${directive.family} cites a real semantic node`);
    }
  }
});

test('hazards and antagonists both become fightable, and group into squads', () => {
  const { directiveSet } = compile(TENSE);
  const combat = directiveSet.directives.filter(d => d.family === 'combat');
  const squads = directiveSet.directives.filter(d => d.family === 'squad');

  assert.equal(combat.length, 3, 'one boss + two hazards became three enemies');
  assert.ok(squads.length >= 1, 'enemies sharing a region get a coordinator');
  const squad = squads[0];
  assert.ok(squad.parameters.memberTargetIds.length >= 2, 'a squad has at least two members');
  assert.ok(
    squad.parameters.maxConcurrentAttackers <= 3,
    'concurrency is capped so an encounter never dogpiles'
  );
});

// ---- Stage 3 ----

test('combat compiles to a behavior tree that waits for its squad', () => {
  const { compiled } = compile(TENSE);
  const tree = compiled.stateMachines.find(m => m.id.endsWith('_combat_sm'));
  assert.ok(tree, 'a combat machine was compiled');

  const stateIds = tree.states.map(s => s.id);
  for (const required of ['Idle', 'Alert', 'Approaching', 'Holding', 'Telegraphing', 'Attacking']) {
    assert.ok(stateIds.includes(required), `${required} state exists`);
  }

  const denied = tree.transitions.find(t => t.toStateId === 'Holding');
  assert.ok(denied, 'a denied enemy has somewhere to go besides Idle');
  assert.ok(
    denied.conditions.some(c => c.type === 'AttackSlotDenied'),
    'Holding is entered on denial, and denial is all the enemy learns'
  );

  // The invariant that lets one machine drive many entities across scenes.
  const everyAction = tree.states.flatMap(s => [
    ...(s.onEnterActions ?? []),
    ...(s.onUpdateActions ?? []),
  ]);
  assert.ok(
    everyAction.every(a => a.parameters.entityId === undefined),
    'no compiled action hardcodes an entityId'
  );
});

test("an enemy's reach matches the range it commits at", () => {
  // A ranged enemy telegraphs from ~6m. Emitting ApplyAttack without a range
  // left the runtime's melee-sized default in charge, so in a real playtest
  // every ranged enemy attacked empty air, forever, and never landed a hit.
  const { compiled, directiveSet } = compile(TENSE);
  for (const directive of directiveSet.directives.filter(d => d.family === 'combat')) {
    const tree = compiled.stateMachines.find(m => m.id === `${directive.targetId}_combat_sm`);
    const attack = tree.states
      .find(s => s.id === 'Attacking')
      .onEnterActions.find(a => a.type === 'ApplyAttack');
    const engageRange = directive.parameters.preferredRange === 'melee' ? 1.5 : 6;
    assert.ok(
      attack.parameters.range >= engageRange,
      `${directive.parameters.preferredRange} enemy reaches at least as far as it commits`
    );
  }
});

test('scene-scoped triggers declare the scene they belong to', () => {
  // Without this the runtime cannot separate one region's rules from another's,
  // and scene 1 announced every region in the game on load.
  const { bundle } = compile(TENSE);
  const sceneIds = new Set(bundle.scenes.map(s => s.id));
  for (const trigger of bundle.triggers.filter(t => t.scope === 'scene')) {
    assert.ok(trigger.sceneId, `${trigger.id} names its scene`);
    assert.ok(sceneIds.has(trigger.sceneId), `${trigger.id} names a real scene`);
  }
});

test('pacing and squad compile to directors, narrative to a beat graph', () => {
  const { compiled } = compile(TENSE);

  const pacing = compiled.directors.filter(d => d.id.endsWith('_pacing_director'));
  assert.ok(pacing.length >= 1);
  assert.equal(pacing[0].tickIntervalSeconds, 1);
  assert.ok(
    pacing[0].onTickActions.some(a => a.type === 'EvaluateSpawnBudget' && typeof a.parameters.curve === 'string'),
    'the director names a curve; the runtime samples it'
  );
  assert.ok(pacing[0].scheduledActions.some(a => a.repeatEverySeconds > 0), 'breathers are scheduled');

  const squad = compiled.directors.find(d => d.id.endsWith('_squad_director'));
  assert.ok(squad, 'the squad coordinator compiled');
  assert.ok(squad.tickIntervalSeconds < 1, 'arbitration ticks faster than pacing');

  const sequence = compiled.sequences[0];
  assert.ok(sequence, 'narrative compiled to a sequence graph');
  assert.equal(sequence.beats.length, 3, 'one beat per storyboard scene');
  assert.equal(sequence.beats[0].label, 'The alert fires', 'beats carry the source scene title');
});

// ---- Stage 4 input: the emitted bundle ----

test('the bundle places enemies, geometry and props from the compiled plans', () => {
  const { bundle } = compile(TENSE);
  const enemies = bundle.entities.filter(e => e.tags.includes('enemy'));
  const platforms = bundle.entities.filter(e => e.tags.includes('platform'));
  const props = bundle.entities.filter(e => e.tags.includes('prop'));

  assert.equal(enemies.length, 3, 'every compiled enemy was placed');
  assert.ok(platforms.length > 0, 'regions have traversal geometry');
  assert.ok(props.length > 0, 'regions are furnished');
  assert.ok(bundle.assets.length > 0, 'the sprite vocabulary is declared');
  assert.ok(bundle.directors.length > 0 && bundle.sequences.length > 0);
});

test('every state machine, sprite and scene reference in the bundle resolves', () => {
  const { bundle } = compile(TENSE);
  const machineIds = new Set(bundle.stateMachines.map(m => m.id));
  const entityIds = new Set(bundle.entities.map(e => e.id));
  const spriteIds = new Set(bundle.assets.map(a => a.spriteId));

  for (const entity of bundle.entities) {
    const state = entity.components.find(c => c.type === 'StateComponent');
    if (state) assert.ok(machineIds.has(state.stateMachineId), `${entity.id} names a compiled machine`);
    const render = entity.components.find(c => c.type === 'RenderComponent');
    if (render) assert.ok(spriteIds.has(render.spriteId), `${render.spriteId} is a declared asset`);
  }
  for (const scene of bundle.scenes) {
    for (const entityId of scene.entities) assert.ok(entityIds.has(entityId), `${entityId} exists`);
  }
});

test('an enemy the player cannot answer is never emitted', () => {
  const { bundle } = compile(TENSE);
  const scenesWithEnemies = bundle.scenes.filter(scene =>
    scene.entities.some(id => bundle.entities.find(e => e.id === id)?.tags.includes('enemy'))
  );
  assert.ok(scenesWithEnemies.length > 0);
  for (const scene of scenesWithEnemies) {
    const attack = bundle.triggers.find(t => t.id === `${scene.id}-player-attack`);
    assert.ok(attack, `${scene.id} gives the player a way to strike back`);
    assert.ok(attack.actions.some(a => a.type === 'ApplyAttack' && a.parameters.cooldown > 0));
  }
});

test('the emitter still produces a playable bundle without compiled behaviors', () => {
  const build = experienceBuild.project({ package: TENSE, mappingManifest: { bindings: [] } });
  const bundle = gameplayDsl.compile({ build });
  assert.ok(bundle.scenes.length >= 1, 'legacy packages keep working');
  assert.ok(bundle.entities.some(e => e.tags.includes('player')));
  assert.deepEqual(bundle.assets, [], 'no behaviors means no declared vocabulary, not a crash');
});

test('the bundle reports what every stage contributed', () => {
  const { bundle } = compile(TENSE);
  const contributions = bundle.validation.contributions;
  for (const key of ['regions', 'enemies', 'platforms', 'props', 'directors', 'sequenceBeats', 'assets']) {
    assert.equal(typeof contributions[key], 'number', `${key} is counted, so a silent drop is visible`);
  }
});
