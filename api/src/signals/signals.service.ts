import { BadRequestException, Injectable } from '@nestjs/common';
import { SignalStore } from './signals.store';
import {
  DEFAULT_SIGNAL_SOURCE,
  IncomingSignal,
  PersonSignalLog,
  SIGNAL_SOURCES,
  SignalBatch,
  SignalSource,
  StoredSignal,
  isSignalSource,
} from './signal.types';

/**
 * SignalsService — normalizes and persists observation batches.
 *
 * Normalization keeps the stream cheap and safe: batches and per-signal payloads
 * are clamped, types coerced to strings, and each signal is stamped with server
 * receive time, the session/experience context from the batch envelope, and the
 * sensor that produced it. The heavy interpretation (confidence, decay,
 * uncertainty) belongs to later layers; this service's only job is to accept the
 * stream reliably and label it correctly.
 */
@Injectable()
export class SignalsService {
  /** Cap a single POST so a runaway client can't dump an unbounded batch. */
  private static readonly MAX_BATCH = 500;
  /** Cap serialized per-signal payload size (defensive). */
  private static readonly MAX_DATA_KEYS = 24;

  constructor(private readonly store: SignalStore) {}

  ingest(
    personId: string,
    batch: SignalBatch,
  ): { personId: string; accepted: number; source: SignalSource; total: number } {
    const id = String(personId || '').trim();
    if (!id) throw new BadRequestException('personId is required.');
    if (!batch || !Array.isArray(batch.signals)) {
      throw new BadRequestException('Body must include a `signals` array.');
    }

    const source = this.resolveSource(batch.source);
    const receivedAt = new Date().toISOString();
    const normalized = batch.signals
      .slice(0, SignalsService.MAX_BATCH)
      .map((signal) => this.normalize(signal, batch, receivedAt, source))
      .filter((signal): signal is StoredSignal => signal !== null);

    const log = this.store.append(id, normalized);
    return { personId: id, accepted: normalized.length, source, total: log.count };
  }

  read(personId: string): PersonSignalLog {
    const id = String(personId || '').trim();
    return (
      this.store.get(id) || { personId: id, firstSeen: '', lastSeen: '', count: 0, signals: [] }
    );
  }

  persons(): Array<{ personId: string; count: number; lastSeen: string }> {
    return this.store.listPersons();
  }

  /**
   * An omitted source means `runtime` — that is what every producer predating
   * this field was. An *unrecognized* source is rejected rather than coerced:
   * a sensor with no calibration entry would otherwise enter the graph
   * weighted as gameplay telemetry, which is the exact failure this field
   * exists to prevent. Adding a sensor is a code change on purpose.
   */
  private resolveSource(source: unknown): SignalSource {
    if (source === undefined || source === null || source === '') return DEFAULT_SIGNAL_SOURCE;
    if (!isSignalSource(source)) {
      throw new BadRequestException(
        `Unknown signal source '${String(source)}'. Expected one of: ${SIGNAL_SOURCES.join(', ')}.`,
      );
    }
    return source;
  }

  private normalize(
    signal: IncomingSignal,
    batch: SignalBatch,
    receivedAt: string,
    source: SignalSource,
  ): StoredSignal | null {
    const type = String(signal?.type || '').trim();
    if (!type) return null;
    const ts = Number.isFinite(signal?.ts) ? Number(signal.ts) : Date.parse(receivedAt);

    let data: Record<string, unknown> | undefined;
    if (signal?.data && typeof signal.data === 'object') {
      data = {};
      for (const [key, val] of Object.entries(signal.data).slice(0, SignalsService.MAX_DATA_KEYS)) {
        // Keep only JSON-primitive-ish values; drop nested blobs to stay cheap.
        if (val === null || ['string', 'number', 'boolean'].includes(typeof val)) data[key] = val;
      }
    }

    return {
      type,
      ts,
      receivedAt,
      source,
      sessionId: batch.sessionId ? String(batch.sessionId) : undefined,
      experienceId: batch.experienceId ? String(batch.experienceId) : undefined,
      buildId: batch.buildId ? String(batch.buildId) : undefined,
      template: batch.template ? String(batch.template) : undefined,
      engine: batch.engine ? String(batch.engine) : undefined,
      ...(data && Object.keys(data).length ? { data } : {}),
    };
  }
}
