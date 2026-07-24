import { Injectable } from '@nestjs/common';
import { SignalStore } from './signals.store';
import { StoredSignal } from './signal.types';

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
 * Confidence model (per node):
 *   support   = Σ evidence_i.weight · decay(age_i)        // frequency × recency
 *   decay(a)  = 2 ^ (−ageDays / halfLifeDays)             // exponential, half-life
 *   confidence= support / (support + K)                   // saturating, 0..1
 * K is the support that yields 0.5 confidence; larger K = more skeptical.
 *
 * Nodes are typed by the five depth levels from the design:
 *   explicit | behavioral | contextual | relational | emergent
 * (explicit comes from uploaded profile data, not signals, so none appear here yet.)
 */
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
      if (weight <= 0) return;
      const node = nodes.get(spec.id) || newNode(spec);
      const recency = decay(signal.ts);
      node.support += weight * recency;
      node.frequency += 1;
      node.firstSeen = node.firstSeen ? Math.min(node.firstSeen, signal.ts) : signal.ts;
      node.lastSeen = Math.max(node.lastSeen, signal.ts);
      if (node.evidence.length < 20) {
        node.evidence.push({ type: signal.type, ts: signal.ts, weight: round(weight * recency, 4) });
      }
      if (spec.label && !node.label) node.label = spec.label;
      nodes.set(spec.id, node);
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
      confidence: round(node.support / (node.support + K), 4),
      support: round(node.support, 4),
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
      params: { halfLifeDays, k: K },
      stats: {
        signalCount: signals.length,
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
export interface Evidence { type: string; ts: number; weight: number }
interface GraphNode { id: string; level: Level; kind?: string; label?: string; support: number; frequency: number; firstSeen: number; lastSeen: number; evidence: Evidence[] }
export interface PersonGraphNode { id: string; level: Level; kind?: string; label: string; confidence: number; support: number; frequency: number; firstSeen: string | null; lastSeen: string | null; evidence: Evidence[] }
export interface PersonGraphEdge { from: string; to: string; relation: string; confidence: number }
export interface PersonGraph {
  personId: string;
  asOf: string;
  params: { halfLifeDays: number; k: number };
  stats: { signalCount: number; sessionCount: number; nodeCount: number; edgeCount: number };
  nodes: PersonGraphNode[];
  edges: PersonGraphEdge[];
}

function newNode(spec: NodeSpec): GraphNode {
  return { id: spec.id, level: spec.level, kind: spec.kind, label: spec.label, support: 0, frequency: 0, firstSeen: 0, lastSeen: 0, evidence: [] };
}

function emergentNode(id: string, label: string, confidence: number, asOf: number, kind: string): PersonGraphNode {
  const c = round(clamp(confidence, 0, 1), 4);
  return { id, level: 'emergent', kind, label, confidence: c, support: c, frequency: 1, firstSeen: null, lastSeen: new Date(asOf).toISOString(), evidence: [] };
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
