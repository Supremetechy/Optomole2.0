import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';
import { PersonSignalLog, StoredSignal } from './signal.types';

/**
 * SignalStore — append-only persistence for player observation signals, one JSON
 * log per person under `signalStorePath`. Mirrors AccountStore's local-file +
 * in-memory Map pattern so it can be swapped for a real time-series/event store
 * later without touching SignalsService.
 *
 * The retained window is capped (RETAIN) so a long-running Person's file stays
 * bounded; `count` still reflects the true lifetime total. The World Model layer
 * (#4) will consume the recent window plus aggregates derived at ingest time.
 */
@Injectable()
export class SignalStore {
  private readonly logs = new Map<string, PersonSignalLog>();
  private hydrated = false;

  /** Keep at most this many recent signals per person on disk/in memory. */
  private static readonly RETAIN = 5000;

  append(personId: string, incoming: StoredSignal[]): PersonSignalLog {
    this.hydrate();
    const now = new Date().toISOString();
    const existing = this.logs.get(personId);
    const log: PersonSignalLog = existing || { personId, firstSeen: now, lastSeen: now, count: 0, signals: [] };

    log.signals.push(...incoming);
    if (log.signals.length > SignalStore.RETAIN) {
      log.signals = log.signals.slice(log.signals.length - SignalStore.RETAIN);
    }
    log.count += incoming.length;
    log.lastSeen = now;

    this.logs.set(personId, log);
    this.writeFile(log);
    return log;
  }

  get(personId: string): PersonSignalLog | null {
    this.hydrate();
    return this.logs.get(personId) || null;
  }

  listPersons(): Array<{ personId: string; count: number; lastSeen: string }> {
    this.hydrate();
    return [...this.logs.values()]
      .map(({ personId, count, lastSeen }) => ({ personId, count, lastSeen }))
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  // --- local file backend (mirrors AccountStore) -------------------------

  private root(): string {
    return path.resolve(process.cwd(), gatewayConfig().signalStorePath);
  }

  private filePath(personId: string): string {
    const safe = Buffer.from(personId).toString('base64url');
    return path.join(this.root(), `${safe}.json`);
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const dir = this.root();
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const log = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as PersonSignalLog;
        if (log?.personId) this.logs.set(log.personId, log);
      } catch {
        // Skip corrupt logs rather than failing ingestion for every person.
      }
    }
  }

  private writeFile(log: PersonSignalLog): void {
    const dir = this.root();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath(log.personId), JSON.stringify(log, null, 2), 'utf8');
  }
}
