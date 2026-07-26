import { Injectable } from '@nestjs/common';
import { SignalStore } from './signals.store';
import { SIGNAL_SOURCES, SignalSource, StoredSignal, sourceOf } from './signal.types';

/**
 * PersonGraphService — folds a person's observation stream into a compounding,
 * confidence-weighted, time-decaying identity graph (loop step #3).
 *
 * Design: the signal log (SignalStore) is the event-sourced source of truth; this
 * graph is a deterministic **materialized view** computed on demand. That is what
 * makes "memory decays unless reinforced" fall out for free — a node's confidence
 * is a function of its evidence weighted by recency, evaluated at `asOf`. Replay
 * the same signals → identical graph; add signals → the graph compounds.
 *
 * Confidence model (per node, per sensor):
 *   support_s = Σ evidence_i.weight · sourceWeight_s · decay(age_i)
 *   decay(a)  = 2 ^ (−ageDays / halfLifeDays)             // exponential, half-life
 *   c_s       = support_s / (support_s + K · kMultiplier_s)   // saturating, 0..1
 *   confidence= 1 − Π_s (1 − c_s)                         // noisy-OR across sensors
 * K is the support that yields 0.5 confidence; larger K = more skeptical.
 *
 * Nodes are typed by the five depth levels from the design:
 *   explicit | behavioral | contextual | relational | emergent
 * (explicit comes from uploaded profile data, not signals, so none appear here yet.)
 */

/**
 * Per-sensor calibration — the thing that keeps one stream from becoming one
 * sensor's opinion.
 *
 * Two independent knobs, because volume and informativeness are different
 * problems:
 *
 *   weight       how much one observation from this sensor tells us. A choice
 *                made inside a game is a deliberate act; a shipping
 *                confirmation landing in a mailbox is mostly not about the
 *                person at all.
 *   kMultiplier  volume normalization. Confidence saturates at `support ≈ K`,
 *                so a sensor emitting ~25× more evidence needs ~25× more of it
 *                to claim the same belief. Without this, the noisiest sensor
 *                reaches certainty first and every distribution the World Model
 *                samples is really a readout of emission rate.
 *
 * Confidences combine by noisy-OR, so sensors *corroborate* rather than
 * outvote: two weak agreeing sources beat one, and no single source can drag a
 * belief down. Crucially, a graph built from one sensor collapses to exactly
 * `support / (support + K)` — the original model — so existing graphs are
 * unchanged, bit for bit.
 *
 * These numbers are estimates, not measurements. Revisit them once real inbox
 * volume exists; `stats.signalsBySource` on every graph is there to make the
 * true ratio observable rather than assumed.
 */
export interface SourceCalibration {
  weight: number;
  kMultiplier: number;
}

const SOURCE_CALIBRATION: Record<SignalSource, SourceCalibration> = {
  // The reference sensor. Deliberate acts, low volume — calibration is 1:1 by
  // definition, and every other sensor is expressed relative to it.
  runtime: { weight: 1, kMultiplier: 1 },
  // Derived conclusions from ReflectionService (#6), already deliberately
  // weighted by how strongly an experiment confirmed its hypothesis. Emitted
  // at most once per played experience, so no volume correction.
  reflection: { weight: 1, kMultiplier: 1 },
  // High volume, mostly incidental: most mail is machine-generated and says
  // more about who mails this person than who they are.
  inbox: { weight: 0.4, kMultiplier: 25 },
  // Fewer, more intentional events than mail — someone chose to book them —
  // but still not the person acting on the thing.
  calendar: { weight: 0.6, kMultiplier: 8 },
};
@Injectable()
export class PersonGraphService {
  constructor(private readonly store: SignalStore) {}

  private static readonly DAY_MS = 86_400_000;

  build(personId: string, opts: { asOf?: number; halfLifeDays?: number; k?: number } = {}): PersonGraph {
    const id = String(personId || '').trim();
    const asOf = Number.isFinite(opts.asOf) ? Number(opts.asOf) : Date.now();
    const halfLifeDays = opts.halfLifeDays && opts.halfLifeDays > 0 ? opts.halfLifeDays : 30;
    const K = opts.k && opts.k > 0 ? opts.k : 3;

    const log = this.store.get(id);
    const signals = log?.signals || [];

    const nodes = new Map<string, GraphNode>();
    const experienceCounts = new Map<string, number>(); // experienceId -> plays (for replay/persistence)

    const decay = (ts: number) => {
      const ageDays = Math.max(0, (asOf - (ts || asOf)) / PersonGraphService.DAY_MS);
      return 2 ** (-ageDays / halfLifeDays);
    };

    const reinforce = (spec: NodeSpec, signal: StoredSignal, weight: number) => {
      const source = sourceOf(signal);
      // Evidence is scaled by its sensor before it ever reaches a node, so a
      // node's support is always in one comparable unit.
      const calibrated = weight * SOURCE_CALIBRATION[source].weight;
      if (calibrated <= 0) return;
      const node = nodes.get(spec.id) || newNode(spec);
      const recency = decay(signal.ts);
      const contribution = calibrated * recency;
      node.support += contribution;
      node.bySource.set(source, (node.bySource.get(source) || 0) + contribution);
      node.frequency += 1;
      node.firstSeen = node.firstSeen ? Math.min(node.firstSeen, signal.ts) : signal.ts;
      node.lastSeen = Math.max(node.lastSeen, signal.ts);
      if (node.evidence.length < 20) {
        node.evidence.push({ type: signal.type, ts: signal.ts, source, weight: round(contribution, 4) });
      }
      if (spec.label && !node.label) node.label = spec.label;
      nodes.set(spec.id, node);
    };

    const kFor = (source: SignalSource) => K * SOURCE_CALIBRATION[source].kMultiplier;

    /**
     * Noisy-OR over independently-saturating sensors.
     *
     * The single-sensor case returns `support / (support + k)` directly rather
     * than as `1 − (1 − c)`. Both agree on today's data to the 4dp the graph
     * publishes — that was measured, not assumed — but the direct form is the
     * original expression rather than a round-trip through two subtractions,
     * so single-sensor graphs are identical by construction and not by luck.
     * Every graph on disk today has exactly one sensor.
     *
     * The multi-sensor case accumulates in log space: once several weak
     * sensors are involved, the complement product tends to 1 and `expm1`
     * keeps precision in the regime where plain subtraction loses it.
     */
    const confidenceOf = (bySource: Map<SignalSource, number>): number => {
      const entries = [...bySource];
      if (entries.length === 0) return 0;
      if (entries.length === 1) {
        const [source, support] = entries[0];
        return support / (support + kFor(source));
      }
      let logComplement = 0;
      for (const [source, support] of entries) {
        const k = kFor(source);
        logComplement += Math.log(k) - Math.log(support + k);
      }
      return -Math.expm1(logComplement);
    };

    for (const signal of signals) {
      const genre = normalizeGenre(signal.template);
      switch (signal.type) {
        case 'experience_start': {
          if (genre) reinforce({ id: `engaged:genre:${genre}`, level: 'behavioral', label: genre, kind: 'genre' }, signal, 1.0);
          if (signal.experienceId) {
            const plays = (experienceCounts.get(signal.experienceId) || 0) + 1;
            experienceCounts.set(signal.experienceId, plays);
            // Second+ start of the same experience is a replay → persistence trait.
            if (plays >= 2) reinforce({ id: 'trait:persistent', level: 'behavioral', label: 'Persistent (replays)' }, signal, 0.7);
          }
          reinforce(activeContext(signal.ts, asOf), signal, 0.25);
          break;
        }
        case 'key_collected': {
          const label = str(signal.data?.label) || str(signal.data?.keyId) || 'unknown';
          reinforce({ id: `interest:${slug(label)}`, level: 'relational', label, kind: 'topic' }, signal, 1.5);
          reinforce({ id: 'trait:collector', level: 'behavioral', label: 'Collector' }, signal, 0.4);
          break;
        }
        case 'room_cleared': {
          reinforce({ id: 'trait:progresses', level: 'behavioral', label: 'Steady progress' }, signal, 0.6);
          if (genre) reinforce({ id: `mastery:genre:${genre}`, level: 'emergent', label: genre, kind: 'mastery' }, signal, 0.5);
          break;
        }
        case 'focus_damage': {
          const amount = num(signal.data?.amount);
          reinforce({ id: 'trait:risk-taking', level: 'behavioral', label: 'Takes risks' }, signal, clamp(amount / 20, 0.2, 1) * 0.6);
          break;
        }
        case 'xp_gain': {
          if (genre) reinforce({ id: `mastery:genre:${genre}`, level: 'emergent', label: genre, kind: 'mastery' }, signal, clamp(num(signal.data?.amount) / 40, 0.1, 1) * 0.5);
          break;
        }
        case 'level_up': {
          if (genre) reinforce({ id: `mastery:genre:${genre}`, level: 'emergent', label: genre, kind: 'mastery' }, signal, 0.8);
          break;
        }
        case 'session_end': {
          const rooms = num(signal.data?.roomsCleared);
          const durationMs = num(signal.data?.durationMs);
          if (rooms > 0) reinforce({ id: 'trait:finisher', level: 'behavioral', label: 'Finishes what they start' }, signal, clamp(rooms, 1, 5) * 0.4);
          else if (durationMs > 0 && durationMs < 20_000) reinforce({ id: 'trait:sampler', level: 'behavioral', label: 'Samples then leaves' }, signal, 0.5);
          if (durationMs > 0) reinforce(paceContext(durationMs), signal, 0.3);
          break;
        }
        case 'reflection': {
          // Reflection (#6) feeds its conclusions back as first-class emergent
          // nodes — "who the person is becoming." Weight is set by how strongly
          // the experiment confirmed/refuted its hypothesis.
          const label = str(signal.data?.insight) || 'insight';
          reinforce({ id: `insight:${slug(label)}`, level: 'emergent', label, kind: 'insight' }, signal, num(signal.data?.weight) || 0.4);
          break;
        }
        default:
          break; // 'log', 'room_enter', unknown → not modeled at this layer
      }
    }

    // Finalize confidence and split off derived (emergent) insights.
    const finalized = [...nodes.values()].map((node) => ({
      id: node.id,
      level: node.level,
      kind: node.kind,
      label: node.label || node.id,
      confidence: round(confidenceOf(node.bySource), 4),
      support: round(node.support, 4),
      // Which sensors built this belief, so a node's provenance is inspectable
      // rather than inferred from its label.
      bySource: sourceBreakdown(node.bySource),
      frequency: node.frequency,
      firstSeen: node.firstSeen ? new Date(node.firstSeen).toISOString() : null,
      lastSeen: node.lastSeen ? new Date(node.lastSeen).toISOString() : null,
      evidence: node.evidence,
    }));

    const emergent = this.deriveEmergent(finalized, asOf);
    const allNodes = [...finalized, ...emergent].sort((a, b) => b.confidence - a.confidence);
    const edges = allNodes.map((n) => ({ from: 'person', to: n.id, relation: relationFor(n.level), confidence: n.confidence }));

    return {
      personId: id,
      asOf: new Date(asOf).toISOString(),
      params: { halfLifeDays, k: K, sourceCalibration: SOURCE_CALIBRATION },
      stats: {
        signalCount: signals.length,
        // Received per sensor — including sensors whose types this fold does
        // not model yet. A sensor delivering thousands of signals that produce
        // zero nodes is a wiring gap, and it should be visible here rather
        // than looking like an absence of data.
        signalsBySource: countBySource(signals),
        sessionCount: experienceCounts.size,
        nodeCount: allNodes.length,
        edgeCount: edges.length,
      },
      nodes: allNodes,
      edges,
    };
  }

  /**
   * Level-5 emergent patterns — not observed directly, inferred from the folded
   * graph: preferred genre, engagement profile (explorer vs specialist), and
   * completion tendency (finisher vs sampler net).
   */
  private deriveEmergent(nodes: PersonGraphNode[], asOf: number): PersonGraphNode[] {
    const out: PersonGraphNode[] = [];
    const genres = nodes.filter((n) => n.kind === 'genre').sort((a, b) => b.confidence - a.confidence);
    if (genres.length) {
      const top = genres[0];
      const second = genres[1]?.confidence || 0;
      out.push(emergentNode(`prefers:genre:${slug(top.label)}`, `Prefers ${top.label}`, top.confidence * (1 - second), asOf, 'preference'));
      if (genres.filter((g) => g.confidence >= 0.4).length >= 3) {
        out.push(emergentNode('profile:explorer', 'Explorer (broad genre range)', clamp(genres.length / 5, 0, 1), asOf, 'profile'));
      } else if (top.confidence >= 0.5 && second < top.confidence * 0.5) {
        out.push(emergentNode('profile:specialist', `Specialist (${top.label})`, top.confidence, asOf, 'profile'));
      }
    }
    const finisher = nodes.find((n) => n.id === 'trait:finisher')?.confidence || 0;
    const sampler = nodes.find((n) => n.id === 'trait:sampler')?.confidence || 0;
    if (finisher || sampler) {
      const net = finisher - sampler;
      out.push(emergentNode(
        net >= 0 ? 'tendency:completionist' : 'tendency:browser',
        net >= 0 ? 'Completionist' : 'Browser (rarely finishes)',
        Math.abs(net),
        asOf,
        'tendency',
      ));
    }
    return out;
  }
}

// --- internal types + helpers -------------------------------------------------

export type Level = 'explicit' | 'behavioral' | 'contextual' | 'relational' | 'emergent';
interface NodeSpec { id: string; level: Level; label?: string; kind?: string }
export interface Evidence { type: string; ts: number; source: SignalSource; weight: number }
/** Calibrated support per sensor; sensors that contributed nothing are omitted. */
export type SourceBreakdown = Partial<Record<SignalSource, number>>;
interface GraphNode { id: string; level: Level; kind?: string; label?: string; support: number; bySource: Map<SignalSource, number>; frequency: number; firstSeen: number; lastSeen: number; evidence: Evidence[] }
export interface PersonGraphNode { id: string; level: Level; kind?: string; label: string; confidence: number; support: number; bySource: SourceBreakdown; frequency: number; firstSeen: string | null; lastSeen: string | null; evidence: Evidence[] }
export interface PersonGraphEdge { from: string; to: string; relation: string; confidence: number }
export interface PersonGraph {
  personId: string;
  asOf: string;
  params: { halfLifeDays: number; k: number; sourceCalibration: Record<SignalSource, SourceCalibration> };
  stats: {
    signalCount: number;
    signalsBySource: SourceBreakdown;
    sessionCount: number;
    nodeCount: number;
    edgeCount: number;
  };
  nodes: PersonGraphNode[];
  edges: PersonGraphEdge[];
}

function newNode(spec: NodeSpec): GraphNode {
  return { id: spec.id, level: spec.level, kind: spec.kind, label: spec.label, support: 0, bySource: new Map(), frequency: 0, firstSeen: 0, lastSeen: 0, evidence: [] };
}

function emergentNode(id: string, label: string, confidence: number, asOf: number, kind: string): PersonGraphNode {
  const c = round(clamp(confidence, 0, 1), 4);
  // Derived from the folded graph rather than from evidence, so it has no
  // sensor of its own — its provenance is whatever built the nodes beneath it.
  return { id, level: 'emergent', kind, label, confidence: c, support: c, bySource: {}, frequency: 1, firstSeen: null, lastSeen: new Date(asOf).toISOString(), evidence: [] };
}

function sourceBreakdown(bySource: Map<SignalSource, number>): SourceBreakdown {
  const out: SourceBreakdown = {};
  for (const [source, support] of bySource) out[source] = round(support, 4);
  return out;
}

function countBySource(signals: StoredSignal[]): SourceBreakdown {
  const out: SourceBreakdown = {};
  for (const signal of signals) {
    const source = sourceOf(signal);
    out[source] = (out[source] || 0) + 1;
  }
  // Stable key order for readable diffs between two graph reads.
  return Object.fromEntries(
    SIGNAL_SOURCES.filter((s) => out[s] !== undefined).map((s) => [s, out[s]]),
  ) as SourceBreakdown;
}

function activeContext(ts: number, asOf: number): NodeSpec {
  const hour = new Date(ts || asOf).getHours();
  const part = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return { id: `context:active:${part}`, level: 'contextual', label: `Active in the ${part}` };
}

function paceContext(durationMs: number): NodeSpec {
  const pace = durationMs < 60_000 ? 'fast' : durationMs < 240_000 ? 'measured' : 'deliberate';
  return { id: `context:pace:${pace}`, level: 'contextual', label: `${cap(pace)} pace` };
}

function relationFor(level: Level): string {
  return level === 'relational' ? 'engages_with' : level === 'contextual' ? 'in_context' : level === 'emergent' ? 'is_becoming' : 'exhibits';
}

function normalizeGenre(template?: string): string | null {
  if (!template) return null;
  return String(template).replace(/\.v\d+$/i, '').trim() || null;
}

function slug(s: string): string { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'x'; }
function str(v: unknown): string { return v == null ? '' : String(v); }
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
function round(n: number, dp: number): number { const f = 10 ** dp; return Math.round(n * f) / f; }
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
