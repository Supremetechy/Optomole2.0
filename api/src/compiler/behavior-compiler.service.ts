import { Injectable } from '@nestjs/common';
import { DirectiveSet, ExperienceDirective } from './experience-directive.service';
import { SemanticModel, SemanticNode } from './semantic-model.service';

/**
 * BehaviorCompilerService — Stage 3 of the content-to-experience compiler.
 *
 * A registry of `family -> template function`. Each template turns parametric
 * intent into concrete executable logic. Nothing here knows about sprites,
 * canvases, or physics engines — only abstract actions (ApplyImpulse,
 * SetVariable, SpawnEntity) that Stage 4 runs blindly.
 *
 * Three output shapes, because the three kinds of behavior genuinely differ:
 *
 *   StateMachine    per-entity, event-driven   (movement, combat)
 *   DirectorProgram level/region-scoped, tick-driven + scheduled (pacing, squad)
 *   SequenceGraph   world-scoped, beat-ordered (narrative)
 *
 * The runtime therefore needs three thin executors, not one — but each stays
 * equally dumb: it never interprets *why* a curve escalates or *why* a beat is
 * gated, it just runs the action the compiler already resolved.
 *
 * One deliberate departure from the reference sketch: compiled actions do NOT
 * hardcode `entityId`. The RuntimeCore defaults an action's entityId to the
 * instance that ran it, so a single compiled machine can drive every enemy that
 * shares an archetype, across scenes. Targets are named by TAG (`targetTag`)
 * for the same reason — the player's entity id is per-scene.
 */

// ---- runtime behavior shapes (mirrors Phaser/dsl/types.ts) ----

export interface BehaviorAction {
  id: string;
  type: string;
  parameters: Record<string, unknown>;
}

export interface BehaviorCondition {
  id: string;
  type: string;
  parameters: Record<string, unknown>;
}

export interface BehaviorState {
  id: string;
  onEnterActions?: BehaviorAction[];
  onExitActions?: BehaviorAction[];
  onUpdateActions?: BehaviorAction[];
}

export interface BehaviorTransition {
  fromStateId: string;
  toStateId: string;
  eventType: string;
  conditions: BehaviorCondition[];
  actions?: BehaviorAction[];
  priority?: number;
}

export interface StateMachine {
  id: string;
  initialState: string;
  states: BehaviorState[];
  transitions: BehaviorTransition[];
}

/** Tick-driven arbiter/director. Pacing and squad coordination both compile here. */
export interface DirectorProgram {
  id: string;
  scope: 'region' | 'level';
  targetId: string;
  tickIntervalSeconds: number;
  onTickActions: BehaviorAction[];
  scheduledActions: Array<BehaviorAction & { repeatEverySeconds: number }>;
}

export interface SequenceBeat {
  id: string;
  order: number;
  label: string;
  skippable: boolean;
  triggerActions: BehaviorAction[];
}

export interface SequenceGraph {
  id: string;
  beats: SequenceBeat[];
  transitions: Array<{ fromBeatId: string; toBeatId: string; conditions: BehaviorCondition[] }>;
}

/** What a region is furnished with — read by the DSL emitter when it lays out scenes. */
export interface EnvironmentPlan {
  regionId: string;
  regionName: string;
  description: string;
  enclosure: 'interior' | 'exterior';
  palette: string[];
  ambientIntensity: number;
  props: Array<{ id: string; spriteId: string; kind: string; width: number; height: number }>;
  platforms: Array<{ id: string; width: number; height: number; gapAfter: number; rise: number }>;
  hazardNodeIds: string[];
  itemNodeIds: string[];
}

/** One sprite id, declared once, resolved identically by every renderer. */
export interface AssetSpec {
  spriteId: string;
  role: string;
  shape: string;
  width: number;
  height: number;
  tint: string;
  palette: string[];
  /** Emotional tone from the asset directive; drives generated-art prompts. */
  tone?: string;
}

/** An enemy the emitter has to place: which machine drives it, and how tough it is. */
export interface EnemyPlan {
  entityKey: string;
  label: string;
  archetype: string;
  stateMachineId: string;
  health: number;
  preferredRange: string;
  squadId: string | null;
  bindingId: string | null;
  spriteId: string;
  /** Starting StateComponent variables — the compiled numbers, not defaults. */
  variables: Record<string, number | string | boolean>;
}

export interface CompiledBehaviors {
  schemaVersion: string;
  kind: string;
  experienceId: string;
  stateMachines: StateMachine[];
  directors: DirectorProgram[];
  sequences: SequenceGraph[];
  environments: EnvironmentPlan[];
  assets: AssetSpec[];
  enemies: EnemyPlan[];
  /** Starting variables for the player entity, from the movement directive. */
  playerVariables: Record<string, number | boolean>;
  validation: {
    byFamily: Record<string, number>;
    compiled: Record<string, number>;
    unhandledFamilies: string[];
  };
}

/** Curve shapes are pure functions of elapsed time -> tension scalar (0-1). */
export const PACING_CURVES: Record<string, (t: number) => number> = {
  steady: () => 0.5,
  escalating: (t) => Math.min(1, t / 300),
  pulse: (t) => 0.5 + 0.4 * Math.sin(t / 20),
  release: (t) => Math.max(0.1, 1 - t / 180),
};

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback = '') => (typeof value === 'string' && value ? value : fallback);

@Injectable()
export class BehaviorCompilerService {
  compile(input: { directives: DirectiveSet; model?: SemanticModel }): CompiledBehaviors {
    const directives = input.directives?.directives || [];
    const model = input.model;

    const stateMachines: StateMachine[] = [];
    const directors: DirectorProgram[] = [];
    const sequences: SequenceGraph[] = [];
    const environments: EnvironmentPlan[] = [];
    const assets: AssetSpec[] = [];
    const enemies: EnemyPlan[] = [];
    const byFamily: Record<string, number> = {};
    const unhandled = new Set<string>();

    const squadByRegion = new Map<string, ExperienceDirective>();
    for (const directive of directives) {
      if (directive.family === 'squad') squadByRegion.set(directive.targetId, directive);
    }
    // Enemies are dealt round-robin across regions by the same rule the squad
    // resolver used, so an enemy's squad membership is recoverable here.
    const combatDirectives = directives.filter((directive) => directive.family === 'combat');
    const regionIds = [...new Set(directives.filter((d) => d.scope === 'region').map((d) => d.targetId))];
    const squadIdFor = (index: number): string | null => {
      if (!regionIds.length) return null;
      const regionId = regionIds[index % regionIds.length];
      const squad = squadByRegion.get(regionId);
      return squad ? `${regionId}_squad_director` : null;
    };

    // Combat timing is a bet on where the player will be; that needs the speed
    // the movement directive compiled, not an assumed one.
    const playerSpeed = num(
      directives.find((directive) => directive.family === 'movement')?.parameters.moveSpeed,
      5,
    );

    for (const directive of directives) {
      byFamily[directive.family] = (byFamily[directive.family] || 0) + 1;
      switch (directive.family) {
        case 'movement':
          stateMachines.push(this.buildMovementStateMachine(directive));
          break;
        // Traversal has no standalone runtime shape: it parameterizes its
        // region's EnvironmentPlan (platform runs, gaps, verticality), which is
        // compiled from the environment directive below.
        case 'traversal':
          break;
        case 'combat': {
          const index = combatDirectives.indexOf(directive);
          stateMachines.push(this.buildCombatBehaviorTree(directive, playerSpeed));
          enemies.push({
            entityKey: directive.targetId,
            label: str(directive.parameters.label, directive.targetId),
            archetype: str(directive.parameters.archetype, 'enemy'),
            stateMachineId: `${directive.targetId}_combat_sm`,
            health: num(directive.parameters.health, 80),
            preferredRange: str(directive.parameters.preferredRange, 'melee'),
            squadId: squadIdFor(index),
            bindingId: str(directive.parameters.bindingId) || null,
            spriteId: 'enemy_idle',
            variables: this.combatVariables(directive),
          });
          break;
        }
        case 'squad':
          directors.push(this.buildSquadCoordinator(directive));
          break;
        case 'pacing':
          directors.push(this.buildPacingDirector(directive));
          break;
        case 'narrative':
          sequences.push(this.buildNarrativeSequence(directive, model));
          break;
        case 'environment':
          environments.push(this.buildEnvironmentPlan(directive, directives));
          break;
        case 'asset':
          assets.push(this.buildAssetSpec(directive));
          break;
        default:
          unhandled.add(directive.family);
      }
    }

    return {
      schemaVersion: '1.0.0',
      kind: 'optomole.CompiledBehaviors',
      experienceId: input.directives?.experienceId || 'experience',
      stateMachines,
      directors,
      sequences,
      environments,
      assets,
      enemies,
      playerVariables: this.movementVariables(directives.find((directive) => directive.family === 'movement')),
      validation: {
        byFamily,
        compiled: {
          stateMachines: stateMachines.length,
          directors: directors.length,
          sequences: sequences.length,
          environments: environments.length,
          assets: assets.length,
          enemies: enemies.length,
        },
        unhandledFamilies: [...unhandled],
      },
    };
  }

  // ---- movement ----

  /**
   * The player machine. Speed/jump come from the movement directive, so a tense
   * source produces a faster, floatier player than a contemplative one.
   */
  buildMovementStateMachine(directive: ExperienceDirective): StateMachine {
    const move = (id: string) => ({ id, type: 'ApplyHorizontalMovementFromInput', parameters: { speedVar: 'moveSpeed' } });
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
          conditions: [{ id: 'landed', type: 'CollisionWithTag', parameters: { tag: 'ground', contactNormalYGreaterThan: 0.7 } }],
          actions: [{ id: 'set-grounded', type: 'SetVariable', parameters: { var: 'isGrounded', value: true } }],
        },
      ],
    };
  }

  /** Starting variables for a player driven by a movement directive. */
  movementVariables(directive: ExperienceDirective | undefined): Record<string, number | boolean> {
    return {
      isGrounded: true,
      moveSpeed: num(directive?.parameters.moveSpeed, 5),
      jumpForce: num(directive?.parameters.jumpForce, 12),
      airControl: num(directive?.parameters.airControl, 0.7),
      coyoteTime: num(directive?.parameters.coyoteTime, 0.1),
      // The player is a combat participant: without health, an enemy's
      // ApplyAttack would resolve to a target it can never affect.
      health: 100,
      maxHealth: 100,
    };
  }

  // ---- combat ----

  /**
   * One enemy's behavior tree. `groupPressure` is deliberately NOT consumed here
   * — it belongs one layer up in the squad coordinator, which arbitrates entry
   * into Telegraphing and broadcasts an effectiveAggression override down.
   *
   * The `Holding` state is what a denied enemy does: it circles instead of
   * idling, so an encounter reads as coordinated rather than as enemies
   * mysteriously standing still.
   */
  buildCombatBehaviorTree(directive: ExperienceDirective, playerSpeed = 5): StateMachine {
    const p = directive.parameters;
    const aggression = num(p.aggression, 0.5);
    const preferredRange = str(p.preferredRange, 'melee');
    const retreatThreshold = num(p.retreatThreshold, 0);
    const engageRange = preferredRange === 'melee' ? 1.5 : 6;

    /**
     * Where the enemy decides to swing.
     *
     * A telegraphed attack is a bet on where the target will be when the windup
     * ends, and a target that keeps moving covers `playerSpeed * attackWindup`
     * metres in the meantime. Committing at the edge of reach loses that bet
     * every time: a real playtest had a ranged enemy telegraph at 5.99m, strike
     * at 8.94m, and land one hit in ninety seconds.
     *
     * So the commit distance is reach minus the drift the windup pays for —
     * derived from the two numbers that cause it, not a tuned constant. A slower
     * player or a snappier attack automatically lets the enemy commit further out.
     */
    const drift = playerSpeed * num(p.attackWindup, 0.5);
    const commitRange = Number(Math.max(0.6, engageRange - drift).toFixed(2));
    /** Keep closing past the commit point, so the bet is made with margin in hand. */
    const stopDistance = Number(Math.max(0.4, commitRange * 0.6).toFixed(2));

    const states: BehaviorState[] = [
      {
        id: 'Idle',
        onEnterActions: [{ id: 'play_idle_combat', type: 'PlayAnimation', parameters: { animationId: 'enemy_idle' } }],
      },
      {
        id: 'Alert',
        onEnterActions: [
          { id: 'start_reaction_timer', type: 'StartTimer', parameters: { timerId: 'reaction', duration: num(p.reactionTime, 0.6) } },
        ],
      },
      {
        id: 'Approaching',
        onUpdateActions: [
          {
            id: 'approach_move',
            type: 'ApplyMovementTowardTarget',
            parameters: {
              targetTag: 'player',
              // effectiveAggression is broadcast by the squad coordinator; it
              // falls back to the compiled value when the enemy is unsquadded.
              speedVar: 'effectiveSpeed',
              speed: Number((3 + aggression * 4).toFixed(2)),
              preferredRange,
              stopDistance,
            },
          },
        ],
      },
      {
        id: 'Holding',
        onEnterActions: [{ id: 'play_hold', type: 'PlayAnimation', parameters: { animationId: 'enemy_circle' } }],
        onUpdateActions: [
          {
            id: 'circle_move',
            type: 'ApplyOrbitMovement',
            parameters: { targetTag: 'player', radius: engageRange + 2.5, speed: Number((1 + aggression).toFixed(2)) },
          },
        ],
      },
      {
        id: 'Telegraphing',
        onEnterActions: [
          { id: 'play_windup', type: 'PlayAnimation', parameters: { animationId: 'enemy_attack_windup' } },
          { id: 'start_windup_timer', type: 'StartTimer', parameters: { timerId: 'windup', duration: num(p.attackWindup, 0.5) } },
        ],
      },
      {
        id: 'Attacking',
        onEnterActions: [
          {
            id: 'apply_attack',
            type: 'ApplyAttack',
            // Reach MUST match the range this enemy commits at. A ranged
            // attacker telegraphs from `engageRange` metres away, so leaving
            // reach to the runtime's melee-sized default made every ranged
            // enemy swing at empty air forever.
            parameters: {
              targetTag: 'player',
              damage: Math.round(5 + aggression * 15),
              range: Number((engageRange + 0.5).toFixed(2)),
            },
          },
          { id: 'start_cooldown', type: 'StartTimer', parameters: { timerId: 'cooldown', duration: num(p.attackCooldown, 1.2) } },
          { id: 'release_slot', type: 'EmitEvent', parameters: { eventType: 'OnCustom', payload: { kind: 'attack_released' } } },
        ],
      },
      {
        id: 'Retreating',
        onUpdateActions: [
          { id: 'retreat_move', type: 'ApplyMovementAwayFromTarget', parameters: { targetTag: 'player', speed: 5 } },
        ],
      },
    ];

    const transitions: BehaviorTransition[] = [
      {
        fromStateId: 'Idle',
        toStateId: 'Alert',
        eventType: 'OnPerception',
        conditions: [{ id: 'player_seen', type: 'TargetInSightRange', parameters: { targetTag: 'player', range: engageRange * 4 } }],
      },
      {
        fromStateId: 'Alert',
        toStateId: 'Approaching',
        eventType: 'OnTimerElapsed',
        conditions: [{ id: 'reaction_done', type: 'TimerElapsed', parameters: { timerId: 'reaction' } }],
      },
      // The squad coordinator grants or denies the commit. An unsquadded enemy
      // is granted by default (see RuntimeCore: no arbiter => always granted).
      {
        fromStateId: 'Approaching',
        toStateId: 'Telegraphing',
        eventType: 'OnDistanceCheck',
        priority: 10,
        conditions: [
          { id: 'in_range', type: 'WithinRange', parameters: { targetTag: 'player', range: commitRange } },
          { id: 'slot_granted', type: 'AttackSlotGranted', parameters: {} },
        ],
      },
      {
        fromStateId: 'Approaching',
        toStateId: 'Holding',
        eventType: 'OnDistanceCheck',
        conditions: [
          { id: 'in_range_denied', type: 'WithinRange', parameters: { targetTag: 'player', range: commitRange } },
          { id: 'slot_denied', type: 'AttackSlotDenied', parameters: {} },
        ],
      },
      {
        fromStateId: 'Holding',
        toStateId: 'Telegraphing',
        eventType: 'OnCustom',
        conditions: [{ id: 'slot_granted_hold', type: 'AttackSlotGranted', parameters: {} }],
      },
      {
        fromStateId: 'Telegraphing',
        toStateId: 'Attacking',
        eventType: 'OnTimerElapsed',
        conditions: [{ id: 'windup_done', type: 'TimerElapsed', parameters: { timerId: 'windup' } }],
      },
      {
        fromStateId: 'Attacking',
        toStateId: 'Approaching',
        eventType: 'OnTimerElapsed',
        conditions: [{ id: 'cooldown_done', type: 'TimerElapsed', parameters: { timerId: 'cooldown' } }],
      },
    ];

    if (retreatThreshold > 0) {
      for (const from of ['Approaching', 'Telegraphing', 'Attacking', 'Holding']) {
        transitions.push({
          fromStateId: from,
          toStateId: 'Retreating',
          eventType: 'OnHealthChanged',
          priority: 20,
          conditions: [{ id: `retreat_check_${from}`, type: 'HealthBelowThreshold', parameters: { threshold: retreatThreshold } }],
        });
      }
    }

    return { id: `${directive.targetId}_combat_sm`, initialState: 'Idle', states, transitions };
  }

  /** Starting variables for an enemy driven by a combat directive. */
  combatVariables(directive: ExperienceDirective): Record<string, number | string | boolean> {
    const aggression = num(directive.parameters.aggression, 0.5);
    return {
      aggression,
      effectiveAggression: aggression,
      // baseSpeed is what the squad coordinator scales; effectiveSpeed is what
      // the movement action reads. Keeping both means a broadcast never has to
      // re-derive the compiled speed from aggression.
      baseSpeed: Number((3 + aggression * 4).toFixed(2)),
      effectiveSpeed: Number((3 + aggression * 4).toFixed(2)),
      health: num(directive.parameters.health, 80),
      maxHealth: num(directive.parameters.health, 80),
      attackGranted: false,
    };
  }

  // ---- pacing ----

  /**
   * Pacing drives a director, not an entity: a tick loop plus scheduled events.
   * The adapter samples the curve and calls EvaluateSpawnBudget/SetMusicIntensity
   * — it never decides what "escalating" means.
   */
  buildPacingDirector(directive: ExperienceDirective): DirectorProgram {
    const p = directive.parameters;
    const curve = str(p.tensionCurve, 'steady');
    return {
      id: `${directive.targetId}_pacing_director`,
      scope: 'region',
      targetId: directive.targetId,
      tickIntervalSeconds: 1,
      onTickActions: [
        {
          id: 'evaluate_spawn',
          type: 'EvaluateSpawnBudget',
          parameters: {
            regionId: directive.targetId,
            baseRate: num(p.enemySpawnRate, 2),
            curve,
            density: num(p.encounterDensity, 0.3),
          },
        },
        {
          id: 'evaluate_music',
          type: 'SetMusicIntensity',
          parameters: { regionId: directive.targetId, intensity: num(p.musicIntensity, 0.5), curve },
        },
      ],
      scheduledActions: [
        {
          id: 'breather_trigger',
          type: 'TriggerBreather',
          repeatEverySeconds: num(p.breatherInterval, 40),
          parameters: { regionId: directive.targetId, durationSeconds: 8 },
        },
      ],
    };
  }

  // ---- squad ----

  /**
   * The layer between "one enemy feels right" and "an encounter feels right".
   * It owns the shared clock and decides who may commit to an attack; the
   * per-entity machines only ever receive a granted/denied flag.
   */
  buildSquadCoordinator(directive: ExperienceDirective): DirectorProgram {
    const p = directive.parameters;
    const memberTargetIds = Array.isArray(p.memberTargetIds) ? (p.memberTargetIds as string[]) : [];
    return {
      id: `${directive.targetId}_squad_director`,
      scope: 'region',
      targetId: directive.targetId,
      tickIntervalSeconds: 0.2,
      onTickActions: [
        {
          id: 'arbitrate_attackers',
          type: 'ArbitrateSquadAttack',
          parameters: {
            squadId: `${directive.targetId}_squad_director`,
            memberKeys: memberTargetIds,
            maxConcurrentAttackers: this.resolveConcurrency(num(p.groupPressure, 0.5), memberTargetIds.length, num(p.maxConcurrentAttackers, 2)),
            flankBias: num(p.flankBias, 0.4),
            callOutDelay: num(p.callOutDelay, 0.8),
          },
        },
        {
          id: 'broadcast_effective_aggression',
          type: 'BroadcastVariable',
          parameters: {
            squadId: `${directive.targetId}_squad_director`,
            memberKeys: memberTargetIds,
            var: 'effectiveAggression',
            // Resolved per tick by the runtime: base aggression scaled by how
            // many allies are currently committed. The adapter never computes it.
            mode: 'scaleByCommittedAllies',
            baseVar: 'aggression',
          },
        },
      ],
      scheduledActions: [],
    };
  }

  /**
   * How much pressure translates into simultaneous attackers. Low pressure =
   * polite queueing (1 attacker); high pressure = mob (many), still capped.
   */
  resolveConcurrency(groupPressure: number, memberCount: number, hardCap: number): number {
    const pressureScaled = Math.round(groupPressure * memberCount);
    return Math.max(1, Math.min(hardCap, pressureScaled));
  }

  // ---- narrative ----

  /**
   * Beats in storyboard order, with gating relationships compiled into
   * BeatCompleted preconditions. `branchTolerance` decides whether a beat may be
   * skipped when its preconditions aren't met yet.
   */
  buildNarrativeSequence(directive: ExperienceDirective, model?: SemanticModel): SequenceGraph {
    const p = directive.parameters;
    const beatIds = Array.isArray(p.beatNodeIds) ? (p.beatNodeIds as string[]) : [];
    const requiredIds = new Set(Array.isArray(p.requiredBeatIds) ? (p.requiredBeatIds as string[]) : []);
    const branchTolerance = num(p.branchTolerance, 0.5);
    const pacing = str(p.pacing, 'slow_burn');
    const nodesById = new Map<string, SemanticNode>((model?.semanticNodes || []).map((node) => [node.id, node]));

    const beats: SequenceBeat[] = beatIds.map((nodeId, order) => {
      const node = nodesById.get(nodeId);
      const label = String(node?.attributes.label || `Beat ${order + 1}`);
      return {
        id: `beat_${nodeId}`,
        order,
        label,
        skippable: branchTolerance > 0.5 && !requiredIds.has(nodeId),
        triggerActions: [
          {
            id: `trigger_${nodeId}`,
            type: 'PlayCutsceneOrDialogue',
            parameters: {
              contentRef: nodeId,
              bindingId: node?.bindingId || null,
              label,
              tone: String(node?.attributes.emotion || 'neutral'),
              intensity: pacing === 'punchy' ? 0.8 : pacing === 'twist_heavy' ? 0.6 : 0.4,
            },
          },
          {
            id: `mark_${nodeId}`,
            type: 'SetVariable',
            parameters: { var: `beat_${nodeId}_complete`, value: true, scope: 'world' },
          },
        ],
      };
    });

    return {
      id: `${directive.targetId}_sequence`,
      beats,
      transitions: beats.slice(0, -1).map((beat, index) => ({
        fromBeatId: beat.id,
        toBeatId: beats[index + 1].id,
        conditions: requiredIds.has(beatIds[index])
          ? [{ id: `require_${beat.id}`, type: 'BeatCompleted', parameters: { beatId: beat.id } }]
          : [],
      })),
    };
  }

  // ---- environment ----

  /**
   * A region's furniture. Platform runs come from the region's traversal
   * directive, so the geometry a player crosses is derived from the location's
   * enclosure and the arc's pressure rather than being one flat strip everywhere.
   */
  buildEnvironmentPlan(directive: ExperienceDirective, all: ExperienceDirective[]): EnvironmentPlan {
    const p = directive.parameters;
    const traversal = all.find((other) => other.family === 'traversal' && other.targetId === directive.targetId);
    const platformCount = num(traversal?.parameters.platformCount, 3);
    const gapWidth = num(traversal?.parameters.gapWidth, 2);
    const verticality = num(traversal?.parameters.verticality, 0.4);
    const propKinds = Array.isArray(p.propKinds) ? (p.propKinds as string[]) : ['crate'];
    const propCount = num(p.propCount, 3);

    return {
      regionId: directive.targetId,
      regionName: str(p.regionName, directive.targetId),
      description: str(p.description),
      enclosure: str(p.enclosure, 'exterior') === 'interior' ? 'interior' : 'exterior',
      palette: Array.isArray(p.palette) ? (p.palette as string[]) : [],
      ambientIntensity: num(p.ambientIntensity, 0.5),
      props: Array.from({ length: propCount }, (_, index) => ({
        id: `${directive.targetId}-prop-${index + 1}`,
        spriteId: 'prop',
        kind: propKinds[index % propKinds.length],
        width: 0.9,
        height: 0.9,
      })),
      platforms: Array.from({ length: platformCount }, (_, index) => ({
        id: `${directive.targetId}-platform-${index + 1}`,
        width: Number((3 + (index % 2) * 1.5).toFixed(2)),
        height: 0.4,
        gapAfter: Number(gapWidth.toFixed(2)),
        // Rising platforms in vertical regions; a flat run when verticality is low.
        rise: Number((verticality * (1 + (index % 3))).toFixed(2)),
      })),
      hazardNodeIds: Array.isArray(p.hazardNodeIds) ? (p.hazardNodeIds as string[]) : [],
      itemNodeIds: Array.isArray(p.itemNodeIds) ? (p.itemNodeIds as string[]) : [],
    };
  }

  private buildAssetSpec(directive: ExperienceDirective): AssetSpec {
    const p = directive.parameters;
    return {
      spriteId: str(p.spriteId, directive.targetId),
      role: str(p.role, 'prop'),
      shape: str(p.shape, 'box'),
      width: num(p.width, 1),
      height: num(p.height, 1),
      tint: str(p.tint, '#ffffff'),
      palette: Array.isArray(p.palette) ? (p.palette as string[]) : [],
      // The emotional tone the asset directive resolved. Carried on the spec
      // because it is what makes a generated sprite for a tense source differ
      // from one for a calm source — the placeholder renderer ignores it, but
      // an image prompt is meaningless without it.
      tone: str(p.tone) || undefined,
    };
  }
}
