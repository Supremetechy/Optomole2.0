/**
 * Signal types — the observation stream emitted by the playable runtime.
 *
 * This is the return edge of the Experience Engine loop: every interaction the
 * player makes in a generated game becomes an observation about the person. The
 * World Model and Reflection layers (steps #3-#6) consume this accumulating
 * stream; for now the slice just captures and persists it.
 */

/** One observation as sent by the browser-engine SignalEmitter. */
export interface IncomingSignal {
  type: string;
  ts?: number; // client event time (epoch ms)
  data?: Record<string, unknown>;
}

/** A batch of observations posted for a single play session. */
export interface SignalBatch {
  sessionId?: string;
  experienceId?: string;
  template?: string;
  engine?: string;
  signals: IncomingSignal[];
}

/** A normalized, persisted observation. */
export interface StoredSignal {
  type: string;
  ts: number;
  receivedAt: string; // server ISO time
  sessionId?: string;
  experienceId?: string;
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
