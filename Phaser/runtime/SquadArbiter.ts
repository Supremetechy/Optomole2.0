/**
 * Squad arbitration — the layer between "one enemy feels right" and "an
 * encounter feels right".
 *
 * Without it, N enemies each running their own combat behavior tree will all
 * enter Telegraphing the instant they individually get in range, so attacks
 * cluster unfairly and the player never gets to breathe. The arbiter owns the
 * squad's shared clock and hands out attack slots; each enemy only ever learns
 * granted or denied.
 *
 * This is runtime logic, not adapter logic: an adapter applying the result only
 * sees a flag, and makes no judgment about pacing or fairness.
 */

export interface SquadArbitrationState {
  /** Entities currently committed to Telegraphing/Attacking. */
  committedAttackers: Set<string>;
  lastCommitTime: Record<string, number>;
  /** Shared, driven by callOutDelay — staggers commits across the squad. */
  cooldownUntilNextCommit: number;
  /**
   * Squad size at first contact, so pressure can respond to the player thinning
   * the squad out. groupPressure is compiled per-encounter but felt dynamically:
   * the last two enemies press harder rather than politely queueing, which is
   * the difference between an encounter that ends and one that fizzles.
   */
  initialMemberCount: number | null;
}

/** 0 at full strength, approaching 1 as the squad is worn down. */
export function attritionOf(state: SquadArbitrationState, livingMembers: number): number {
  if (!state.initialMemberCount) return 0;
  return Math.max(0, Math.min(1, 1 - livingMembers / state.initialMemberCount));
}

export interface SquadCandidate {
  entityId: string;
  wantsToAttack: boolean;
  distanceToTarget: number;
  /** Signed angle (radians) from the target's facing to this candidate. */
  angleToTarget: number;
}

export interface SquadRules {
  maxConcurrentAttackers: number;
  /** 0 = ignore position, 1 = strongly prefer candidates away from committed allies. */
  flankBias: number;
  callOutDelay: number;
}

export function createSquadState(): SquadArbitrationState {
  return {
    committedAttackers: new Set(),
    lastCommitTime: {},
    cooldownUntilNextCommit: 0,
    initialMemberCount: null,
  };
}

/**
 * Grant attack slots for one tick.
 *
 * Ranking is distance-first, then flank spread: candidates whose angle differs
 * most from the already-committed attackers are preferred in proportion to
 * `flankBias`, so a high-bias squad surrounds rather than queues up on one side.
 * At flankBias 0 this degrades exactly to nearest-first.
 */
export function arbitrateSquadAttack(
  state: SquadArbitrationState,
  rules: SquadRules,
  candidates: SquadCandidate[],
  now: number
): { grantedEntityIds: string[]; deniedEntityIds: string[] } {
  const wanting = candidates.filter(
    c => c.wantsToAttack && !state.committedAttackers.has(c.entityId)
  );
  const slotsFree = rules.maxConcurrentAttackers - state.committedAttackers.size;

  if (slotsFree <= 0 || now < state.cooldownUntilNextCommit) {
    return { grantedEntityIds: [], deniedEntityIds: wanting.map(c => c.entityId) };
  }

  const committedAngles = candidates
    .filter(c => state.committedAttackers.has(c.entityId))
    .map(c => c.angleToTarget);

  const maxDistance = Math.max(1, ...wanting.map(c => c.distanceToTarget));
  const score = (c: SquadCandidate): number => {
    // Lower is better. Distance normalized so flankBias trades against it on a
    // comparable scale rather than being swamped by world units.
    const proximity = c.distanceToTarget / maxDistance;
    if (!committedAngles.length || rules.flankBias <= 0) return proximity;
    const nearestAngleGap = Math.min(
      ...committedAngles.map(angle => angularDistance(angle, c.angleToTarget))
    );
    // A full half-turn of separation is the best possible spread.
    const clustering = 1 - Math.min(1, nearestAngleGap / Math.PI);
    return proximity * (1 - rules.flankBias) + clustering * rules.flankBias;
  };

  const ranked = [...wanting].sort((a, b) => score(a) - score(b));
  const granted = ranked.slice(0, slotsFree).map(c => c.entityId);
  const denied = ranked.slice(slotsFree).map(c => c.entityId);

  for (const entityId of granted) {
    state.committedAttackers.add(entityId);
    state.lastCommitTime[entityId] = now;
  }
  if (granted.length) state.cooldownUntilNextCommit = now + rules.callOutDelay;

  return { grantedEntityIds: granted, deniedEntityIds: denied };
}

/** Release a slot when an attack resolves, an enemy dies, or a scene unloads. */
export function releaseSlot(state: SquadArbitrationState, entityId: string): void {
  state.committedAttackers.delete(entityId);
}

/** Shortest separation between two angles, in [0, π]. */
function angularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % (Math.PI * 2);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}
