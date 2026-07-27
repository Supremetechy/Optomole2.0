import { Injectable } from '@nestjs/common';
import { id as makeId } from '../shared/ids';
import { AssetSpec, CompiledBehaviors, EnvironmentPlan } from './behavior-compiler.service';
import { ExperienceBuild } from './experience-build.service';
import { ExperienceForm, LayoutId } from './form-synthesis.service';

/**
 * GameplayDslService — projects an ExperienceBuild (the engine-neutral
 * component set) into a Gameplay DSL bundle: the pure-data game format the
 * RuntimeCore + EngineAdapter prototype plays (see /Phaser and /game).
 *
 * This is the join between the two engine tracks: templates in browser-engine/
 * interpret components with genre code, while this emitter compiles them into
 * declarative entities, state machines, and triggers that ANY adapter
 * (Phaser, Pixi, Unity…) can run without genre code.
 *
 * It inherits the ExperienceBuild invariants:
 *  1. CONTENT LIVES ONCE — entities carry `bindingId` references back to the
 *     mapping manifest's bindings; display names use short labels only.
 *  2. DROPS ARE VISIBLE — `validation` counts what each component contributed,
 *     so a region or quest that produced no gameplay is recorded, not silent.
 */

export interface GameplayDslBundle {
  schemaVersion: string;
  kind: string;
  experienceId: string;
  game: Record<string, unknown>;
  scenes: Array<Record<string, unknown>>;
  entities: Array<Record<string, unknown>>;
  stateMachines: Array<Record<string, unknown>>;
  triggers: Array<Record<string, unknown>>;
  /** Tick-driven programs: pacing per region, squad coordination per region. */
  directors: Array<Record<string, unknown>>;
  /** Beat-ordered narrative graphs, world-scoped. */
  sequences: Array<Record<string, unknown>>;
  /** The sprite vocabulary this bundle references, declared once. */
  assets: AssetSpec[];
  /** The synthesized form this bundle was composed from, with its provenance. */
  form: {
    signature: string;
    topology: ExperienceForm['topology'];
    verbs: ExperienceForm['verbs'];
    resolution: ExperienceForm['resolution'];
    rationale: string[];
    confidence: number | null;
  };
  validation: {
    sceneCount: number;
    entityCount: number;
    triggerCount: number;
    /** Completion gates no trigger ever satisfies — must be empty to be winnable. */
    unsatisfiableGates: string[];
    contributions: Record<string, number>;
  };
}

/** World-space layout constants (DSL units are meters, y-up). */
const WORLD_GRAVITY = 9.81;
const ITEM_SPACING = 3;
const FIRST_ITEM_X = 4;
const GROUND_MARGIN = 4;

/** The form assumed when a caller compiles without one — the historical shape. */
const DEFAULT_FORM: Pick<ExperienceForm, 'topology' | 'verbs' | 'inputBindings' | 'resolution' | 'signature'> = {
  topology: { id: 'side-scroll', layout: 'linear', gravity: true, span: ITEM_SPACING },
  verbs: ['traverse', 'leap', 'collect'],
  inputBindings: [
    { action: 'MoveLeft', keys: ['A', 'LeftArrow'] },
    { action: 'MoveRight', keys: ['D', 'RightArrow'] },
    { action: 'Jump', keys: ['Space', 'W', 'UpArrow'] },
    { action: 'Attack', keys: ['J', 'F'] },
  ],
  resolution: { id: 'reach-goal', parameters: {} },
  signature: 'side-scroll/traverse+leap+collect/reach-goal',
};

interface Placement { x: number; y: number }

/**
 * Where the nth of `count` placements sits, per layout. This is the whole of
 * what "topology" means geometrically — every other difference between forms
 * (gravity, verbs, win condition) is decided elsewhere and lands here as a
 * coordinate. Positions are world units, y-up, with the player's start at the
 * layout's natural entrance.
 */
function placementAt(layout: LayoutId, index: number, count: number, span: number): Placement {
  switch (layout) {
    // A run: everything ahead of you, in the order it was compiled.
    case 'linear':
      return { x: FIRST_ITEM_X + index * span, y: 1.5 };

    // A lane: the same left-to-right order, but flat — the challenge is the
    // sequence, not the jumping, so nothing is elevated out of reach.
    case 'lane':
      return { x: FIRST_ITEM_X + index * span, y: 0 };

    // A room: content around the walls, so crossing the room is what reaches it
    // and the middle stays open to move through.
    case 'perimeter': {
      const perSide = Math.max(1, Math.ceil(count / 4));
      const side = Math.min(3, Math.floor(index / perSide));
      const along = (index % perSide) / perSide - 0.5 + 0.5 / perSide;
      const offset = along * span * 2;
      if (side === 0) return { x: offset, y: span };
      if (side === 1) return { x: span, y: -offset };
      if (side === 2) return { x: -offset, y: -span };
      return { x: -span, y: offset };
    }

    // A map: nodes on a ring around the centre the player starts from, so every
    // one is an equal, deliberate trip rather than something passed on the way.
    case 'radial': {
      const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
      return { x: round2(Math.cos(angle) * span), y: round2(Math.sin(angle) * span) };
    }

    // A board: rows and columns, read like the table it came from.
    case 'grid': {
      const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
      const column = index % columns;
      const row = Math.floor(index / columns);
      const half = (columns - 1) / 2;
      return { x: round2((column - half) * span), y: round2((half - row) * span) };
    }

    default:
      return { x: FIRST_ITEM_X + index * span, y: 1.5 };
  }
}

/** Where the player enters a layout. */
function playerStart(layout: LayoutId): Placement {
  if (layout === 'radial') return { x: 0, y: -2 };
  if (layout === 'grid') return { x: 0, y: 0 };
  if (layout === 'perimeter') return { x: 0, y: 0 };
  if (layout === 'lane') return { x: 0, y: 0 };
  return { x: 0, y: 2 };
}

/**
 * Where completion sits. A run ends past the last thing in it; a map or a board
 * ends where the player started, which is what makes "go back and finish" the
 * shape of the ending rather than "keep walking right".
 */
function goalPlacement(layout: LayoutId, count: number, span: number): Placement {
  if (layout === 'radial' || layout === 'grid' || layout === 'perimeter') return { x: 0, y: 0 };
  return { x: FIRST_ITEM_X + count * span + ITEM_SPACING, y: layout === 'lane' ? 0 : 2 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How many compiled bundles stay fetchable by id. Oldest are evicted. */
const BUNDLE_CACHE_SIZE = 20;

@Injectable()
export class GameplayDslService {
  /**
   * Compiled bundles held so a runtime can fetch one by URL (`?bundle=`)
   * instead of being handed the JSON inline. In-memory and capped — a bundle
   * is a projection, always re-derivable from its package.
   */
  private readonly bundles = new Map<string, GameplayDslBundle>();

  /** Cache a bundle for retrieval by id; returns the id to fetch it with. */
  remember(bundle: GameplayDslBundle): string {
    const bundleId = makeId('dsl');
    this.bundles.set(bundleId, bundle);
    while (this.bundles.size > BUNDLE_CACHE_SIZE) {
      const oldest = this.bundles.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.bundles.delete(oldest);
    }
    return bundleId;
  }

  recall(bundleId: string): GameplayDslBundle | null {
    return this.bundles.get(bundleId) || null;
  }

  /**
   * `behaviors` is the Stage 3 output. When it is absent the emitter still
   * produces a playable bundle from the component set alone (the original
   * behavior), so a package compiled before the directive pipeline existed
   * keeps working. When it is present, every number the player feels —
   * movement speed, enemy aggression, region geometry, palette — comes from the
   * user's content rather than from constants in this file.
   */
  compile(input: { build: ExperienceBuild; behaviors?: CompiledBehaviors; form?: ExperienceForm }): GameplayDslBundle {
    const build = input.build;
    const behaviors = input.behaviors;
    // Stage 2.5's answer to "what kind of game is this". Absent for callers
    // predating form synthesis, which keeps compiling the side-scroller.
    const form = input.form || (DEFAULT_FORM as ExperienceForm);
    const layout = form.topology.layout;
    const gravity = form.topology.gravity;
    const span = form.topology.span;
    const resolution = form.resolution.id;
    const components = (build.components || {}) as Record<string, any>;
    const world = components.world || {};
    const regions: any[] = Array.isArray(world.regions) ? world.regions : [];
    const items: any[] = Array.isArray(components.inventory?.items) ? components.inventory.items : [];
    const characters: any[] = Array.isArray(components.cast?.characters) ? components.cast.characters : [];
    const environments: EnvironmentPlan[] = behaviors?.environments || [];
    const enemyPlans = behaviors?.enemies || [];

    const scenes: Array<Record<string, unknown>> = [];
    const entities: Array<Record<string, unknown>> = [];
    const triggers: Array<Record<string, unknown>> = [];
    // Reported in `validation`: a planar form drops the compiled platform run,
    // and a gated resolution has to be visible as a count or an unwinnable
    // scene looks identical to a scene nobody gated.
    let skippedPlatforms = 0;
    let gatedScenes = 0;
    let gateCount = 0;

    // An enemy the player cannot answer is a wall, not an encounter — and that
    // invariant outranks the form. If Stage 3 compiled enemies but Stage 2.5
    // read the content as non-combative, the strike is added back rather than
    // dropped: the two stages disagreeing must not produce an unplayable scene.
    const bindings = enemyPlans.length && !form.inputBindings.some((binding) => binding.action === 'Attack')
      ? [...form.inputBindings, { action: 'Attack', keys: ['J', 'F'] }]
      : form.inputBindings;

    // One playable scene per region; a contentless build still gets one scene.
    // Environment plans win when present because they carry geometry and palette
    // the component-set regions do not.
    const sceneSources: Array<{ id: string; name: string; description: string; plan?: EnvironmentPlan }> = environments.length
      ? environments.map((plan) => ({ id: plan.regionId, name: plan.regionName, description: plan.description, plan }))
      : regions.length
        ? regions.map((region: any, index: number) => ({
          id: String(region.id || `region-${index + 1}`),
          name: String(region.name || `Region ${index + 1}`),
          description: String(region.description || ''),
        }))
        : [{
          id: 'region-1',
          name: String(world.identity?.title || 'Experience'),
          description: String(world.identity?.description || ''),
        }];

    // Distribute collectibles, cast, and enemies across scenes round-robin so
    // every region has something to do and nothing compiled is dropped. Enemies
    // use the same index rule the directive resolver used to form squads, so an
    // enemy lands in the region whose squad coordinator arbitrates it.
    const perScene = sceneSources.map(() => ({ items: [] as any[], characters: [] as any[], enemies: [] as any[] }));

    // A region's own item nodes are placed in that region — the compiler already
    // worked out which location each collectible belongs to, and round-robin
    // would throw that away. Anything the plans do not claim still falls back to
    // the even spread, so nothing compiled is dropped.
    const planItemLabels = new Set(
      environments.flatMap((plan) => plan.items.map((item) => item.label.toLowerCase())),
    );
    sceneSources.forEach((region, index) => {
      for (const item of region.plan?.items || []) {
        perScene[index].items.push({ name: item.label, bindingId: item.bindingId, xp: item.xp, nodeId: item.nodeId });
      }
    });
    const unplacedItems = items.filter((item) => !planItemLabels.has(String(item.name || '').toLowerCase()));
    unplacedItems.forEach((item, i) => perScene[i % perScene.length].items.push(item));
    characters.forEach((character, i) => perScene[i % perScene.length].characters.push(character));
    enemyPlans.forEach((enemy, i) => perScene[i % perScene.length].enemies.push(enemy));

    sceneSources.forEach((region, sceneIndex) => {
      const sceneId = `scene-${sceneIndex + 1}`;
      const plan = region.plan;
      const assigned = perScene[sceneIndex];
      const placed = [
        ...assigned.items.map((item) => ({ kind: 'item', source: item })),
        ...assigned.characters.map((character) => ({ kind: 'npc', source: character })),
        ...assigned.enemies.map((enemy) => ({ kind: 'enemy', source: enemy })),
      ];

      const goalSpot = goalPlacement(layout, placed.length, span);
      const groundWidth = goalSpot.x + GROUND_MARGIN;

      const sceneEntityIds: string[] = [];
      const addEntity = (entity: Record<string, unknown>) => {
        entities.push(entity);
        sceneEntityIds.push(String(entity.id));
      };

      addEntity(this.playerEntity(sceneId, behaviors?.playerVariables, form, bindings));
      // Only a world that pulls needs a floor to stop the fall. A planar form
      // has no down, so a ground plane would be a wall the player stands on
      // from above — visible, collidable, and meaningless.
      if (gravity) addEntity(this.groundEntity(sceneId, groundWidth));

      // Region geometry: platforms laid across the run, props as scenery. Both
      // come from the region's traversal/environment directives. Platforms are
      // traversal *under gravity* — in a planar form there is nothing to climb,
      // so the traversal budget is spent on layout span instead of on ledges.
      if (gravity) {
        (plan?.platforms || []).forEach((platform, order) => {
          const x = FIRST_ITEM_X + order * (platform.width + platform.gapAfter);
          if (x > groundWidth) return;
          addEntity(this.platformEntity(sceneId, platform, order, x));
        });
      } else {
        skippedPlatforms += plan?.platforms?.length || 0;
      }
      (plan?.props || []).forEach((prop, order) => {
        const spot = placementAt(layout, order, Math.max(1, plan?.props?.length || 1), span * 1.35);
        addEntity(this.propEntity(sceneId, prop, order, spot.x, gravity ? undefined : spot.y));
      });

      // Environmental danger: risks the source named that are not walking around
      // as enemies here. Placed across the space the player has to cross, so
      // traversing the region is what exposes them to it.
      (plan?.hazards || []).forEach((hazard, order) => {
        const spot = placementAt(layout, order * 2, Math.max(2, (plan?.hazards?.length || 1) * 2), span);
        const entity = this.hazardEntity(sceneId, hazard, order, spot.x, gravity ? undefined : spot.y);
        addEntity(entity);
        triggers.push(this.hazardContactTrigger(sceneId, entity, hazard));
      });

      // The content entities the resolution counts. Order matters for
      // `order-sequence`, where each one gates the next.
      const gateVars: string[] = [];

      placed.forEach((placement, order) => {
        const spot = placementAt(layout, order, placed.length, span);
        const y = gravity ? undefined : spot.y;
        if (placement.kind === 'item') {
          const entity = this.itemEntity(sceneId, placement.source, order, spot.x, y);
          addEntity(entity);
          const gateVar = `${entity.id}_done`;
          const requires = resolution === 'order-sequence' ? gateVars[gateVars.length - 1] : undefined;
          triggers.push(this.collectTrigger(sceneId, entity, placement.source, { gateVar, requires, resolution }));
          if (resolution !== 'reach-goal') gateVars.push(gateVar);
        } else if (placement.kind === 'npc') {
          const entity = this.npcEntity(sceneId, placement.source, order, spot.x, y);
          addEntity(entity);
          // In a map, the cast ARE nodes: meeting one is walking an edge, so it
          // counts toward connect-all the way an item counts toward collect-all.
          const gateVar = `${entity.id}_done`;
          const counts = resolution === 'connect-all';
          triggers.push(this.dialogueTrigger(sceneId, entity, placement.source, counts ? gateVar : undefined));
          if (counts) gateVars.push(gateVar);
        } else {
          const entity = this.enemyEntity(sceneId, placement.source, order, spot.x, y);
          addEntity(entity);
          triggers.push(this.enemyContactTrigger(sceneId, entity, placement.source));
        }
      });

      const goal = this.goalEntity(sceneId, goalSpot.x, gravity ? undefined : goalSpot.y);
      addEntity(goal);

      // An enemy the player cannot answer is a wall, not an encounter. One
      // input-driven strike, cooldown-gated by the runtime, closes the loop.
      if (assigned.enemies.length) triggers.push(this.playerAttackTrigger(sceneId));

      const isLast = sceneIndex === sceneSources.length - 1;
      const nextSceneId = isLast ? null : `scene-${sceneIndex + 2}`;
      triggers.push(this.sceneStartTrigger(sceneId, region, form, gateVars.length));
      triggers.push(this.goalTrigger(sceneId, goal, nextSceneId, gateVars));
      gatedScenes += gateVars.length ? 1 : 0;
      gateCount += gateVars.length;

      scenes.push({
        id: sceneId,
        name: region.name,
        regionId: region.id || null,
        systems: assigned.enemies.length ? ['physics', 'input', 'combat'] : ['physics', 'input'],
        entities: sceneEntityIds,
        entryTriggers: [`${sceneId}-start`],
        exitTriggers: [`${sceneId}-goal`],
        // Region-scoped presentation and programs, so the runtime never has to
        // re-derive theme or pacing from the content.
        palette: plan?.palette || [],
        ambientIntensity: plan?.ambientIntensity ?? 0.5,
        directors: (behaviors?.directors || [])
          .filter((director) => director.scope === 'region' && director.targetId === region.id)
          .map((director) => director.id),
      });
    });

    // Playability: a composed form can fail in a way a fixed template never
    // could — by gating completion on a variable nothing ever sets, which reads
    // as a finished game right up until the player cannot finish it. Every gate
    // the goal requires must have a writer somewhere in the bundle. This is
    // checked here rather than left to tests because the forms are generated:
    // the combination that breaks it has by definition never been seen before.
    const written = new Set(
      triggers
        .flatMap((trigger) => (trigger.actions as Array<Record<string, any>>) || [])
        .filter((action) => action?.type === 'SetVariable' && action?.parameters?.scope === 'world')
        .map((action) => String(action.parameters.var)),
    );
    const unsatisfiableGates = triggers
      .filter((trigger) => String(trigger.id).endsWith('-goal'))
      .flatMap((trigger) => (trigger.conditions as Array<Record<string, any>>) || [])
      .filter((condition) => condition?.type === 'VariableEquals' && condition?.parameters?.scope === 'world')
      .map((condition) => String(condition.parameters.var))
      .filter((gateVar) => !written.has(gateVar));

    // The player machine is compiled from the movement directive when present;
    // the built-in side-scroller machine remains the fallback.
    const gravityScale = Number(behaviors?.playerVariables?.gravityScale) || 1;
    const playerMachine = (behaviors?.stateMachines || []).find((machine) => machine.id === 'player_state_machine');
    const combatMachines = (behaviors?.stateMachines || []).filter((machine) => machine.id !== 'player_state_machine');
    const stateMachines: Array<Record<string, unknown>> = [
      (playerMachine as unknown as Record<string, unknown>) || this.playerStateMachine(gravity),
      ...(combatMachines as unknown as Array<Record<string, unknown>>),
    ];

    return {
      schemaVersion: '1.0.0',
      kind: 'optomole.GameplayDslBundle',
      experienceId: build.experienceId,
      game: {
        id: build.experienceId,
        title: String(world.identity?.title || 'Optomole Experience'),
        version: '1.0.0',
        // Gravity is the movement directive's, because the player's jump impulse
        // was derived through it. A `low_gravity` experience whose world still
        // pulled at 9.81 would launch the player over everything they were meant
        // to land on — the exact bug apex-height authoring exists to prevent.
        // A planar form has no down at all: the topology, not the directive,
        // decides whether there is a direction things fall in.
        config: {
          gravity: { x: 0, y: gravity ? -WORLD_GRAVITY * gravityScale : 0, z: 0 },
          pixelPerUnit: 100,
        },
        scenes: scenes.map((scene) => String(scene.id)),
        globalSystems: enemyPlans.length ? ['physics', 'input', 'ui', 'combat'] : ['physics', 'input', 'ui'],
      },
      scenes,
      entities,
      stateMachines,
      triggers,
      directors: (behaviors?.directors || []) as unknown as Array<Record<string, unknown>>,
      sequences: (behaviors?.sequences || []) as unknown as Array<Record<string, unknown>>,
      assets: behaviors?.assets || [],
      // The form this bundle was composed from, carried on the bundle so a
      // runtime, a reviewer, or a person asking "why is my upload a map?" can
      // read the decision and its provenance without re-running the compiler.
      form: {
        signature: form.signature,
        topology: form.topology,
        verbs: form.verbs,
        resolution: form.resolution,
        rationale: form.rationale || [],
        confidence: form.confidence ?? null,
      },
      validation: {
        sceneCount: scenes.length,
        entityCount: entities.length,
        triggerCount: triggers.length,
        /** Completion gates with no writer. Non-empty means an unwinnable form. */
        unsatisfiableGates,
        contributions: {
          regions: sceneSources.length,
          inventoryItems: items.length,
          castCharacters: characters.length,
          enemies: enemyPlans.length,
          platforms: environments.reduce((total, plan) => total + plan.platforms.length, 0),
          props: environments.reduce((total, plan) => total + plan.props.length, 0),
          placedHazards: environments.reduce((total, plan) => total + plan.hazards.length, 0),
          regionItems: environments.reduce((total, plan) => total + plan.items.length, 0),
          directors: behaviors?.directors.length || 0,
          pacingBeats: (behaviors?.directors || []).reduce((total, director) => total + (director.beats?.length || 0), 0),
          sequenceBeats: (behaviors?.sequences || []).reduce((total, sequence) => total + sequence.beats.length, 0),
          assets: behaviors?.assets.length || 0,
          // Form-driven outcomes. `skippedPlatforms` is the compiled traversal
          // geometry a planar topology had no use for — a real drop, reported
          // rather than silently absent. `resolutionGates` is how many things
          // the player must do before completion is even possible.
          skippedPlatforms,
          gatedScenes,
          resolutionGates: gateCount,
        },
      },
    };
  }

  // ---- entity builders ----

  /**
   * The player. Both the control scheme and the starting position come from the
   * form: a planar map hands them four directions and drops them at its centre,
   * a side-scroller hands them two and a jump and starts them at the left edge.
   * This is the one entity where "what kind of game is this" is felt directly.
   */
  private playerEntity(
    sceneId: string,
    variables: Record<string, number | boolean> | undefined,
    form: ExperienceForm,
    bindings: ExperienceForm['inputBindings'],
  ) {
    const start = playerStart(form.topology.layout);
    return {
      id: `${sceneId}-player`,
      archetype: 'hero',
      tags: ['player', 'controllable'],
      components: [
        { type: 'TransformComponent', position: { x: start.x, y: start.y, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: 'player_idle', layer: 'characters' },
        {
          type: 'PhysicsComponent',
          bodyType: 'dynamic',
          mass: 1,
          colliderShape: { type: 'box', width: 0.8, height: 1.8 },
          collisionTags: ['ground', 'collectible', 'npc', 'goal'],
        },
        { type: 'InputComponent', bindings },
        {
          type: 'StateComponent',
          stateMachineId: 'player_state_machine',
          initialState: 'Idle',
          variables: variables || { isGrounded: true, moveSpeed: 5, jumpForce: 12 },
        },
      ],
    };
  }

  /**
   * A platform run from the region's traversal directive. Collider dimensions
   * are BASE units — the transform scale stretches one tile definition, so a
   * wide platform is never a second declared size that can drift.
   */
  private platformEntity(sceneId: string, platform: { id: string; width: number; height: number; rise: number; beat?: string }, order: number, x: number) {
    return {
      id: `${sceneId}-platform-${order + 1}`,
      archetype: 'platform',
      tags: ['ground', 'platform'],
      // Which pacing beat shaped this stretch, so a level's difficulty curve is
      // readable off the emitted bundle rather than only in the plan behind it.
      beat: platform.beat || null,
      components: [
        {
          type: 'TransformComponent',
          position: { x, y: 1.5 + platform.rise, z: 0 },
          scale: { x: platform.width, y: platform.height, z: 1 },
        },
        { type: 'RenderComponent', spriteId: 'platform_tile', layer: 'terrain' },
        {
          type: 'PhysicsComponent',
          bodyType: 'static',
          colliderShape: { type: 'box', width: 1, height: 1 },
          collisionTags: ['player'],
        },
      ],
    };
  }

  /** Scenery from the environment plan. Props are decoration, not obstacles. */
  private propEntity(sceneId: string, prop: { kind: string; spriteId: string; width: number; height: number }, order: number, x: number, y?: number) {
    return {
      id: `${sceneId}-prop-${order + 1}`,
      archetype: 'prop',
      tags: ['prop', 'scenery'],
      label: prop.kind,
      components: [
        { type: 'TransformComponent', position: { x, y: y ?? 1, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: prop.spriteId, layer: 'background' },
      ],
    };
  }

  /**
   * An enemy compiled from a combat directive: its own behavior tree instance,
   * its own compiled numbers, and its squad membership so the region's
   * coordinator can arbitrate it.
   */
  private enemyEntity(sceneId: string, enemy: any, order: number, x: number, y?: number) {
    return {
      id: `${sceneId}-enemy-${order + 1}`,
      archetype: String(enemy.archetype || 'enemy'),
      tags: ['enemy', 'hostile', ...(enemy.squadId ? [`squad:${enemy.squadId}`] : [])],
      bindingId: enemy.bindingId || null,
      label: String(enemy.label || `Enemy ${order + 1}`),
      family: String(enemy.family || 'pressure'),
      squadId: enemy.squadId || null,
      components: [
        { type: 'TransformComponent', position: { x, y: y ?? 1.85, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: String(enemy.spriteId || 'enemy_idle'), layer: 'characters' },
        {
          type: 'PhysicsComponent',
          bodyType: 'dynamic',
          mass: 1,
          colliderShape: { type: 'box', width: 0.9, height: 1.7 },
          collisionTags: ['ground', 'player'],
        },
        {
          type: 'StateComponent',
          stateMachineId: String(enemy.stateMachineId),
          initialState: 'Idle',
          variables: enemy.variables || {},
        },
      ],
    };
  }

  /**
   * A hazard zone: static, damaging, and routed around rather than fought. Its
   * collider is a base 1×1 box stretched by the transform, the same rule every
   * other stretched entity follows.
   */
  private hazardEntity(sceneId: string, hazard: { id: string; label: string; spriteId: string; width: number; height: number; bindingId: string | null; beat: string }, order: number, x: number, y?: number) {
    return {
      id: `${sceneId}-hazard-${order + 1}`,
      archetype: 'hazard',
      tags: ['hazard'],
      bindingId: hazard.bindingId || null,
      label: hazard.label,
      beat: hazard.beat,
      components: [
        {
          type: 'TransformComponent',
          position: { x, y: y ?? 0.8, z: 0 },
          scale: { x: hazard.width, y: hazard.height, z: 1 },
        },
        { type: 'RenderComponent', spriteId: hazard.spriteId || 'hazard_zone', layer: 'foreground' },
        {
          type: 'PhysicsComponent',
          bodyType: 'static',
          colliderShape: { type: 'box', width: 1, height: 1 },
          collisionTags: ['player'],
        },
      ],
    };
  }

  private groundEntity(sceneId: string, width: number) {
    return {
      id: `${sceneId}-ground`,
      archetype: 'platform',
      tags: ['ground'],
      components: [
        { type: 'TransformComponent', position: { x: width / 2 - 2, y: 0, z: 0 }, scale: { x: width, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: 'ground_tile', layer: 'terrain' },
        {
          type: 'PhysicsComponent',
          bodyType: 'static',
          colliderShape: { type: 'box', width: 1, height: 1 },
          collisionTags: ['player'],
        },
      ],
    };
  }

  private itemEntity(sceneId: string, item: any, order: number, x: number, y?: number) {
    return {
      id: `${sceneId}-item-${order + 1}`,
      archetype: 'collectible',
      tags: ['collectible'],
      bindingId: item.bindingId || null,
      label: String(item.name || `Item ${order + 1}`),
      components: [
        { type: 'TransformComponent', position: { x, y: y ?? 1.5, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: 'collectible', layer: 'foreground' },
        {
          type: 'PhysicsComponent',
          bodyType: 'static',
          colliderShape: { type: 'box', width: 0.6, height: 0.6 },
          collisionTags: ['player'],
        },
      ],
    };
  }

  private npcEntity(sceneId: string, character: any, order: number, x: number, y?: number) {
    return {
      id: `${sceneId}-npc-${order + 1}`,
      archetype: 'npc',
      tags: ['npc'],
      bindingId: character.bindingId || null,
      label: String(character.name || `Guide ${order + 1}`),
      components: [
        { type: 'TransformComponent', position: { x, y: y ?? 1.9, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: 'npc', layer: 'characters' },
        {
          type: 'PhysicsComponent',
          bodyType: 'static',
          colliderShape: { type: 'box', width: 0.8, height: 1.8 },
          collisionTags: ['player'],
        },
      ],
    };
  }

  private goalEntity(sceneId: string, x: number, y?: number) {
    return {
      id: `${sceneId}-goal`,
      archetype: 'goal',
      tags: ['goal'],
      components: [
        { type: 'TransformComponent', position: { x, y: y ?? 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: 'goal_flag', layer: 'foreground' },
        {
          type: 'PhysicsComponent',
          bodyType: 'static',
          colliderShape: { type: 'box', width: 1, height: 2 },
          collisionTags: ['player'],
        },
      ],
    };
  }

  // ---- trigger builders ----

  /**
   * The entry line. It states the form's actual win condition, because "reach
   * the flag" printed over a map you are meant to connect is worse than no
   * instruction at all — the player plays the game the message describes.
   */
  private sceneStartTrigger(sceneId: string, region: any, form: ExperienceForm, gateCount: number) {
    const name = String(region.name || 'the experience');
    const objective: Record<string, string> = {
      'reach-goal': 'reach the marker',
      'collect-all': `gather all ${gateCount}, then reach the marker`,
      'connect-all': `walk every one of the ${gateCount} connections, then return to the centre`,
      'order-sequence': `work through all ${gateCount} in order, then reach the marker`,
    };
    return {
      id: `${sceneId}-start`,
      scope: 'scene',
      sceneId,
      eventType: 'OnSceneEnter',
      conditions: [],
      actions: [
        {
          id: `${sceneId}-start-message`,
          type: 'ShowMessage',
          parameters: { text: `Entering ${name} — ${objective[form.resolution.id] || 'reach the marker'}!` },
        },
      ],
    };
  }

  /**
   * Picking something up. `gateVar` records the pickup in world state so the
   * resolution can require it; `requires` is the previous gate in an ordered
   * form, which is the whole of what "in the right order" costs — an item
   * touched out of turn simply does not fire.
   */
  private collectTrigger(
    sceneId: string,
    entity: Record<string, unknown>,
    item: any,
    gate?: { gateVar?: string; requires?: string; resolution?: string },
  ) {
    const entityId = String(entity.id);
    const conditions: Array<Record<string, unknown>> = [
      {
        id: `${entityId}-touch`,
        type: 'CollisionPair',
        parameters: { entityAId: `${sceneId}-player`, entityBId: entityId },
      },
    ];
    if (gate?.requires) {
      conditions.push({
        id: `${entityId}-after`,
        type: 'VariableEquals',
        parameters: { scope: 'world', var: gate.requires, value: true },
      });
    }
    const gateActions = gate?.gateVar
      ? [{
        id: `${entityId}-gate`,
        type: 'SetVariable',
        parameters: { scope: 'world', var: gate.gateVar, value: true },
      }]
      : [];
    return {
      id: `${entityId}-collect`,
      scope: 'scene',
      sceneId,
      eventType: 'OnCollision',
      conditions,
      actions: [
        ...gateActions,
        { id: `${entityId}-despawn`, type: 'DespawnEntity', parameters: { entityId } },
        {
          id: `${entityId}-signal`,
          type: 'EmitEvent',
          parameters: {
            eventType: 'OnCustom',
            payload: { kind: 'collected', entityId, bindingId: item.bindingId || null, label: entity.label },
          },
        },
        {
          id: `${entityId}-message`,
          type: 'ShowMessage',
          parameters: { text: `Collected: ${entity.label}` },
        },
      ],
    };
  }

  /**
   * Touching an enemy costs the player health and emits the signal the Person
   * Node stream reads. Damage resolution stays in the runtime (HealthBelowThreshold
   * drives the enemy's own retreat), so the adapter only applies a delta.
   */
  private enemyContactTrigger(sceneId: string, entity: Record<string, unknown>, enemy: any) {
    const entityId = String(entity.id);
    return {
      id: `${entityId}-contact`,
      scope: 'scene',
      sceneId,
      eventType: 'OnCollision',
      conditions: [
        {
          id: `${entityId}-touch`,
          type: 'CollisionPair',
          parameters: { entityAId: `${sceneId}-player`, entityBId: entityId },
        },
      ],
      actions: [
        {
          id: `${entityId}-damage`,
          type: 'ApplyAttack',
          parameters: { entityId, targetTag: 'player', damage: 10 },
        },
        {
          id: `${entityId}-signal`,
          type: 'EmitEvent',
          parameters: {
            eventType: 'OnCustom',
            payload: { kind: 'enemy_contact', entityId, bindingId: enemy.bindingId || null, label: entity.label },
          },
        },
        {
          id: `${entityId}-message`,
          type: 'ShowMessage',
          parameters: { text: `${entity.label} strikes!` },
        },
      ],
    };
  }

  /**
   * Touching a hazard costs health and says what the source called it, so the
   * damage is legible as the risk it came from rather than as an anonymous trap.
   * The hazard stays — it is terrain, not an encounter to be cleared.
   */
  private hazardContactTrigger(sceneId: string, entity: Record<string, unknown>, hazard: any) {
    const entityId = String(entity.id);
    return {
      id: `${entityId}-contact`,
      scope: 'scene',
      sceneId,
      eventType: 'OnCollision',
      conditions: [
        {
          id: `${entityId}-touch`,
          type: 'CollisionPair',
          parameters: { entityAId: `${sceneId}-player`, entityBId: entityId },
        },
      ],
      actions: [
        {
          id: `${entityId}-damage`,
          type: 'ApplyAttack',
          // A cooldown, or standing in a hazard would drain the player in a
          // single frame instead of costing them for staying in it.
          parameters: { entityId, targetTag: 'player', damage: hazard.damage, range: 2.5, cooldown: 1 },
        },
        {
          id: `${entityId}-signal`,
          type: 'EmitEvent',
          parameters: {
            eventType: 'OnCustom',
            payload: { kind: 'hazard_contact', entityId, bindingId: hazard.bindingId || null, label: entity.label },
          },
        },
        {
          id: `${entityId}-message`,
          type: 'ShowMessage',
          parameters: { text: `${entity.label}!` },
        },
      ],
    };
  }

  /**
   * Meeting someone. In a connect-all form this is also an edge of the graph
   * being walked, so it records a gate; in every other form it stays pure
   * flavor and gates nothing.
   */
  private dialogueTrigger(sceneId: string, entity: Record<string, unknown>, character: any, gateVar?: string) {
    const entityId = String(entity.id);
    const lines: string[] = Array.isArray(character.lines) ? character.lines : [];
    const line = lines[0] || `Hello, I'm ${entity.label}.`;
    const gateActions = gateVar
      ? [{ id: `${entityId}-gate`, type: 'SetVariable', parameters: { scope: 'world', var: gateVar, value: true } }]
      : [];
    return {
      id: `${entityId}-dialogue`,
      scope: 'scene',
      sceneId,
      eventType: 'OnCollision',
      conditions: [
        {
          id: `${entityId}-touch`,
          type: 'CollisionPair',
          parameters: { entityAId: `${sceneId}-player`, entityBId: entityId },
        },
      ],
      actions: [
        ...gateActions,
        {
          id: `${entityId}-say`,
          type: 'ShowMessage',
          parameters: { text: `${entity.label}: ${line}` },
        },
        {
          id: `${entityId}-signal`,
          type: 'EmitEvent',
          parameters: {
            eventType: 'OnCustom',
            payload: { kind: 'npc_met', entityId, bindingId: character.bindingId || null },
          },
        },
      ],
    };
  }

  /**
   * The player's strike. Target selection (nearest enemy in reach) and the
   * cooldown are resolved by the runtime, so this stays a declarative intent
   * rather than a per-scene list of enemy ids that would go stale on despawn.
   */
  private playerAttackTrigger(sceneId: string) {
    return {
      id: `${sceneId}-player-attack`,
      scope: 'scene',
      sceneId,
      eventType: 'OnInput',
      conditions: [
        { id: `${sceneId}-attack-pressed`, type: 'InputIsPressed', parameters: { actions: ['Attack'] } },
      ],
      actions: [
        {
          id: `${sceneId}-player-strike`,
          type: 'ApplyAttack',
          parameters: {
            entityId: `${sceneId}-player`,
            targetTag: 'enemy',
            damage: 25,
            range: 2.2,
            cooldown: 0.45,
          },
        },
      ],
    };
  }

  /**
   * Completion. `gateVars` is the resolution made executable: one world
   * variable per thing the form said had to happen, all of which must read
   * `true` before touching the marker ends anything. An empty list is
   * `reach-goal` — arriving is the whole condition.
   *
   * Conditions on a trigger are AND-ed by the runtime, so "all of them" needs
   * no counter and no expression language: it is the condition list itself.
   */
  private goalTrigger(sceneId: string, goal: Record<string, unknown>, nextSceneId: string | null, gateVars: string[] = []) {
    const actions: Array<Record<string, unknown>> = [
      {
        id: `${sceneId}-complete`,
        type: 'EmitEvent',
        parameters: { eventType: 'OnSceneComplete', payload: { sceneId } },
      },
    ];
    if (nextSceneId) {
      actions.push({ id: `${sceneId}-advance`, type: 'LoadScene', parameters: { sceneId: nextSceneId } });
    } else {
      actions.push({
        id: `${sceneId}-finish-message`,
        type: 'ShowMessage',
        parameters: { text: 'Experience Complete!' },
      });
    }
    return {
      id: `${sceneId}-goal`,
      scope: 'global',
      eventType: 'OnCollision',
      conditions: [
        {
          id: `${sceneId}-goal-touch`,
          type: 'CollisionPair',
          parameters: { entityAId: `${sceneId}-player`, entityBId: String(goal.id) },
        },
        ...gateVars.map((gateVar, order) => ({
          id: `${sceneId}-goal-gate-${order + 1}`,
          type: 'VariableEquals',
          parameters: { scope: 'world', var: gateVar, value: true },
        })),
      ],
      actions,
    };
  }

  /**
   * The built-in player machine, used when Stage 3 compiled none. Mirrors the
   * behavior compiler's two variants: steer in a planar form, run-and-jump in a
   * gravity one.
   */
  private playerStateMachine(gravity = true) {
    if (!gravity) {
      const directions = ['MoveLeft', 'MoveRight', 'MoveUp', 'MoveDown'];
      const planarMove = (id: string) => ({ id, type: 'ApplyPlanarMovementFromInput', parameters: { speedVar: 'moveSpeed' } });
      return {
        id: 'player_state_machine',
        initialState: 'Idle',
        states: [
          { id: 'Idle', onUpdateActions: [planarMove('idle-move')] },
          { id: 'Moving', onUpdateActions: [planarMove('steer-move')] },
        ],
        transitions: [
          {
            fromStateId: 'Idle',
            toStateId: 'Moving',
            eventType: 'OnInput',
            conditions: [{ id: 'steer-pressed', type: 'InputIsPressed', parameters: { actions: directions } }],
          },
          {
            fromStateId: 'Moving',
            toStateId: 'Idle',
            eventType: 'OnInput',
            conditions: [{ id: 'steer-released', type: 'InputReleasedAll', parameters: { actions: directions } }],
          },
        ],
      };
    }
    const move = (id: string) => ({
      id,
      type: 'ApplyHorizontalMovementFromInput',
      parameters: { speedVar: 'moveSpeed' },
    });
    return {
      id: 'player_state_machine',
      initialState: 'Idle',
      states: [
        { id: 'Idle', onUpdateActions: [move('idle-move')] },
        { id: 'Running', onUpdateActions: [move('run-move')] },
        {
          id: 'Jumping',
          onEnterActions: [
            { id: 'jump-impulse', type: 'ApplyImpulse', parameters: { forceVar: 'jumpForce', direction: { x: 0, y: 1 } } },
            { id: 'leave-ground', type: 'SetVariable', parameters: { var: 'isGrounded', value: false } },
          ],
          onUpdateActions: [move('air-move')],
        },
      ],
      transitions: [
        {
          fromStateId: 'Idle',
          toStateId: 'Jumping',
          eventType: 'OnInput',
          priority: 10,
          conditions: [
            { id: 'jump-pressed', type: 'InputIsPressed', parameters: { actions: ['Jump'] } },
            { id: 'grounded', type: 'VariableEquals', parameters: { var: 'isGrounded', value: true } },
          ],
        },
        {
          fromStateId: 'Running',
          toStateId: 'Jumping',
          eventType: 'OnInput',
          priority: 10,
          conditions: [
            { id: 'jump-pressed-run', type: 'InputIsPressed', parameters: { actions: ['Jump'] } },
            { id: 'grounded-run', type: 'VariableEquals', parameters: { var: 'isGrounded', value: true } },
          ],
        },
        {
          fromStateId: 'Idle',
          toStateId: 'Running',
          eventType: 'OnInput',
          conditions: [{ id: 'move-pressed', type: 'InputIsPressed', parameters: { actions: ['MoveLeft', 'MoveRight'] } }],
        },
        {
          fromStateId: 'Running',
          toStateId: 'Idle',
          eventType: 'OnInput',
          conditions: [{ id: 'move-released', type: 'InputReleasedAll', parameters: { actions: ['MoveLeft', 'MoveRight'] } }],
        },
        {
          fromStateId: 'Jumping',
          toStateId: 'Idle',
          eventType: 'OnCollision',
          conditions: [
            { id: 'landed', type: 'CollisionWithTag', parameters: { tag: 'ground', contactNormalYGreaterThan: 0.7 } },
          ],
          actions: [{ id: 'set-grounded', type: 'SetVariable', parameters: { var: 'isGrounded', value: true } }],
        },
      ],
    };
  }
}
