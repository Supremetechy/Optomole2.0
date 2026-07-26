import { Injectable } from '@nestjs/common';
import { SignalStore } from './signals.store';
import { StoredSignal } from './signal.types';
import { ExperimentStore, ExperimentRecord } from './experiment.store';
import { PersonGraphService } from './person-graph.service';

/**
 * ReflectionService — loop step #6, the eighth node. Closes AND reopens the loop.
 *
 * After a directed experience is played, the raw signals answer "what happened."
 * Reflection asks the harder questions from the design: did the hypothesis hold?
 * what surprised us? what is this person becoming? It scores each pending
 * experiment against the signals its experienceId produced, records the verdict,
 * and — crucially — feeds its conclusions BACK as new `reflection` signals, which
 * the graph fold turns into emergent `insight:*` identity nodes. So the output of
 * reflection becomes input to the next cycle: the loop never closes.
 *
 * Idempotent: only `pending` experiments that have actually been played are
 * scored; re-running skips already-scored ones (status != pending).
 */
@Injectable()
export class ReflectionService {
  constructor(
    private readonly signals: SignalStore,
    private readonly experiments: ExperimentStore,
    private readonly graph: PersonGraphService,
  ) {}

  reflect(personId: string) {
    const id = String(personId || '').trim();
    const pending = this.experiments.listForPerson(id).filter((e) => e.status === 'pending');
    const signals = this.signals.get(id)?.signals || [];

    const byExperience = new Map<string, StoredSignal[]>();
    for (const s of signals) {
      if (!s.experienceId || s.type === 'reflection') continue;
      const list = byExperience.get(s.experienceId) || [];
      list.push(s);
      byExperience.set(s.experienceId, list);
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const insights: ReflectionInsight[] = [];
    const emitted: StoredSignal[] = [];

    for (const exp of pending) {
      const plays = byExperience.get(exp.experienceId);
      if (!plays || !plays.length) continue; // not played yet → stay pending

      const eng = engagement(plays);
      const verdict = evaluate(exp, eng);
      this.experiments.update(exp.experienceId, { status: verdict.status });

      insights.push({
        experienceId: exp.experienceId,
        genre: exp.genre,
        mode: exp.mode,
        hypothesis: exp.hypothesis,
        outcome: verdict.status,
        engagement: eng.score,
        surprise: verdict.surprise,
        narrative: verdict.narrative,
      });

      emitted.push({
        type: 'reflection',
        ts: nowMs,
        receivedAt: nowIso,
        // Derived, not observed: reflection's conclusions re-enter the stream
        // as their own sensor so the graph can calibrate them separately from
        // the gameplay evidence they were drawn from.
        source: 'reflection',
        experienceId: exp.experienceId,
        template: exp.templateId,
        engine: 'reflection',
        data: { outcome: verdict.status, genre: exp.genre, insight: verdict.insight, weight: round(verdict.weight, 3) },
      });
    }

    // Feed conclusions back into the stream → graph → next directive.
    if (emitted.length) this.signals.append(id, emitted);

    // Summarize "who they're becoming" from the (now reflection-enriched) graph.
    const g = this.graph.build(id, {});
    const becoming = g.nodes
      .filter((n) => n.kind === 'insight' || n.level === 'emergent')
      .slice(0, 5)
      .map((n) => ({ label: n.label, confidence: n.confidence }));

    return {
      ok: true,
      personId: id,
      reflectedAt: nowIso,
      processed: insights.length,
      pendingUnplayed: pending.length - insights.length,
      insights,
      discoveries: insights.filter((i) => i.mode === 'explore' && i.outcome === 'confirmed').map((i) => i.genre),
      drifts: insights.filter((i) => i.surprise?.kind === 'drift').map((i) => i.genre),
      becoming,
      emittedSignals: emitted.length,
    };
  }
}

// --- scoring ------------------------------------------------------------------

interface Engagement { score: number; rooms: number; dwell: number; xp: number; abandoned: boolean }

function engagement(plays: StoredSignal[]): Engagement {
  const has = (t: string) => plays.some((p) => p.type === t);
  const se = (plays.find((p) => p.type === 'session_end')?.data || {}) as Record<string, unknown>;
  const rooms = num(se.roomsCleared) || plays.filter((p) => p.type === 'room_cleared').length;
  const dwell = num(se.durationMs);
  const xp = plays.filter((p) => p.type === 'xp_gain').reduce((a, p) => a + num(p.data?.amount), 0);
  const abandoned = rooms === 0 && dwell > 0 && dwell < 20_000;

  const score = abandoned
    ? 0.12
    : clamp(
        0.15 * (has('experience_start') ? 1 : 0) +
          0.4 * (rooms > 0 ? 1 : 0) +
          0.2 * Math.min(rooms / 2, 1) +
          0.15 * Math.min(dwell / 180_000, 1) +
          0.1 * Math.min(xp / 50, 1),
        0,
        1,
      );
  return { score: round(score, 3), rooms, dwell, xp, abandoned };
}

interface Verdict {
  status: 'confirmed' | 'refuted' | 'inconclusive';
  insight: string;
  weight: number;
  narrative: string;
  surprise: { kind: 'positive' | 'drift'; reason: string } | null;
}

function evaluate(exp: ExperimentRecord, eng: Engagement): Verdict {
  const g = exp.genre;
  const enjoyed = eng.score >= 0.5;

  if (exp.mode === 'explore') {
    if (enjoyed) {
      return {
        status: 'confirmed',
        insight: `Enjoys ${g}`,
        weight: eng.score,
        narrative: `Probed an untried genre and they engaged (score ${eng.score}) — a new affinity is now part of who they are.`,
        surprise: eng.score >= 0.75 ? { kind: 'positive', reason: `Unexpectedly strong affinity for a brand-new genre (${g}).` } : null,
      };
    }
    return {
      status: 'refuted',
      insight: `Does not enjoy ${g}`,
      weight: 0.6 * (1 - eng.score),
      narrative: `Probed ${g} and they disengaged (score ${eng.score}) — uncertainty resolved: not for them.`,
      surprise: null,
    };
  }

  // exploit — we predicted they'd enjoy a known preference
  if (enjoyed) {
    return {
      status: 'confirmed',
      insight: `${g} preference holds`,
      weight: 0.3,
      narrative: `Re-served a known favorite and they stayed engaged — the preference for ${g} still holds.`,
      surprise: null,
    };
  }
  return {
    status: 'refuted',
    insight: `Cooling on ${g}`,
    weight: 0.6,
    narrative: `Predicted enjoyment of a top preference (${g}) but they disengaged (score ${eng.score}) — the taste may be drifting.`,
    surprise: { kind: 'drift', reason: `A supposedly strong preference (${g}) underperformed — the model was overconfident.` },
  };
}

export interface ReflectionInsight {
  experienceId: string;
  genre: string;
  mode: 'explore' | 'exploit';
  hypothesis: string;
  outcome: 'confirmed' | 'refuted' | 'inconclusive';
  engagement: number;
  surprise: { kind: 'positive' | 'drift'; reason: string } | null;
  narrative: string;
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
function round(n: number, dp: number): number { const f = 10 ** dp; return Math.round(n * f) / f; }
