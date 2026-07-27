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
            // GameplayNormalizationService alternates hazard atoms between
            // `challenge` (resolved by confronting it) and `branch` (chosen —
            // routed around), so the fixture has to carry both or the
            // environmental-hazard path is never exercised by a real shape.
            { id: 'atom-1', sourceId: 'a1', sourceKind: 'hazard', label: 'Unrotated keys', gameplayType: 'challenge', salience: 0.8, successCondition: 'rotate them' },
            ...hazards.map((label, index) => ({
              id: `atom-h${index}`,
              sourceId: 'a1',
              sourceKind: 'hazard',
              label,
              gameplayType: index % 2 === 0 ? 'branch' : 'challenge',
              salience: 0.7,
              successCondition: 'resolve',
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
  // Two, because normalization alternates their atom type: the first becomes
  // terrain to route around and the second a threat to fight.
  hazards: ['Stale credentials', 'Silent failover'],
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

test("a source's risks split into things to fight and things to route around", () => {
  const { directiveSet, compiled, model } = compile(TENSE);
  const combat = directiveSet.directives.filter(d => d.family === 'combat');
  const hazardNodes = model.semanticNodes.filter(n => n.kind === 'hazard');

  // `challenge` atoms are resolved by confronting them; `branch` atoms are
  // chosen — routed around. Without the split every risk arrived as a monster.
  const environmental = hazardNodes.filter(n => n.attributes.gameplayType === 'branch');
  assert.ok(environmental.length > 0, 'the source named a risk that is terrain, not a body');

  const embodied = new Set(combat.map(d => d.parameters.hazardNodeId).filter(Boolean));
  const placed = new Set(compiled.environments.flatMap(e => e.hazards.map(h => h.nodeId)));
  assert.ok(placed.size > 0, 'and it was placed as environmental danger');
  for (const nodeId of placed) {
    assert.ok(!embodied.has(nodeId), 'no risk is both an enemy and a hazard zone');
  }
});

test('fightable risks and antagonists group into squads', () => {
  const { directiveSet } = compile(TENSE);
  const combat = directiveSet.directives.filter(d => d.family === 'combat');
  const squads = directiveSet.directives.filter(d => d.family === 'squad');

  assert.equal(combat.length, 3, 'one boss + two fightable hazards became three enemies');
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
  const { compiled, directiveSet } = compile(TENSE);
  const closing = directiveSet.directives.find(d => d.family === 'combat' && d.parameters.family !== 'zoning');
  const tree = compiled.stateMachines.find(m => m.id === `${closing.targetId}_combat_sm`);
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
    const strike = tree.states
      .find(s => s.id === 'Attacking')
      .onEnterActions.find(a => a.type === 'ApplyAttack' || a.type === 'FireProjectile');
    const engageRange = directive.parameters.preferredRange === 'melee' ? 1.5 : 6;
    assert.ok(
      strike.parameters.range >= engageRange,
      `${directive.parameters.preferredRange} enemy reaches at least as far as it commits`
    );
  }
});

test('the three enemy families compile to genuinely different trees', () => {
  const { compiled, directiveSet } = compile(TENSE);
  const combat = directiveSet.directives.filter(d => d.family === 'combat');
  const families = new Set(combat.map(d => d.parameters.family));
  assert.ok(families.size > 1, 'one source produces more than one kind of threat');

  const treeFor = key => compiled.stateMachines.find(m => m.id === `${key}_combat_sm`);
  const statesOf = tree => tree.states.map(s => s.id);

  const zoning = combat.find(d => d.parameters.family === 'zoning');
  assert.ok(zoning, 'a ranged threat compiles to the zoning family');
  const zoningTree = treeFor(zoning.targetId);
  assert.ok(statesOf(zoningTree).includes('MaintainDistance'), 'zoning holds a band');
  assert.ok(!statesOf(zoningTree).includes('Approaching'), 'and never closes the gap');
  const standoff = zoningTree.states
    .find(s => s.id === 'MaintainDistance')
    .onUpdateActions.find(a => a.type === 'ApplyStandoffMovement');
  assert.ok(standoff.parameters.minRange < standoff.parameters.maxRange, 'the band has width');
  const shot = zoningTree.states.find(s => s.id === 'Attacking').onEnterActions
    .find(a => a.type === 'FireProjectile');
  assert.ok(shot.parameters.projectileSpeed > 0, 'and it shoots rather than swings');

  const aggressive = combat.find(d => d.parameters.family === 'aggression');
  if (aggressive) {
    const tree = treeFor(aggressive.targetId);
    assert.ok(statesOf(tree).includes('Recovering'), 'an aggression enemy pays for its burst');
    const afterAttack = tree.transitions.find(t => t.fromStateId === 'Attacking');
    assert.equal(afterAttack.toStateId, 'Recovering', 'and is vulnerable straight after it');
  }

  const pressure = combat.find(d => d.parameters.family === 'pressure');
  if (pressure) {
    const tree = treeFor(pressure.targetId);
    assert.ok(statesOf(tree).includes('Approaching'), 'pressure closes');
    assert.ok(!statesOf(tree).includes('Recovering'), 'and never stops to recover');
  }

  // The invariant every family shares.
  for (const directive of combat) {
    const actions = treeFor(directive.targetId).states.flatMap(s => [
      ...(s.onEnterActions ?? []),
      ...(s.onUpdateActions ?? []),
    ]);
    assert.ok(actions.every(a => a.parameters.entityId === undefined),
      `${directive.parameters.family} hardcodes no entityId`);
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

test('a region compiles to a beat plan, and the beats reshape the ground under them', () => {
  const { directiveSet, compiled } = compile(TENSE);

  const pacingDirectives = directiveSet.directives.filter(d => d.family === 'pacing');
  assert.ok(pacingDirectives.every(d => Array.isArray(d.parameters.beats) && d.parameters.beats.length),
    'every region names the beats it plays');

  // region-1 is the tense opening: its curve is a release, so it opens at a peak.
  const opening = pacingDirectives.find(d => d.targetId === 'region-1');
  assert.equal(opening.parameters.beats[0].type, 'peak',
    'the beat sequence follows the tension curve the arc produced');
  assert.ok(opening.parameters.beats.some(b => b.type === 'release'),
    'and it comes back down rather than holding at peak');

  const plan = compiled.environments.find(e => e.regionId === 'region-1');
  const byBeat = new Map(plan.platforms.map(p => [p.beat, p]));
  const peak = byBeat.get('peak');
  const rest = byBeat.get('release') || byBeat.get('calm');
  assert.ok(peak && rest, 'the run is divided across the region\'s beats');

  // The doc's table, made real: calm is wide and flat, peak is narrow, gappy and vertical.
  assert.ok(peak.width < rest.width, 'a peak stands on narrower ledges');
  assert.ok(peak.gapAfter > rest.gapAfter, 'and asks for longer jumps');
  assert.ok(peak.rise > rest.rise, 'and climbs where a rest beat stays flat');

  const director = compiled.directors.find(d => d.id === 'region-1_pacing_director');
  assert.deepEqual(
    director.beats.map(b => b.type),
    opening.parameters.beats.map(b => b.type),
    'the same plan reaches the runtime, so geometry and spawning agree on the beat'
  );
});

test('a beat plan differs when the content differs', () => {
  const tense = compile(TENSE).directiveSet.directives.find(d => d.family === 'pacing' && d.targetId === 'region-1');
  const calm = compile(CALM).directiveSet.directives.find(d => d.family === 'pacing' && d.targetId === 'region-1');

  assert.notDeepEqual(
    tense.parameters.beats.map(b => b.type),
    calm.parameters.beats.map(b => b.type),
    'a source that opens tense and one that opens calm do not play the same beats'
  );
  const peakOf = beats => beats.find(b => b.type === 'peak');
  const tensePeak = peakOf(tense.parameters.beats);
  const calmPeak = peakOf(calm.parameters.beats);
  if (tensePeak && calmPeak) {
    assert.ok(tensePeak.duration > calmPeak.duration, 'pressure stretches the peak it produced');
  }
});

// ---- Stage 2 input: author tags ----

/** The same source, with the author asking for something explicitly. */
const tagged = tags => {
  const pkg = packageFor({
    emotions: ['calm', 'trust'],
    arc: { beginning: 'calm', middle: 'trust', end: 'joy', stages: [] },
    locations: ['Reading Room', 'Garden Path'],
    hazards: [],
  });
  return { ...pkg, experience: { ...pkg.experience, tags } };
};

test('an author tag bends the derivation instead of being ignored', () => {
  const plain = compile(CALM).directiveSet.directives.find(d => d.family === 'movement');
  const floaty = compile(tagged(['floaty'])).directiveSet.directives.find(d => d.family === 'movement');

  assert.ok(floaty.parameters.jumpApexHeight > plain.parameters.jumpApexHeight, 'floaty jumps higher');
  assert.ok(floaty.parameters.airControl > plain.parameters.airControl, 'and steers better in the air');
  assert.ok(floaty.parameters.coyoteTime > plain.parameters.coyoteTime, 'and forgives a late press');
  assert.deepEqual(floaty.parameters.appliedTags, ['floaty'], 'the directive records what steered it');

  // The tag bends the arc; it does not replace it. Provenance survives — node
  // ids are minted per compile, so it is the count of moods that must match.
  assert.equal(floaty.derivedFrom.length, plain.derivedFrom.length, 'the same moods still produced it');
  assert.ok(floaty.derivedFrom.length > 0, 'and it is still traceable to them');
});

test('an unrecognized tag is reported, never silently dropped', () => {
  const { directiveSet } = compile(tagged(['floaty', 'metroidvania']));
  assert.deepEqual(directiveSet.tags.applied, ['floaty']);
  assert.deepEqual(directiveSet.tags.unrecognized, ['metroidvania'],
    'an author who asks for something the compiler cannot do is told so');
});

test('a gravity tag reaches the world the jump was derived through', () => {
  // The failure this guards: apex height is authored and the impulse derived
  // from gravity. If a tag lowers gravity for the player but not for the world,
  // every authored height is wrong and the player sails over the level.
  const { directiveSet, bundle } = compile(tagged(['low_gravity']));
  const movement = directiveSet.directives.find(d => d.family === 'movement');

  assert.ok(movement.parameters.gravityScale < 1, 'the world pulls less');
  const worldGravity = -bundle.game.config.gravity.y;
  assert.ok(Math.abs(worldGravity - 9.81 * movement.parameters.gravityScale) < 0.01,
    'the emitted world runs at the gravity the directive asked for');

  const apex = movement.parameters.jumpForce ** 2 / (2 * worldGravity);
  assert.ok(Math.abs(apex - movement.parameters.jumpApexHeight) < 0.05,
    'and the impulse still lands the player exactly at the authored apex height');
});

test('a family tag re-shapes every enemy the source produced', () => {
  const { directiveSet, compiled } = compile({ ...TENSE, experience: { ...TENSE.experience, tags: ['zoning'] } });
  const combat = directiveSet.directives.filter(d => d.family === 'combat');

  assert.ok(combat.length > 0, 'the source still produces its own threats');
  assert.ok(combat.every(d => d.parameters.family === 'zoning'), 'and the author decided how they fight');
  for (const enemy of compiled.enemies) {
    const tree = compiled.stateMachines.find(m => m.id === enemy.stateMachineId);
    assert.ok(tree.states.some(s => s.id === 'MaintainDistance'), `${enemy.label} holds a band`);
  }
});

test('an untagged package is unaffected by the tag layer', () => {
  const { directiveSet } = compile(CALM);
  assert.deepEqual(directiveSet.tags, { applied: [], unrecognized: [] });
  const movement = directiveSet.directives.find(d => d.family === 'movement');
  assert.equal(movement.parameters.gravityScale, 1, 'nothing was bent');
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

test('a region places its own danger, capped by the budget its layout was sized for', () => {
  const { directiveSet, compiled, bundle } = compile(TENSE);

  for (const plan of compiled.environments) {
    const traversal = directiveSet.directives.find(
      d => d.family === 'traversal' && d.targetId === plan.regionId
    );
    assert.ok(plan.hazards.length <= traversal.parameters.hazardBudget,
      `${plan.regionId} places no more danger than its hazardBudget allows`);
    for (const hazard of plan.hazards) {
      assert.ok(hazard.damage > 0, 'a hazard that costs nothing is scenery');
      assert.ok(['peak', 'build', 'calm', 'release'].includes(hazard.beat), 'it sits on a named beat');
    }
  }

  // A hazard zone is terrain: it damages on contact and is never despawned.
  const zones = bundle.entities.filter(e => e.tags.includes('hazard'));
  assert.ok(zones.length > 0, 'the emitter placed them');
  for (const zone of zones) {
    const trigger = bundle.triggers.find(t => t.id === `${zone.id}-contact`);
    assert.ok(trigger, `${zone.id} costs something to touch`);
    const damage = trigger.actions.find(a => a.type === 'ApplyAttack');
    assert.ok(damage.parameters.cooldown > 0,
      'a cooldown, or standing in a hazard drains the player in one frame');
    assert.ok(!trigger.actions.some(a => a.type === 'DespawnEntity'),
      'terrain is not cleared by walking into it');
  }
  assert.ok(bundle.assets.some(a => a.spriteId === 'hazard_zone'), 'and it has a declared sprite');
});

test('a collectible is placed in the region its content belongs to', () => {
  // These item nodes reached the environment plan and stopped there: the emitter
  // spread inventory round-robin and dropped everything the plans knew about.
  const { compiled, bundle } = compile(TENSE);
  const planned = compiled.environments.flatMap(plan => plan.items);
  assert.ok(planned.length > 0, 'the compiler worked out which region owns which item');

  const collectibles = bundle.entities.filter(e => e.tags.includes('collectible'));
  for (const item of planned) {
    const placed = collectibles.find(e => e.label === item.label);
    assert.ok(placed, `${item.label} was placed rather than dropped`);
    const scene = bundle.scenes.find(s => s.entities.includes(placed.id));
    assert.equal(scene.regionId, compiled.environments.find(p => p.items.includes(item)).regionId,
      'and it was placed in its OWN region, not wherever round-robin landed');
  }

  const labels = collectibles.map(e => String(e.label).toLowerCase());
  assert.equal(new Set(labels).size, labels.length, 'and it was placed exactly once');
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
