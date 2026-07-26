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

export type DirectiveValue = string | number | boolean | string[];

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
}

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

    // Hostile cast = declared antagonists plus one enemy minted per hazard. This
    // is the join that turns "the source warns about X" into something to fight.
    const hostileActors = actors.filter((actor) => actor.attributes.hostile === true);
    const hazardEnemies = hazards.map((hazard, order) => ({ hazard, order }));

    const layers: Array<{ name: string; directives: ExperienceDirective[]; note: string }> = [];

    layers.push({
      name: 'movement',
      directives: [this.movement(moods, input.package || {})],
      note: 'Movement is always emitted.',
    });

    layers.push({
      name: 'traversal',
      directives: regions.map((location, order) => this.traversal(location, order, moods)),
      note: 'No regions to lay out.',
    });

    const combat: ExperienceDirective[] = [];
    hostileActors.forEach((actor, order) => combat.push(this.combatFromActor(actor, order, moods)));
    hazardEnemies.forEach(({ hazard, order }) => combat.push(this.combatFromHazard(hazard, hostileActors.length + order, moods)));
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
      directives: regions.map((location, order) => this.environment(location, order, hazards, items, moods)),
      note: 'No regions to furnish.',
    });

    layers.push({
      name: 'asset',
      directives: this.assets(moods, locations, actors, hazards, items),
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
    };
  }

  // ---- resolvers ----

  /**
   * Mood → movement feel. High pressure makes the player quicker and floatier
   * (escape reads as urgent); a calm arc makes traversal deliberate.
   */
  private movement(moods: SemanticNode[], pkg: Record<string, any>): ExperienceDirective {
    const pressure = this.meanPressure(moods);
    const archetype = String(pkg.experience?.outputExperience || pkg.experience?.genre || 'platformer').toLowerCase();
    // Jump is authored as an apex HEIGHT and converted through world gravity,
    // not picked as a raw impulse. A tuned impulse of ~12 reads fine on paper
    // and lands the player 8m in the air: in a real playtest they sailed over
    // every collectible and the exit flag without touching one. Height is the
    // quantity a level is actually built around, so that is what is chosen here.
    const apexHeight = 2.2 + pressure * 0.8;
    return {
      id: makeId('dir'),
      family: 'movement',
      scope: 'entity',
      targetId: 'player',
      parameters: {
        archetype: /shoot|arcade|survival/.test(archetype) ? 'arcade' : 'platformer',
        moveSpeed: Number((4 + pressure * 3).toFixed(2)),
        jumpApexHeight: Number(apexHeight.toFixed(2)),
        jumpForce: Number(Math.sqrt(2 * WORLD_GRAVITY * apexHeight).toFixed(2)),
        airControl: Number((0.6 + pressure * 0.3).toFixed(2)),
        coyoteTime: Number((0.12 - pressure * 0.05).toFixed(3)),
        gravityScale: 1,
      },
      derivedFrom: moods.map((mood) => mood.id),
      confidence: moods.length ? this.meanConfidence(moods) : 0.5,
    };
  }

  /**
   * Location → level geometry. Interiors get tighter platforms and more gaps;
   * open regions get longer runs. Hazard count widens the danger budget.
   */
  private traversal(location: SemanticNode | null, order: number, moods: SemanticNode[]): ExperienceDirective {
    const interior = location?.attributes.enclosure === 'interior';
    const hazardCount = Number(location?.attributes.hazardCount || 0);
    const pressure = this.meanPressure(moods);
    return {
      id: makeId('dir'),
      family: 'traversal',
      scope: 'region',
      targetId: regionIdOf(order),
      parameters: {
        layout: interior ? 'chambered' : 'open',
        platformCount: interior ? 4 + (order % 3) : 3 + (order % 2),
        gapWidth: Number(((interior ? 1.6 : 2.4) + pressure).toFixed(2)),
        verticality: Number(clamp01(interior ? 0.7 : 0.35).toFixed(2)),
        hazardBudget: Math.min(6, hazardCount + Math.round(pressure * 2)),
        regionName: String(location?.attributes.label || `Region ${order + 1}`),
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
  private combatFromActor(actor: SemanticNode, order: number, moods: SemanticNode[]): ExperienceDirective {
    const threat = clamp01(Number(actor.attributes.threat ?? 0.6));
    const pressure = this.meanPressure(moods);
    const aggression = clamp01(0.35 + threat * 0.4 + pressure * 0.2);
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
        preferredRange: threat > 0.75 ? 'mixed' : order % 2 === 0 ? 'melee' : 'ranged',
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
  private combatFromHazard(hazard: SemanticNode, order: number, moods: SemanticNode[]): ExperienceDirective {
    const severity = clamp01(Number(hazard.attributes.severity ?? 0.6));
    const pressure = this.meanPressure(moods);
    const aggression = clamp01(0.3 + severity * 0.5);
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
        preferredRange: 'melee',
        retreatThreshold: 0,
        groupPressure: Number(clamp01(pressure).toFixed(2)),
        health: Math.round(40 + severity * 60),
        resolution: String(hazard.attributes.successCondition || 'avoid or correct the misconception'),
        bindingId: String(hazard.bindingId || ''),
      },
      derivedFrom: [hazard.id, ...moods.map((mood) => mood.id)],
      confidence: hazard.confidence,
    };
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
        encounterDensity: Number(clamp01(enemyCount / Math.max(1, regionCount * 3)).toFixed(2)),
        breatherInterval: Math.round(45 - pressure * 20),
        tone: String(mood?.attributes.tone || 'neutral'),
      },
      derivedFrom: [mood?.id, location?.id].filter(Boolean) as string[],
      confidence: mood?.confidence ?? 0.6,
    };
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
  private environment(location: SemanticNode | null, order: number, hazards: SemanticNode[], items: SemanticNode[], moods: SemanticNode[]): ExperienceDirective {
    const regionCount = Math.max(1, hazards.length ? hazards.length : 1);
    const mine = <T extends SemanticNode>(nodes: T[]) => nodes.filter((_, index) => index % Math.max(1, regionCount) === order % Math.max(1, regionCount));
    const mood = this.moodForPosition(moods, order, regionCount);
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
  private assets(moods: SemanticNode[], locations: SemanticNode[], actors: SemanticNode[], hazards: SemanticNode[], items: SemanticNode[]): ExperienceDirective[] {
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
