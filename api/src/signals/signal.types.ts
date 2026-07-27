/**
 * Signal types — the observation stream that feeds the Person Node loop.
 *
 * This is the return edge of the Experience Engine loop: every observation
 * about a person becomes an entry in one append-only stream. The World Model
 * and Reflection layers (steps #3-#6) consume that accumulating stream.
 *
 * **One stream, many sensors.** Gameplay telemetry was the first producer, but
 * it is not the only one: the EmailStream design (see design/EmailStreamEngine.md)
 * adds life-event observations extracted from an inbox, and they belong in the
 * same log — they are observations about the same person, folded by the same
 * graph. `source` is what keeps them distinguishable. Without it, two sensors
 * with wildly different emission rates become indistinguishable evidence, and
 * the higher-volume one silently dominates every belief the model holds.
 */

/**
 * Which sensor produced an observation.
 *
 * Adding a member is deliberately a code change, not a config value: every
 * source needs a calibration entry in PersonGraphService before its evidence
 * may enter the graph. An uncalibrated sensor is worse than a missing one.
 *
 *   runtime    — gameplay telemetry from a playable experience
 *   inbox      — life events extracted from mail (EmailStreamEngine L1/L2)
 *   calendar   — scheduled-time observations
 *   reflection — derived, written back by ReflectionService (#6), not observed
 */
export type SignalSource = 'runtime' | 'inbox' | 'calendar' | 'reflection';

export const SIGNAL_SOURCES: readonly SignalSource[] = ['runtime', 'inbox', 'calendar', 'reflection'];

/**
 * Every signal written before sources existed came from the playable runtime —
 * it was the only producer. Legacy logs are backfilled with this on read, so
 * no migration is needed and historical graphs stay reproducible.
 */
export const DEFAULT_SIGNAL_SOURCE: SignalSource = 'runtime';

export function isSignalSource(value: unknown): value is SignalSource {
  return typeof value === 'string' && (SIGNAL_SOURCES as readonly string[]).includes(value);
}

/** Read a source off a possibly-legacy record without trusting the type. */
export function sourceOf(signal: { source?: unknown }): SignalSource {
  return isSignalSource(signal?.source) ? signal.source : DEFAULT_SIGNAL_SOURCE;
}

/** One observation as sent by a producer (browser-engine SignalEmitter, SignalBridge…). */
export interface IncomingSignal {
  type: string;
  ts?: number; // client event time (epoch ms)
  data?: Record<string, unknown>;
}

/** A batch of observations posted for a single session. */
export interface SignalBatch {
  sessionId?: string;
  experienceId?: string;
  /**
   * The specific build that produced these observations.
   *
   * experienceId is a slug of the source title, so every build compiled from the
   * same content collides on it — two different playables become one identity in
   * the stream. buildId is unique per compile and is the join key for anything
   * that must not confuse them. Optional because logs written before it existed
   * carry only experienceId; consumers fall back for those.
   */
  buildId?: string;
  template?: string;
  engine?: string;
  /** Which sensor produced this batch. Omitted means `runtime`. */
  source?: SignalSource;
  signals: IncomingSignal[];
}

/** A normalized, persisted observation. */
export interface StoredSignal {
  type: string;
  ts: number;
  receivedAt: string; // server ISO time
  /** Always set on write; backfilled on read for logs predating sources. */
  source: SignalSource;
  sessionId?: string;
  experienceId?: string;
  /** The specific build these came from. Absent on logs predating the field. */
  buildId?: string;
  template?: string;
  engine?: string;
  data?: Record<string, unknown>;
}

/** The append-only observation log for one person. */
export interface PersonSignalLog {
  personId: string;
  firstSeen: string;
  lastSeen: string;
  count: number; // total ever received (may exceed signals.length once capped)
  signals: StoredSignal[];
}
