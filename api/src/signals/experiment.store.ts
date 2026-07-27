import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';

/**
 * An experiment: an experience generated to TEST a World Model hypothesis. This
 * is what makes the loop self-directed rather than merely recursive — each build
 * remembers what it was trying to learn, so Reflection (#6) can score it against
 * the signals that experience later produces.
 */
export interface ExperimentRecord {
  experienceId: string;
  buildId: string;
  personId: string;
  createdAt: string;
  hypothesis: string;
  mode: 'explore' | 'exploit';
  genre: string;
  templateId?: string;
  topicFocus?: string | null;
  rationale: string;
  steered: boolean; // false if the caller pinned a genre and the model didn't steer
  status: 'pending' | 'confirmed' | 'refuted' | 'inconclusive'; // #6 updates this
}

/**
 * ExperimentStore — per-person append log of experiments, mirroring SignalStore's
 * local-file + in-memory pattern. Also indexed by buildId so Reflection can
 * resolve "which hypothesis did this play session test?" from a signal's buildId.
 *
 * The index is keyed by buildId and NOT by experienceId, which is a slug of the
 * source title: two experiments run against the same content (or against any two
 * untitled sessions) share an experienceId, so an experienceId-keyed index
 * silently dropped the earlier experiment and pointed its signals at the later
 * one's hypothesis. buildId is unique per compile, so every experiment survives
 * and is scored against the plays that actually belong to it.
 */
@Injectable()
export class ExperimentStore {
  private readonly byPerson = new Map<string, ExperimentRecord[]>();
  private readonly byBuild = new Map<string, ExperimentRecord>();
  private hydrated = false;

  record(exp: ExperimentRecord): ExperimentRecord {
    this.hydrate();
    const list = this.byPerson.get(exp.personId) || [];
    list.unshift(exp);
    this.byPerson.set(exp.personId, list);
    this.byBuild.set(exp.buildId, exp);
    this.writeFile(exp.personId, list);
    return exp;
  }

  listForPerson(personId: string): ExperimentRecord[] {
    this.hydrate();
    return this.byPerson.get(personId) || [];
  }

  /** The experiment a specific playable was built to test. */
  findByBuild(buildId: string): ExperimentRecord | null {
    this.hydrate();
    return this.byBuild.get(buildId) || null;
  }

  /** Update an experiment in place (e.g. Reflection setting its scored status). */
  update(buildId: string, patch: Partial<ExperimentRecord>): ExperimentRecord | null {
    this.hydrate();
    const exp = this.byBuild.get(buildId);
    if (!exp) return null;
    Object.assign(exp, patch); // byPerson holds the same object reference
    this.writeFile(exp.personId, this.byPerson.get(exp.personId) || []);
    return exp;
  }

  // --- local file backend (mirrors SignalStore) --------------------------

  private root(): string {
    return path.resolve(process.cwd(), gatewayConfig().experimentStorePath);
  }

  private filePath(personId: string): string {
    return path.join(this.root(), `${Buffer.from(personId).toString('base64url')}.json`);
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const dir = this.root();
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const list = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as ExperimentRecord[];
        if (Array.isArray(list) && list[0]?.personId) {
          this.byPerson.set(list[0].personId, list);
          // Ledgers on disk already carry buildId (it has always been part of the
          // record), so re-keying the index needs no migration.
          for (const exp of list) if (exp.buildId) this.byBuild.set(exp.buildId, exp);
        }
      } catch {
        // Skip corrupt ledgers rather than failing every experiment.
      }
    }
  }

  private writeFile(personId: string, list: ExperimentRecord[]): void {
    const dir = this.root();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath(personId), JSON.stringify(list, null, 2), 'utf8');
  }
}