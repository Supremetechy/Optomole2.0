/**
 * entity-factory (runner-gauntlet) — EntitySpecs into a linear course.
 *
 *   EntitySpec (from MappingEngine) -> classifyRunner() -> course segments
 *
 * Semantic mapping for this genre:
 *   procedure-step / quest-objective -> CHECKPOINT platform. Reaching it banks
 *     progress: a death after it restarts there, not at the start.
 *   evidence / definition / key-item -> TOKEN to collect mid-air or on the deck
 *   hazard                           -> OBSTACLE to jump
 *   npc                              -> the coach line on the start card
 *   metric                           -> the target distance on the result card
 *
 * The course is laid out left-to-right in world pixels. Segments alternate
 * hazard-then-tokens so there is a rhythm to the run rather than a random
 * scatter, and spacing widens with pace so later stretches stay jumpable.
 *
 * Physics here is hand-rolled rather than Matter: a runner needs precise,
 * predictable jump arcs, and a 30-line integrator gives better feel than a
 * general solver.
 */
import { Runner } from './prefabs/Runner.js';
import { Obstacle } from './prefabs/Obstacle.js';
import { Token } from './prefabs/Token.js';
import { Checkpoint } from './prefabs/Checkpoint.js';

export const GROUND_Y = 0;           // course-space ground line (screen offset applied by the scene)
export const GRAVITY = 2100;         // px/s²
export const JUMP_VELOCITY = -720;   // px/s
export const BASE_SPEED = 300;       // px/s at the start of a stage

const CHECKPOINT_TYPES = new Set(['procedure-step', 'quest-objective', 'checkpoint', 'key-item']);
const OBSTACLE_TYPES = new Set(['hazard', 'obstacle']);

export function classifyRunner(spec) {
  if (spec.entityType === 'npc') return 'coach';
  if (spec.entityType === 'metric' || spec.entityType === 'finish-gate') return 'target';
  if (OBSTACLE_TYPES.has(spec.entityType)) return 'obstacle';
  // Explicit procedure steps become checkpoints; evidence/definitions are tokens.
  if (CHECKPOINT_TYPES.has(spec.entityType) && spec.mechanic !== 'token') return 'checkpoint';
  return 'token';
}

export function createRunner(ctx, pos) {
  return new Runner(ctx, pos);
}

export function createObstacle(ctx, spec, opts) {
  return new Obstacle(ctx, spec, opts);
}

export function createToken(ctx, spec, opts) {
  return new Token(ctx, spec, opts);
}

export function createCheckpoint(ctx, spec, opts) {
  return new Checkpoint(ctx, spec, opts);
}

/**
 * Build the course.
 *
 * Every checkpoint opens a stage; the tokens and obstacles belonging to that
 * stage are dealt out between it and the next one. Spacing is derived from the
 * pace at that point in the run so a jump is always physically clearable:
 * minimum gap = the horizontal distance covered during one full jump arc.
 */
export function buildCourse(specs, { title = 'The Gauntlet', tokensPerStage = 3 } = {}) {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const checkpoints = sorted.filter((s) => classifyRunner(s) === 'checkpoint');
  const tokens = sorted.filter((s) => classifyRunner(s) === 'token');
  const obstacles = sorted.filter((s) => classifyRunner(s) === 'obstacle');
  const coach = sorted.find((s) => classifyRunner(s) === 'coach') || null;
  const target = sorted.find((s) => classifyRunner(s) === 'target') || null;

  // A course with no checkpoints is just a treadmill — mint one finish marker.
  const stageSpecs = checkpoints.length ? checkpoints : [{
    id: 'checkpoint-finish',
    entityType: 'checkpoint',
    label: 'The Finish',
    description: 'Cover the distance to complete the run.',
    reward: { xp: 150, currency: 15 },
  }];

  const stages = [];
  const items = [];   // flat, x-ordered list of everything on the course
  let x = 900;        // clear run-up before the first hazard
  let tokenCursor = 0;
  let obstacleCursor = 0;

  stageSpecs.forEach((cpSpec, i) => {
    const pace = BASE_SPEED + i * 26;               // speed at this point in the run
    const airTime = (2 * Math.abs(JUMP_VELOCITY)) / GRAVITY;
    const jumpSpan = pace * airTime;                // horizontal reach of one jump
    const stageStart = x;

    // One obstacle per stage from stage 2 on; the opener is deliberately gentle.
    const obstacleCount = obstacles.length ? (i === 0 ? 1 : Math.min(2, 1 + Math.floor(i / 3))) : 0;
    const stageTokens = [];
    const stageObstacles = [];

    for (let o = 0; o < obstacleCount; o++) {
      const spec = obstacles[obstacleCursor % obstacles.length];
      obstacleCursor++;
      x += jumpSpan * 1.25;
      const item = { kind: 'obstacle', spec, x, height: 46 + (o % 2) * 16 };
      items.push(item);
      stageObstacles.push(item);

      // Tokens sit just past each obstacle — the reward for a clean jump, placed
      // at apex height so a well-timed jump collects them on the way over.
      for (let t = 0; t < tokensPerStage && tokens.length; t++) {
        const tokenSpec = tokens[tokenCursor % tokens.length];
        tokenCursor++;
        x += 130;
        const item = {
          kind: 'token',
          spec: tokenSpec,
          x,
          // Alternate deck-level and mid-air so the run has vertical variety.
          y: t % 2 === 0 ? -120 : -46,
        };
        items.push(item);
        stageTokens.push(item);
      }
    }

    // Breathing room, then the checkpoint platform.
    x += jumpSpan * 0.9;
    const checkpoint = { kind: 'checkpoint', spec: cpSpec, x, index: i, isFinal: i === stageSpecs.length - 1 };
    items.push(checkpoint);

    stages.push({
      id: `stage-${i + 1}`,
      index: i,
      title: cpSpec.label ? `Stage ${i + 1}: ${short(cpSpec.label)}` : `Stage ${i + 1}`,
      checkpoint,
      tokens: stageTokens,
      obstacles: stageObstacles,
      pace,
      startX: stageStart,
      endX: x,
    });

    x += 420; // run-out before the next stage begins
  });

  return {
    title,
    stages,
    items: items.sort((a, b) => a.x - b.x),
    length: x,
    coach,
    target,
    tokenCount: items.filter((i) => i.kind === 'token').length,
    obstacleCount: items.filter((i) => i.kind === 'obstacle').length,
  };
}

/** Pace at a given distance — a gentle ramp, capped so it stays playable. */
export function paceAt(distance) {
  return Math.min(BASE_SPEED * 2.1, BASE_SPEED + distance * 0.018);
}

function short(text, max = 28) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
