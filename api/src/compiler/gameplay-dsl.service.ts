import { Injectable } from '@nestjs/common';
import { id as makeId } from '../shared/ids';
import { AssetSpec, CompiledBehaviors, EnvironmentPlan } from './behavior-compiler.service';
import { ExperienceBuild } from './experience-build.service';

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
  validation: {
    sceneCount: number;
    entityCount: number;
    triggerCount: number;
    contributions: Record<string, number>;
  };
}

/** World-space layout constants (DSL units are meters, y-up). */
const ITEM_SPACING = 3;
const FIRST_ITEM_X = 4;
const GROUND_MARGIN = 4;

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
  compile(input: { build: ExperienceBuild; behaviors?: CompiledBehaviors }): GameplayDslBundle {
    const build = input.build;
    const behaviors = input.behaviors;
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
    items.forEach((item, i) => perScene[i % perScene.length].items.push(item));
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

      const lastX = FIRST_ITEM_X + placed.length * ITEM_SPACING;
      const goalX = lastX + ITEM_SPACING;
      const groundWidth = goalX + GROUND_MARGIN;

      const sceneEntityIds: string[] = [];
      const addEntity = (entity: Record<string, unknown>) => {
        entities.push(entity);
        sceneEntityIds.push(String(entity.id));
      };

      addEntity(this.playerEntity(sceneId, behaviors?.playerVariables));
      addEntity(this.groundEntity(sceneId, groundWidth));

      // Region geometry: platforms laid across the run, props as scenery. Both
      // come from the region's traversal/environment directives.
      (plan?.platforms || []).forEach((platform, order) => {
        const x = FIRST_ITEM_X + order * (platform.width + platform.gapAfter);
        if (x > groundWidth) return;
        addEntity(this.platformEntity(sceneId, platform, order, x));
      });
      (plan?.props || []).forEach((prop, order) => {
        const x = FIRST_ITEM_X + order * ITEM_SPACING + ITEM_SPACING / 2;
        if (x > groundWidth) return;
        addEntity(this.propEntity(sceneId, prop, order, x));
      });

      placed.forEach((placement, order) => {
        const x = FIRST_ITEM_X + order * ITEM_SPACING;
        if (placement.kind === 'item') {
          const entity = this.itemEntity(sceneId, placement.source, order, x);
          addEntity(entity);
          triggers.push(this.collectTrigger(sceneId, entity, placement.source));
        } else if (placement.kind === 'npc') {
          const entity = this.npcEntity(sceneId, placement.source, order, x);
          addEntity(entity);
          triggers.push(this.dialogueTrigger(sceneId, entity, placement.source));
        } else {
          const entity = this.enemyEntity(sceneId, placement.source, order, x);
          addEntity(entity);
          triggers.push(this.enemyContactTrigger(sceneId, entity, placement.source));
        }
      });

      const goal = this.goalEntity(sceneId, goalX);
      addEntity(goal);

      // An enemy the player cannot answer is a wall, not an encounter. One
      // input-driven strike, cooldown-gated by the runtime, closes the loop.
      if (assigned.enemies.length) triggers.push(this.playerAttackTrigger(sceneId));

      const isLast = sceneIndex === sceneSources.length - 1;
      const nextSceneId = isLast ? null : `scene-${sceneIndex + 2}`;
      triggers.push(this.sceneStartTrigger(sceneId, region));
      triggers.push(this.goalTrigger(sceneId, goal, nextSceneId));

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

    // The player machine is compiled from the movement directive when present;
    // the built-in side-scroller machine remains the fallback.
    const playerMachine = (behaviors?.stateMachines || []).find((machine) => machine.id === 'player_state_machine');
    const combatMachines = (behaviors?.stateMachines || []).filter((machine) => machine.id !== 'player_state_machine');
    const stateMachines: Array<Record<string, unknown>> = [
      (playerMachine as unknown as Record<string, unknown>) || this.playerStateMachine(),
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
        config: { gravity: { x: 0, y: -9.81, z: 0 }, pixelPerUnit: 100 },
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
      validation: {
        sceneCount: scenes.length,
        entityCount: entities.length,
        triggerCount: triggers.length,
        contributions: {
          regions: sceneSources.length,
          inventoryItems: items.length,
          castCharacters: characters.length,
          enemies: enemyPlans.length,
          platforms: environments.reduce((total, plan) => total + plan.platforms.length, 0),
          props: environments.reduce((total, plan) => total + plan.props.length, 0),
          directors: behaviors?.directors.length || 0,
          sequenceBeats: (behaviors?.sequences || []).reduce((total, sequence) => total + sequence.beats.length, 0),
          assets: behaviors?.assets.length || 0,
        },
      },
    };
  }

  // ---- entity builders ----

  private playerEntity(sceneId: string, variables?: Record<string, number | boolean>) {
    return {
      id: `${sceneId}-player`,
      archetype: 'hero',
      tags: ['player', 'controllable'],
      components: [
        { type: 'TransformComponent', position: { x: 0, y: 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: 'player_idle', layer: 'characters' },
        {
          type: 'PhysicsComponent',
          bodyType: 'dynamic',
          mass: 1,
          colliderShape: { type: 'box', width: 0.8, height: 1.8 },
          collisionTags: ['ground', 'collectible', 'npc', 'goal'],
        },
        {
          type: 'InputComponent',
          bindings: [
            { action: 'MoveLeft', keys: ['A', 'LeftArrow'] },
            { action: 'MoveRight', keys: ['D', 'RightArrow'] },
            { action: 'Jump', keys: ['Space', 'W', 'UpArrow'] },
            { action: 'Attack', keys: ['J', 'F'] },
          ],
        },
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
  private platformEntity(sceneId: string, platform: { id: string; width: number; height: number; rise: number }, order: number, x: number) {
    return {
      id: `${sceneId}-platform-${order + 1}`,
      archetype: 'platform',
      tags: ['ground', 'platform'],
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
  private propEntity(sceneId: string, prop: { kind: string; spriteId: string; width: number; height: number }, order: number, x: number) {
    return {
      id: `${sceneId}-prop-${order + 1}`,
      archetype: 'prop',
      tags: ['prop', 'scenery'],
      label: prop.kind,
      components: [
        { type: 'TransformComponent', position: { x, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'RenderComponent', spriteId: prop.spriteId, layer: 'background' },
      ],
    };
  }

  /**
   * An enemy compiled from a combat directive: its own behavior tree instance,
   * its own compiled numbers, and its squad membership so the region's
   * coordinator can arbitrate it.
   */
  private enemyEntity(sceneId: string, enemy: any, order: number, x: number) {
    return {
      id: `${sceneId}-enemy-${order + 1}`,
      archetype: String(enemy.archetype || 'enemy'),
      tags: ['enemy', 'hostile', ...(enemy.squadId ? [`squad:${enemy.squadId}`] : [])],
      bindingId: enemy.bindingId || null,
      label: String(enemy.label || `Enemy ${order + 1}`),
      squadId: enemy.squadId || null,
      components: [
        { type: 'TransformComponent', position: { x, y: 1.85, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
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

  private itemEntity(sceneId: string, item: any, order: number, x: number) {
    return {
      id: `${sceneId}-item-${order + 1}`,
      archetype: 'collectible',
      tags: ['collectible'],
      bindingId: item.bindingId || null,
      label: String(item.name || `Item ${order + 1}`),
      components: [
        { type: 'TransformComponent', position: { x, y: 1.5, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
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

  private npcEntity(sceneId: string, character: any, order: number, x: number) {
    return {
      id: `${sceneId}-npc-${order + 1}`,
      archetype: 'npc',
      tags: ['npc'],
      bindingId: character.bindingId || null,
      label: String(character.name || `Guide ${order + 1}`),
      components: [
        { type: 'TransformComponent', position: { x, y: 1.9, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
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

  private goalEntity(sceneId: string, x: number) {
    return {
      id: `${sceneId}-goal`,
      archetype: 'goal',
      tags: ['goal'],
      components: [
        { type: 'TransformComponent', position: { x, y: 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
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

  private sceneStartTrigger(sceneId: string, region: any) {
    const name = String(region.name || 'the experience');
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
          parameters: { text: `Entering ${name} — reach the flag!` },
        },
      ],
    };
  }

  private collectTrigger(sceneId: string, entity: Record<string, unknown>, item: any) {
    const entityId = String(entity.id);
    return {
      id: `${entityId}-collect`,
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

  private dialogueTrigger(sceneId: string, entity: Record<string, unknown>, character: any) {
    const entityId = String(entity.id);
    const lines: string[] = Array.isArray(character.lines) ? character.lines : [];
    const line = lines[0] || `Hello, I'm ${entity.label}.`;
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

  private goalTrigger(sceneId: string, goal: Record<string, unknown>, nextSceneId: string | null) {
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
      ],
      actions,
    };
  }

  /** The standard side-scroller state machine every generated player uses. */
  private playerStateMachine() {
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
