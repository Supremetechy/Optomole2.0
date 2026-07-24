import { BadRequestException, Injectable } from '@nestjs/common';
import { SignalStore } from './signals.store';
import { IncomingSignal, PersonSignalLog, SignalBatch, StoredSignal } from './signal.types';

/**
 * SignalsService — normalizes and persists observation batches from the runtime.
 *
 * Normalization keeps the stream cheap and safe: batches and per-signal payloads
 * are clamped, types coerced to strings, and each signal is stamped with server
 * receive time and the session/experience context from the batch envelope. The
 * heavy interpretation (confidence, decay, uncertainty) belongs to later layers;
 * this service's only job is to accept the stream reliably.
 */
@Injectable()
export class SignalsService {
  /** Cap a single POST so a runaway client can't dump an unbounded batch. */
  private static readonly MAX_BATCH = 500;
  /** Cap serialized per-signal payload size (defensive). */
  private static readonly MAX_DATA_KEYS = 24;

  constructor(private readonly store: SignalStore) {}

  ingest(personId: string, batch: SignalBatch): { personId: string; accepted: number; total: number } {
    const id = String(personId || '').trim();
    if (!id) throw new BadRequestException('personId is required.');
    if (!batch || !Array.isArray(batch.signals)) {
      throw new BadRequestException('Body must include a `signals` array.');
    }

    const receivedAt = new Date().toISOString();
    const normalized = batch.signals
      .slice(0, SignalsService.MAX_BATCH)
      .map((signal) => this.normalize(signal, batch, receivedAt))
      .filter((signal): signal is StoredSignal => signal !== null);

    const log = this.store.append(id, normalized);
    return { personId: id, accepted: normalized.length, total: log.count };
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

  private normalize(signal: IncomingSignal, batch: SignalBatch, receivedAt: string): StoredSignal | null {
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
      sessionId: batch.sessionId ? String(batch.sessionId) : undefined,
      experienceId: batch.experienceId ? String(batch.experienceId) : undefined,
      template: batch.template ? String(batch.template) : undefined,
      engine: batch.engine ? String(batch.engine) : undefined,
      ...(data && Object.keys(data).length ? { data } : {}),
    };
  }
}
