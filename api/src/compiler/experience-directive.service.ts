import { Injectable } from '@nestjs/common';
import { id as makeId } from '../shared/ids';
import { SemanticModel, SemanticNode } from './semantic-model.service';

/**
 * ExperienceDirectiveService — Stage 2 of the content-to-experience compiler.
 *
 * This is the stage the codebase never had. Preprocessing produced meaning and
 * the DSL emitter produced entities, so everything in between — how tense the
 * pacing should be, how aggressive an enemy is, which region gets which props —
 * was hardcoded in the emitter. That is why every generated experience played
 * identically regardless of what the user uploaded.
 *
 * A directive is *parametric design intent*: numbers a template can be built
 * from, derived from semantic attributes, with `derivedFrom` provenance so a
 * designer can trace any number back to the sentence that produced it. No
 * directive knows about sprites, physics, or engines.
 *
 * Families beyond the movement/combat/pacing/narrative set:
 *  - `squad`       one layer above combat, owns groupPressure across members
 *  - `traversal`   movement's shape with level-geometry parameters
 *  - `environment` what a region is built out of (props, hazards, ambience)
 *  - `asset`       the visual vocabulary, so every renderer resolves the same ids
 */

export type DirectiveFamily =
  | 'movement'
  | 'traversal'
  | 'combat'
  | 'squad'
  | 'pacing'
  | 'narrative'
  | 'environment'
  | 'asset';

export type DirectivePrimitive = string | number | boolean;

/**
 * A structured value is allowed because pacing genuinely needs one: a beat is a
 * type, a duration and two scalars that only mean anything together, and
 * flattening it into parallel arrays would let them drift apart.
 */
export type DirectiveValue = DirectivePrimitive | DirectivePrimitive[] | Array<Record<string, DirectivePrimitive>>;

export type LevelBeatType = 'calm' | 'build' | 'peak' | 'release';

/**
 * One moment in a region's pacing. `enemyDensity` is spent at runtime (how
 * crowded the region is allowed to be while this beat plays) and
 * `traversalComplexity` at compile time (how hard the geometry of this stretch
 * is), which is why a beat has to survive as one object into both stages.
 */
export interface LevelBeat {
  type: LevelBeatType;
  duration: number;
  enemyDensity: number;
  traversalComplexity: number;
}

/** What each kind of moment is, before the region's arc scales it. */
const BEAT_SHAPES: Record<LevelBeatType, Omit<LevelBeat, 'type'>> = {
  calm: { duration: 20, enemyDensity: 0.1, traversalComplexity: 0.25 },
  build: { duration: 30, enemyDensity: 0.35, traversalComplexity: 0.5 },
  peak: { duration: 15, enemyDensity: 0.7, traversalComplexity: 0.85 },
  release: { duration: 25, enemyDensity: 0.05, traversalComplexity: 0.2 },
};

/**
 * Which beats a region plays, read off the shape of its tension curve. The
 * curve already encodes where this region sits in the emotional arc, so the
 * beat list is that same judgement made discrete rather than a second guess.
 */
const BEAT_SEQUENCES: Record<string, LevelBeatType[]> = {
  escalating: ['calm', 'build', 'peak'],
  release: ['peak', 'release', 'calm'],
  pulse: ['build', 'peak', 'release', 'peak'],
  steady: ['build', 'peak', 'release'],
};

export interface ExperienceDirective {
  id: string;
  family: DirectiveFamily;
  /** What the compiled behavior attaches to: an entity, a region, or the level. */
  scope: 'entity' | 'region' | 'level';
  /** Stable id of the thing this directive drives (entity id, region id, 'level'). */
  targetId: string;
  parameters: Record<string, DirectiveValue>;
  /** SemanticNode ids — full provenance back through Stage 1 to the source. */
  derivedFrom: string[];
  confidence: number;
}

export interface DirectiveSet {
  schemaVersion: string;
  kind: string;
  experienceId: string;
  directives: ExperienceDirective[];
  coverage: Record<string, { status: 'emitted' | 'empty'; count: number; note?: string }>;
  /**
   * Author-supplied tags this resolve honored, and the ones it did not
   * recognize. A tag that silently did nothing is the failure mode here: an
   * author asks for "floaty" and gets the default arc back with no explanation.
   */
  tags: { applied: string[]; unrecognized: string[] };
}

/**
 * The tag vocabulary. A tag does not replace the derivation — Stage 2 reads the
 * content's own semantics first and a tag then bends the result, so provenance
 * survives and an untagged package is unaffected.
 *
 * `movement` and `traversal` modifiers are multiplicative or additive deltas;
 * `family` overrides which behavior tree an enemy gets.
 */
const TAG_VOCABULARY: Record<string, {
  movement?: Partial<Record<'moveSpeed' | 'jumpApexHeight' | 'airControl' | 'coyoteTime' | 'gravityScale', number>>;
  traversal?: Partial<Record<'verticality' | 'platformCount' | 'gapWidth', number>>;
  family?: 'pressure' | 'aggression' | 'zoning';
  note: string;
}> = {
  floaty: {
    movement: { jumpApexHeight: 1.35, airControl: 1.3, coyoteTime: 1.8 },
    note: 'higher, slower arcs with more forgiveness in the air',
  },
  verticality: {
    movement: { jumpApexHeight: 1.2 },
    traversal: { verticality: 1.6, platformCount: 1.4 },
    note: 'the level is climbed rather than crossed',
  },
  low_gravity: {
    movement: { gravityScale: 0.55, jumpApexHeight: 1.4, airControl: 1.4 },
    note: 'the world itself pulls less',
  },
  exploration: {
    movement: { moveSpeed: 0.9 },
    traversal: { platformCount: 1.5, gapWidth: 0.85 },
    note: 'slower, wider, more to walk through',
  },
  pressure: { family: 'pressure', note: 'enemies grind rather than lunge' },
  aggressive: { family: 'aggression', note: 'enemies burst in and commit' },
  zoning: { family: 'zoning', note: 'enemies hold a band and shoot' },
};

/** Region ids are positional and must match the ones ExperienceBuild emits. */
const regionIdOf = (order: number) => `region-${order + 1}`;

/** Enemies read better in play when their numbers are spread, not identical. */
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Gravity the emitted bundle declares (`game.config.gravity.y`). Jump impulses
 * are derived through it, so a jump is expressed as the height a level can be
 * built around rather than as a magic number.
 */
const WORLD_GRAVITY = 9.81;

@Injectable()
export class ExperienceDirectiveService {
  resolve(input: { model: SemanticModel; package?: Record<string, any> }): DirectiveSet {
    const model = input.model;
    const tags = this.declaredTags(model, input.package || {});
    const applied = tags.filter((tag) => tag in TAG_VOCABULARY);
    const unrecognized = tags.filter((tag) => !(tag in TAG_VOCABULARY));
    const nodes = model.semanticNodes || [];
    const byKind = (kind: SemanticNode['kind']) => nodes.filter((node) => node.kind === kind);

    const moods = byKind('mood');
    const locations = byKind('location');
    const hazards = byKind('hazard');
    const actors = byKind('actor');
    const events = byKind('event');
    const objectives = byKind('objective');
    const relationships = byKind('relationship');
    const items = byKind('item');

    // A region is a location; a contentless build still gets one so every other
    // family has somewhere to attach.
    const regions = locations.length ? locations : [null];

    // Not every risk is a body. Normalization already separates them: a hazard
    // atom typed `challenge` is *resolved* — you confront it — while one typed
    // `branch` is *chosen* — you route around it. So the first becomes an enemy
    // and the second becomes terrain, and no risk is ever both.
    const environmentalHazards = hazards.filter((hazard) => this.isEnvironmental(hazard));
    const fightableHazards = hazards.filter((hazard) => !this.isEnvironmental(hazard));

    // Hostile cast = declared antagonists plus one enemy minted per fightable
    // hazard. This is the join that turns "the source warns about X" into
    // something to fight.
    const hostileActors = actors.filter((actor) => actor.attributes.hostile === true);
    const hazardEnemies = fightableHazards.map((hazard, order) => ({ hazard, order }));

    const layers: Array<{ name: string; directives: ExperienceDirective[]; note: string }> = [];

    layers.push({
      name: 'movement',
      directives: [this.movement(moods, input.package || {}, applied)],
      note: 'Movement is always emitted.',
    });

    layers.push({
      name: 'traversal',
      directives: regions.map((location, order) => this.traversal(location, order, moods, applied)),
      note: 'No regions to lay out.',
    });

    const combat: ExperienceDirective[] = [];
    hostileActors.forEach((actor, order) => combat.push(this.combatFromActor(actor, order, moods, applied)));
    hazardEnemies.forEach(({ hazard, order }) => combat.push(this.combatFromHazard(hazard, hostileActors.length + order, moods, applied)));
    layers.push({ name: 'combat', directives: combat, note: 'No hostile actors or hazards — this experience has nothing to fight.' });

    layers.push({
      name: 'squad',
      directives: this.squads(combat, regions.length, moods),
      note: 'Fewer than two enemies in any region; no coordination needed.',
    });

    layers.push({
      name: 'pacing',
      directives: regions.map((location, order) => this.pacing(location, order, moods, combat.length, regions.length)),
      note: 'No regions to pace.',
    });

    layers.push({
      name: 'narrative',
      directives: events.length || objectives.length ? [this.narrative(events, objectives, relationships, moods)] : [],
      note: 'No events or objectives — nothing to sequence into beats.',
    });

    layers.push({
      name: 'environment',
      directives: regions.map((location, order) =>
        this.environment(location, order, regions.length, environmentalHazards, items, moods)),
      note: 'No regions to furnish.',
    });

    layers.push({
      name: 'asset',
      directives: this.assets(moods, locations, actors, hazards, environmentalHazards, items),
      note: 'No visual vocabulary could be derived.',
    });

    const coverage: DirectiveSet['coverage'] = {};
    const directives: ExperienceDirective[] = [];
    for (const layer of layers) {
      coverage[layer.name] = layer.directives.length
        ? { status: 'emitted', count: layer.directives.length }
        : { status: 'empty', count: 0, note: layer.note };
      directives.push(...layer.directives);
    }

    return {
      schemaVersion: '1.0.0',
      kind: 'optomole.DirectiveSet',
      experienceId: model.experienceId,
      directives,
      coverage,
      tags: { applied, unrecognized },
    };
  }

  /**
   * Every place an author can put a tag, normalized. Content hints are included
   * because a tag written into an uploaded file's metadata is the same
   * instruction as one typed into the form — it should not matter which door it
   * came through.
   */
  private declaredTags(model: SemanticModel, pkg: Record<string, any>): string[] {
    const raw: unknown[] = [
      ...this.tagList(pkg.tags),
      ...this.tagList(pkg.experience?.tags),
      ...this.tagList(pkg.blueprint?.tags),
      ...(model.contentNodes || []).flatMap((node) => this.tagList(node.hints?.tags)),
    ];
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const value of raw) {
      const tag = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      tags.push(tag);
    }
    return tags;
  }

  /** Tags arrive as an array or as a comma-separated string, depending on the door. */
  private tagList(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string' || typeof entry === 'number').map(String);
    if (typeof value === 'string') return value.split(',');
    return [];
  }

  /** The strongest tag-declared family, if the author named one at all. */
  private taggedFamily(tags: string[]): 'pressure' | 'aggression' | 'zoning' | null {
    for (const tag of tags) {
      const family = TAG_VOCABULARY[tag]?.family;
      if (family) return family;
    }
    return null;
  }

  // ---- resolvers ----

  /**
   * Mood → movement feel. High pressure makes the player quicker and floatier
   * (escape reads as urgent); a calm arc makes traversal deliberate.
   */
  private movement(moods: SemanticNode[], pkg: Record<string, any>, tags: string[]): ExperienceDirective {
    const pressure = this.meanPressure(moods);
    const archetype = String(pkg.experience?.outputExperience || pkg.experience?.genre || 'platformer').toLowerCase();
    // Jump is authored as an apex HEIGHT and converted through world gravity,
    // not picked as a raw impulse. A tuned impulse of ~12 reads fine on paper
    // and lands the player 8m in the air: in a real playtest they sailed over
    // every collectible and the exit flag without touching one. Height is the
    // quantity a level is actually built around, so that is what is chosen here.
    const feel = {
      moveSpeed: 4 + pressure * 3,
      jumpApexHeight: 2.2 + pressure * 0.8,
      airControl: 0.6 + pressure * 0.3,
      coyoteTime: 0.12 - pressure * 0.05,
      gravityScale: 1,
    };
    for (const tag of tags) {
      const modifiers = TAG_VOCABULARY[tag]?.movement;
      if (!modifiers) continue;
      for (const [key, factor] of Object.entries(modifiers)) {
        feel[key as keyof typeof feel] *= factor;
      }
    }
    // Apex height is the authored quantity; the impulse is DERIVED from it
    // through the gravity the world will actually run at. A tag that changes
    // gravity therefore has to flow through here, or "low_gravity" would mean a
    // floatier world the player's legs never learned about.
    const gravity = WORLD_GRAVITY * feel.gravityScale;
    return {
      id: makeId('dir'),
      family: 'movement',
      scope: 'entity',
      targetId: 'player',
      parameters: {
        archetype: /shoot|arcade|survival/.test(archetype) ? 'arcade' : 'platformer',
        moveSpeed: Number(feel.moveSpeed.toFixed(2)),
        jumpApexHeight: Number(feel.jumpApexHeight.toFixed(2)),
        jumpForce: Number(Math.sqrt(2 * gravity * feel.jumpApexHeight).toFixed(2)),
        airControl: Number(clamp01(feel.airControl).toFixed(2)),
        coyoteTime: Number(feel.coyoteTime.toFixed(3)),
        gravityScale: Number(feel.gravityScale.toFixed(2)),
        appliedTags: tags.filter((tag) => TAG_VOCABULARY[tag]?.movement),
      },
      derivedFrom: moods.map((mood) => mood.id),
      confidence: moods.length ? this.meanConfidence(moods) : 0.5,
    };
  }

  /**
   * Location → level geometry. Interiors get tighter platforms and more gaps;
   * open regions get longer runs. Hazard count widens the danger budget.
   */
  private traversal(location: SemanticNode | null, order: number, moods: SemanticNode[], tags: string[]): ExperienceDirective {
    const interior = location?.attributes.enclosure === 'interior';
    const hazardCount = Number(location?.attributes.hazardCount || 0);
    const pressure = this.meanPressure(moods);
    const shape = {
      platformCount: interior ? 4 + (order % 3) : 3 + (order % 2),
      gapWidth: (interior ? 1.6 : 2.4) + pressure,
      verticality: interior ? 0.7 : 0.35,
    };
    for (const tag of tags) {
      const modifiers = TAG_VOCABULARY[tag]?.traversal;
      if (!modifiers) continue;
      for (const [key, factor] of Object.entries(modifiers)) {
        shape[key as keyof typeof shape] *= factor;
      }
    }
    return {
      id: makeId('dir'),
      family: 'traversal',
      scope: 'region',
      targetId: regionIdOf(order),
      parameters: {
        layout: interior ? 'chambered' : 'open',
        platformCount: Math.max(1, Math.round(shape.platformCount)),
        gapWidth: Number(shape.gapWidth.toFixed(2)),
        verticality: Number(clamp01(shape.verticality).toFixed(2)),
        hazardBudget: Math.min(6, hazardCount + Math.round(pressure * 2)),
        regionName: String(location?.attributes.label || `Region ${order + 1}`),
        appliedTags: tags.filter((tag) => TAG_VOCABULARY[tag]?.traversal),
      },
      derivedFrom: [location?.id, ...moods.map((mood) => mood.id)].filter(Boolean) as string[],
      confidence: location?.confidence ?? 0.5,
    };
  }

  /**
   * Actor → combat feel. Declared threat drives aggression; the mood arc sets
   * how much telegraph the player gets, so a tense source produces enemies that
   * commit faster rather than enemies that simply hit harder.
   */
  private combatFromActor(actor: SemanticNode, order: number, moods: SemanticNode[], tags: string[]): ExperienceDirective {
    const threat = clamp01(Number(actor.attributes.threat ?? 0.6));
    const pressure = this.meanPressure(moods);
    const aggression = clamp01(0.35 + threat * 0.4 + pressure * 0.2);
    const range = this.taggedFamily(tags) === 'zoning'
      ? 'ranged'
      : threat > 0.75 ? 'mixed' : order % 2 === 0 ? 'melee' : 'ranged';
    return {
      id: makeId('dir'),
      family: 'combat',
      scope: 'entity',
      targetId: `enemy-${order + 1}`,
      parameters: {
        label: String(actor.attributes.label || `Enemy ${order + 1}`),
        archetype: String(actor.attributes.archetype || 'enemy'),
        aggression: Number(aggression.toFixed(2)),
        reactionTime: Number((0.9 - pressure * 0.5).toFixed(2)),
        attackWindup: Number((0.8 - aggression * 0.35).toFixed(2)),
        attackCooldown: Number((1.6 - aggression * 0.6).toFixed(2)),
        preferredRange: range,
        family: this.taggedFamily(tags) || this.combatFamily(range, aggression),
        retreatThreshold: threat > 0.8 ? 0 : Number((0.25 - pressure * 0.1).toFixed(2)),
        groupPressure: Number(clamp01(pressure + 0.15).toFixed(2)),
        health: Math.round(60 + threat * 90),
        bindingId: String(actor.bindingId || ''),
      },
      derivedFrom: [actor.id, ...moods.map((mood) => mood.id)],
      confidence: actor.confidence,
    };
  }

  /**
   * Hazard → combat. A risk named in the source becomes an entity the player
   * has to handle, with severity driving how hard it presses.
   */
  private combatFromHazard(hazard: SemanticNode, order: number, moods: SemanticNode[], tags: string[]): ExperienceDirective {
    const severity = clamp01(Number(hazard.attributes.severity ?? 0.6));
    const pressure = this.meanPressure(moods);
    const aggression = clamp01(0.3 + severity * 0.5);
    const range = this.taggedFamily(tags) === 'zoning' ? 'ranged' : order % 2 === 0 ? 'melee' : 'ranged';
    return {
      id: makeId('dir'),
      family: 'combat',
      scope: 'entity',
      targetId: `enemy-${order + 1}`,
      parameters: {
        label: String(hazard.attributes.label || `Hazard ${order + 1}`),
        archetype: 'hazard',
        aggression: Number(aggression.toFixed(2)),
        reactionTime: Number((1.1 - severity * 0.5).toFixed(2)),
        attackWindup: Number((0.9 - severity * 0.3).toFixed(2)),
        attackCooldown: Number((1.8 - severity * 0.5).toFixed(2)),
        // Hazards alternate the same way antagonists do. They were pinned to
        // melee, which meant an encounter built entirely out of a source's risks
        // had exactly one texture — and made the zoning family unreachable from
        // real content, since every boss scores high enough to be `mixed`.
        preferredRange: range,
        family: this.taggedFamily(tags) || this.combatFamily(range, aggression),
        retreatThreshold: 0,
        groupPressure: Number(clamp01(pressure).toFixed(2)),
        health: Math.round(40 + severity * 60),
        resolution: String(hazard.attributes.successCondition || 'avoid or correct the misconception'),
        bindingId: String(hazard.bindingId || ''),
        // Which semantic hazard this enemy embodies. The environment compiler
        // reads it so a region does not ALSO place the same risk as scenery —
        // one hazard is either something you fight or something you avoid.
        hazardNodeId: hazard.id,
      },
      derivedFrom: [hazard.id, ...moods.map((mood) => mood.id)],
      confidence: hazard.confidence,
    };
  }

  /**
   * Whether a risk is terrain rather than a body. `branch` atoms are *chosen*
   * (interactionType `choose`) — a fork in the route — where `challenge` atoms
   * are *resolved* by confronting them. Nothing else in the pipeline draws this
   * line, so a source's risks would otherwise all arrive as identical monsters.
   */
  private isEnvironmental(hazard: SemanticNode): boolean {
    const type = String(hazard.attributes.gameplayType || 'challenge').toLowerCase();
    return type === 'branch' || type === 'avoidance_challenge';
  }

  /**
   * Which of the three enemy families this directive belongs to. The family is
   * not a fourth set of numbers — it selects the SHAPE of the behavior tree, and
   * the numbers already resolved fill it in:
   *
   *   pressure    closes and stays closed; relentless rather than fast
   *   aggression  bursts in, commits hard, and is vulnerable while it recovers
   *   zoning      holds a band and attacks from it; punishes the approach
   *
   * Range decides zoning because a ranged attacker that closes is just a slow
   * melee enemy; aggression decides the rest because that is what separates a
   * threat that lunges from one that grinds.
   */
  private combatFamily(preferredRange: string, aggression: number): 'pressure' | 'aggression' | 'zoning' {
    if (preferredRange === 'ranged') return 'zoning';
    return aggression >= 0.65 ? 'aggression' : 'pressure';
  }

  /**
   * Enemies are dealt round-robin across regions (the same distribution the DSL
   * emitter uses), so a squad is every enemy that shares a region. Aggregate
   * groupPressure is the mean of its members' — one number the coordinator gates
   * concurrency with.
   */
  private squads(combat: ExperienceDirective[], regionCount: number, moods: SemanticNode[]): ExperienceDirective[] {
    if (combat.length < 2) return [];
    const buckets: ExperienceDirective[][] = Array.from({ length: Math.max(1, regionCount) }, () => []);
    combat.forEach((directive, index) => buckets[index % buckets.length].push(directive));

    return buckets
      .map((members, order) => ({ members, order }))
      .filter((bucket) => bucket.members.length >= 2)
      .map(({ members, order }) => {
        const groupPressure = clamp01(
          members.reduce((total, member) => total + Number(member.parameters.groupPressure || 0), 0) / members.length,
        );
        return {
          id: makeId('dir'),
          family: 'squad' as const,
          scope: 'region' as const,
          targetId: regionIdOf(order),
          parameters: {
            memberTargetIds: members.map((member) => member.targetId),
            groupPressure: Number(groupPressure.toFixed(2)),
            // A polite queue at low pressure, a mob at high — but never the
            // whole squad at once, which reads as unfair rather than intense.
            maxConcurrentAttackers: Math.max(1, Math.min(3, Math.round(members.length * groupPressure))),
            flankBias: Number(clamp01(0.3 + this.meanPressure(moods) * 0.5).toFixed(2)),
            callOutDelay: Number((1.2 - groupPressure * 0.7).toFixed(2)),
          },
          derivedFrom: members.flatMap((member) => member.derivedFrom),
          confidence: this.mean(members.map((member) => member.confidence)),
        };
      });
  }

  /**
   * Mood → pacing, per region. The arc is sampled positionally: an early region
   * uses the beginning mood, the last uses the end mood, so a source that builds
   * to a resolution produces a level that does too.
   */
  private pacing(location: SemanticNode | null, order: number, moods: SemanticNode[], enemyCount: number, regionCount: number): ExperienceDirective {
    const mood = this.moodForPosition(moods, order, regionCount);
    const pressure = mood ? Number(mood.attributes.pressure ?? 0.5) : this.meanPressure(moods);
    const curve = this.tensionCurve(moods, order, regionCount);
    const encounterDensity = clamp01(enemyCount / Math.max(1, regionCount * 3));
    return {
      id: makeId('dir'),
      family: 'pacing',
      scope: 'region',
      targetId: regionIdOf(order),
      parameters: {
        tensionCurve: curve,
        // The reference formula: baseline 2/min, up to 6/min under full pressure.
        enemySpawnRate: Number((2 + pressure * 4).toFixed(2)),
        musicIntensity: Number(pressure.toFixed(2)),
        encounterDensity: Number(encounterDensity.toFixed(2)),
        breatherInterval: Math.round(45 - pressure * 20),
        tone: String(mood?.attributes.tone || 'neutral'),
        beats: this.beats(curve, pressure, encounterDensity),
      },
      derivedFrom: [mood?.id, location?.id].filter(Boolean) as string[],
      confidence: mood?.confidence ?? 0.6,
    };
  }

  /**
   * The region's beats. A tension curve says how pressure moves; a beat list
   * says what the player is doing while it moves, and it is the only place the
   * two halves of pacing meet: `enemyDensity` is spent by the runtime as the
   * beat plays, `traversalComplexity` by the environment compiler as geometry.
   *
   * Pressure sharpens the arc rather than shifting it: a tense region's peaks
   * run longer and its lulls shorter, but a calm beat is still a calm beat.
   */
  private beats(curve: string, pressure: number, encounterDensity: number): Array<Record<string, DirectivePrimitive>> {
    const sequence = BEAT_SEQUENCES[curve] || BEAT_SEQUENCES.steady;
    return sequence.map((type) => {
      const shape = BEAT_SHAPES[type];
      const stretch = type === 'peak' ? 1 + pressure * 0.5 : 1 - pressure * 0.3;
      return {
        type,
        duration: Math.max(6, Math.round(shape.duration * stretch)),
        enemyDensity: Number(clamp01(shape.enemyDensity + encounterDensity * 0.4).toFixed(2)),
        traversalComplexity: Number(clamp01(shape.traversalComplexity * (0.85 + pressure * 0.3)).toFixed(2)),
      };
    });
  }

  /**
   * Events + objectives → one narrative program. Gating relationships become the
   * beats that cannot be skipped, which is what stops a branching experience
   * from letting the player reach a payoff before its setup.
   */
  private narrative(events: SemanticNode[], objectives: SemanticNode[], relationships: SemanticNode[], moods: SemanticNode[]): ExperienceDirective {
    const gatingCount = relationships.filter((relationship) => relationship.attributes.gating === true).length;
    const branchTolerance = clamp01(1 - gatingCount / Math.max(3, relationships.length || 3));
    const pressure = this.meanPressure(moods);
    const beatSources = events.length ? events : objectives;
    return {
      id: makeId('dir'),
      family: 'narrative',
      scope: 'level',
      targetId: 'level',
      parameters: {
        pacing: pressure > 0.7 ? 'punchy' : gatingCount > 2 ? 'twist_heavy' : 'slow_burn',
        beatDensity: Math.max(1, Math.round(beatSources.length / 3)),
        branchTolerance: Number(branchTolerance.toFixed(2)),
        // Required beats are the ones a gating relationship points at, plus the
        // opening beat — an experience always has to start where it starts.
        requiredBeatIds: [
          ...(beatSources[0] ? [beatSources[0].id] : []),
          ...relationships
            .filter((relationship) => relationship.attributes.gating === true)
            .map((relationship) => String(relationship.attributes.to))
            .filter((to) => beatSources.some((beat) => beat.originId === to || beat.id === to)),
        ],
        beatNodeIds: beatSources.map((beat) => beat.id),
        objectiveNodeIds: objectives.map((objective) => objective.id),
      },
      derivedFrom: [...beatSources.map((beat) => beat.id), ...objectives.map((objective) => objective.id)],
      confidence: this.mean([...beatSources, ...objectives].map((node) => node.confidence)) || 0.6,
    };
  }

  /**
   * Location → what the region is actually built out of. Hazards and items are
   * dealt round-robin so nothing extracted from the source ends up unplaced —
   * the silent-drop failure mode this pipeline is built to avoid.
   */
  private environment(location: SemanticNode | null, order: number, regionCount: number, hazards: SemanticNode[], items: SemanticNode[], moods: SemanticNode[]): ExperienceDirective {
    // Deal round-robin across the REGIONS. This was dividing by the hazard count
    // instead, so with more regions than hazards two regions claimed the same
    // node and the same risk was placed twice.
    const regions = Math.max(1, regionCount);
    const mine = <T extends SemanticNode>(nodes: T[]) => nodes.filter((_, index) => index % regions === order % regions);
    const mood = this.moodForPosition(moods, order, regions);
    const interior = location?.attributes.enclosure === 'interior';
    return {
      id: makeId('dir'),
      family: 'environment',
      scope: 'region',
      targetId: regionIdOf(order),
      parameters: {
        regionName: String(location?.attributes.label || `Region ${order + 1}`),
        description: String(location?.attributes.description || ''),
        locationType: String(location?.attributes.type || 'mission_node'),
        enclosure: interior ? 'interior' : 'exterior',
        palette: this.paletteFor(String(mood?.attributes.tone || 'neutral'), interior),
        ambientIntensity: Number((mood ? Number(mood.attributes.pressure ?? 0.5) : 0.5).toFixed(2)),
        propKinds: interior ? ['console', 'crate', 'door'] : ['pillar', 'crate', 'beacon'],
        propCount: interior ? 4 : 3,
        hazardNodeIds: mine(hazards).map((hazard) => hazard.id),
        itemNodeIds: mine(items).map((item) => item.id),
      },
      derivedFrom: [location?.id, mood?.id].filter(Boolean) as string[],
      confidence: location?.confidence ?? 0.5,
    };
  }

  /**
   * The visual vocabulary. Every sprite id an emitter can reference is declared
   * once here with a shape/size/palette spec, so the placeholder-art generator,
   * the Pixi renderer, and any future exporter resolve the same id to the same
   * thing instead of each inventing its own.
   */
  private assets(moods: SemanticNode[], locations: SemanticNode[], actors: SemanticNode[], hazards: SemanticNode[], environmentalHazards: SemanticNode[], items: SemanticNode[]): ExperienceDirective[] {
    const tone = String(this.dominantMood(moods)?.attributes.tone || 'neutral');
    const palette = this.paletteFor(tone, false);
    const specs: Array<{ spriteId: string; shape: string; width: number; height: number; role: string; tint: string }> = [
      { spriteId: 'player_idle', shape: 'capsule', width: 0.8, height: 1.8, role: 'player', tint: palette[0] },
      { spriteId: 'ground_tile', shape: 'box', width: 1, height: 1, role: 'terrain', tint: palette[1] },
      { spriteId: 'platform_tile', shape: 'box', width: 1, height: 0.4, role: 'terrain', tint: palette[1] },
      { spriteId: 'collectible', shape: 'diamond', width: 0.6, height: 0.6, role: 'item', tint: palette[2] },
      { spriteId: 'npc', shape: 'capsule', width: 0.8, height: 1.8, role: 'npc', tint: palette[3] },
      { spriteId: 'goal_flag', shape: 'box', width: 1, height: 2, role: 'goal', tint: palette[2] },
      { spriteId: 'prop', shape: 'box', width: 0.9, height: 0.9, role: 'prop', tint: palette[1] },
    ];
    if (environmentalHazards.length) {
      // Environmental danger is its own thing on screen: a risk the player must
      // route around, not a body that chases them.
      specs.push({ spriteId: 'hazard_zone', shape: 'box', width: 1.5, height: 0.6, role: 'hazard', tint: palette[2] });
    }
    if (hazards.length || actors.some((actor) => actor.attributes.hostile === true)) {
      specs.push(
        { spriteId: 'enemy_idle', shape: 'capsule', width: 0.9, height: 1.7, role: 'enemy', tint: palette[4] },
        { spriteId: 'enemy_attack_windup', shape: 'capsule', width: 1, height: 1.7, role: 'enemy', tint: palette[2] },
        { spriteId: 'enemy_circle', shape: 'capsule', width: 0.9, height: 1.7, role: 'enemy', tint: palette[4] },
      );
    }

    return specs.map((spec) => ({
      id: makeId('dir'),
      family: 'asset' as const,
      scope: 'level' as const,
      targetId: spec.spriteId,
      parameters: { ...spec, palette, tone, source: items.length || locations.length ? 'derived' : 'default' },
      derivedFrom: moods.map((mood) => mood.id),
      confidence: 0.9,
    }));
  }

  // ---- shared derivations ----

  /** Palette by emotional tone — the same mapping every region and asset uses. */
  private paletteFor(tone: string, interior: boolean): string[] {
    const key = tone.toLowerCase();
    if (/fear|anger|anxiety|tension|urgency|alarm|panic|stress/.test(key)) {
      return interior ? ['#f2f2f2', '#2b1216', '#ff4d4d', '#ffb347', '#c81d25'] : ['#ffffff', '#3a1720', '#ff5c5c', '#ffb347', '#e63946'];
    }
    if (/joy|trust|relief|calm|hope|confidence|pride|satisfaction/.test(key)) {
      return interior ? ['#ffffff', '#123326', '#7ef7a0', '#8fd3ff', '#4cc38a'] : ['#ffffff', '#0f2f3a', '#7ef7ff', '#a0ffcf', '#4cc38a'];
    }
    if (/sad|grief|loss|regret/.test(key)) {
      return ['#e8ecf5', '#16202e', '#7aa2ff', '#9aa8c7', '#4b6a9b'];
    }
    return interior ? ['#ffffff', '#1b1b24', '#ffd166', '#8fd3ff', '#a06cd5'] : ['#ffffff', '#141b2d', '#ffd166', '#8fd3ff', '#a06cd5'];
  }

  /** The arc mood at a given position through the experience. */
  private moodForPosition(moods: SemanticNode[], order: number, regionCount: number): SemanticNode | null {
    const staged = moods
      .filter((mood) => mood.attributes.stage !== 'overall')
      .sort((a, b) => Number(a.attributes.order || 0) - Number(b.attributes.order || 0));
    if (!staged.length) return this.dominantMood(moods);
    const position = regionCount <= 1 ? 0 : order / (regionCount - 1);
    const index = Math.min(staged.length - 1, Math.round(position * (staged.length - 1)));
    return staged[index];
  }

  private dominantMood(moods: SemanticNode[]): SemanticNode | null {
    return moods
      .slice()
      .sort((a, b) => Number(b.attributes.weight || 0) - Number(a.attributes.weight || 0))[0] || null;
  }

  /**
   * Curve shape from where this region sits in the arc: rising pressure ahead
   * means escalating, falling means release, equal means steady. `pulse` is used
   * when the arc oscillates, which reads as repeated encounters rather than a ramp.
   */
  private tensionCurve(moods: SemanticNode[], order: number, regionCount: number): string {
    const here = Number(this.moodForPosition(moods, order, regionCount)?.attributes.pressure ?? 0.5);
    const next = Number(this.moodForPosition(moods, Math.min(regionCount - 1, order + 1), regionCount)?.attributes.pressure ?? here);
    const previous = Number(this.moodForPosition(moods, Math.max(0, order - 1), regionCount)?.attributes.pressure ?? here);
    if (next > here + 0.1) return 'escalating';
    if (next < here - 0.1) return 'release';
    if (previous < here - 0.1 && next < here - 0.1) return 'pulse';
    return here > 0.7 ? 'escalating' : 'steady';
  }

  private meanPressure(moods: SemanticNode[]): number {
    if (!moods.length) return 0.5;
    return clamp01(this.mean(moods.map((mood) => Number(mood.attributes.pressure ?? 0.5))));
  }

  private meanConfidence(nodes: SemanticNode[]): number {
    return this.mean(nodes.map((node) => node.confidence));
  }

  private mean(values: number[]): number {
    if (!values.length) return 0;
    return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3));
  }
}
