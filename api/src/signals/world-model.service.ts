import { Injectable } from '@nestjs/common';
import { PersonGraphService, PersonGraph, PersonGraphNode } from './person-graph.service';
import { TemplatesService } from '../templates/templates.service';

/**
 * WorldModelService — loop step #4. Turns the descriptive identity graph (#3) into
 * a predictive, generative model of the person, and — most importantly — always
 * exposes a non-empty **uncertainty set**: what the system does not yet know.
 *
 * The organizing principle of the whole engine: the system should always hold
 * something it is uncertain about the user, and every experience should either
 * reinforce existing understanding or reduce that uncertainty. This service is
 * where that principle becomes machinery — it produces the uncertainty the
 * Experience Engine (#5) is then obligated to probe.
 *
 * It answers three things:
 *   predictions      — normalized distributions the engine can sample (genre,
 *                      topic, completion, engagement style)
 *   uncertaintySet   — ranked list of what's unknown: forming beliefs (~0.5),
 *                      unexplored options (never observed), stale beliefs (decayed)
 *   recommendation   — an explore-vs-exploit directive + hypothesis for the NEXT
 *                      experience, ready to drop into the compiler's options
 */
@Injectable()
export class WorldModelService {
  constructor(
    private readonly graph: PersonGraphService,
    private readonly templates: TemplatesService,
  ) {}

  private static readonly DAY_MS = 86_400_000;

  build(personId: string, opts: { asOf?: number; halfLifeDays?: number; k?: number } = {}): WorldModel {
    const g = this.graph.build(personId, opts);
    const asOfMs = Date.parse(g.asOf) || Date.now();
    const halfLifeDays = g.params.halfLifeDays;
    const knownGenres = this.knownGenres();

    const genrePreference = this.genreDistribution(g.nodes);
    const predictions: Predictions = {
      genrePreference,
      topicAffinity: this.topicDistribution(g.nodes),
      completionProbability: this.completion(g.nodes),
      engagementProfile: this.profile(g.nodes),
    };

    const uncertaintySet = this.uncertaintySet(g, knownGenres, asOfMs, halfLifeDays);
    const recommendation = this.recommend(genrePreference, uncertaintySet, knownGenres);

    return {
      personId: g.personId,
      asOf: g.asOf,
      modelConfidence: this.modelConfidence(g),
      predictions,
      uncertaintySet,
      recommendation,
      // "Who they're becoming" — the emergent/insight nodes, surfaced for UIs.
      becoming: g.nodes
        .filter((n) => n.kind === 'insight' || n.level === 'emergent')
        .slice(0, 5)
        .map((n) => ({ label: n.label, confidence: n.confidence })),
      basis: { signalCount: g.stats.signalCount, graphNodes: g.stats.nodeCount },
    };
  }

  // --- predictions -----------------------------------------------------------

  private genreDistribution(nodes: PersonGraphNode[]): Prediction[] {
    const gs = nodes.filter((n) => n.id.startsWith('engaged:genre:'));
    const sum = gs.reduce((a, n) => a + n.confidence, 0) || 1;
    return gs
      .map((n) => ({ value: n.label, probability: round(n.confidence / sum, 4), confidence: n.confidence }))
      .sort((a, b) => b.probability - a.probability);
  }

  private topicDistribution(nodes: PersonGraphNode[]): Prediction[] {
    const ts = nodes.filter((n) => n.id.startsWith('interest:')).sort((a, b) => b.confidence - a.confidence).slice(0, 8);
    const sum = ts.reduce((a, n) => a + n.confidence, 0) || 1;
    return ts.map((n) => ({ value: n.label, probability: round(n.confidence / sum, 4), confidence: n.confidence }));
  }

  private completion(nodes: PersonGraphNode[]): { probability: number; confidence: number } {
    const cf = conf(nodes, 'trait:finisher');
    const cs = conf(nodes, 'trait:sampler');
    return { probability: round(clamp(0.5 + 0.5 * (cf - cs), 0, 1), 4), confidence: round(Math.max(cf, cs), 4) };
  }

  private profile(nodes: PersonGraphNode[]): { style: string; confidence: number } {
    const explorer = conf(nodes, 'profile:explorer');
    const specialist = nodes.find((n) => n.id === 'profile:specialist')?.confidence || 0;
    if (explorer >= specialist && explorer > 0) return { style: 'explorer', confidence: round(explorer, 4) };
    if (specialist > 0) return { style: 'specialist', confidence: round(specialist, 4) };
    return { style: 'unknown', confidence: 0 };
  }

  // --- uncertainty (the point of this layer) ---------------------------------

  /**
   * Always returns at least one item. Three kinds, ranked by an `uncertainty`
   * score (0..1) = how much the model does NOT know about that dimension:
   *   forming    — belief in the ambiguous middle; ambiguity = 4·c·(1−c), peaks at 0.5
   *   unexplored — a buildable genre never observed; near-max, boosted if adjacent
   *                to a genre the person already likes (high-info, likely-enjoyed)
   *   stale      — a once-real belief whose evidence has decayed past the half-life
   */
  private uncertaintySet(
    g: PersonGraph,
    knownGenres: KnownGenre[],
    asOfMs: number,
    halfLifeDays: number,
  ): UncertaintyItem[] {
    const items: UncertaintyItem[] = [];

    // forming beliefs
    for (const n of g.nodes) {
      if (n.level === 'emergent') continue; // emergent are summaries, not probes
      if (n.confidence >= 0.2 && n.confidence <= 0.65) {
        items.push({
          dimension: n.id,
          kind: 'forming',
          target: n.label,
          // Ambiguity 4·c·(1−c) peaks at c=0.5, but a partially-known belief is
          // less unknown than a never-observed option, so scale it below the
          // unexplored band (0.85+). Keeps exploration biased toward the genuinely new.
          uncertainty: round(0.6 * 4 * n.confidence * (1 - n.confidence), 4),
          rationale: `Belief "${n.label}" is still forming (confidence ${n.confidence.toFixed(2)}); one more experience would sharpen it.`,
          probe: { strategy: 'reinforce', genre: genreOf(n) },
        });
      }
    }

    // unexplored buildable genres
    const engaged = new Map(
      g.nodes.filter((n) => n.id.startsWith('engaged:genre:')).map((n) => [n.label, n.confidence]),
    );
    const likedFamilies = new Set(
      knownGenres.filter((kg) => (engaged.get(kg.genre) || 0) >= 0.4).map((kg) => kg.family),
    );
    for (const kg of knownGenres) {
      if ((engaged.get(kg.genre) || 0) >= 0.05) continue; // already observed
      const adjacent = likedFamilies.has(kg.family);
      items.push({
        dimension: `genre:${kg.genre}`,
        kind: 'unexplored',
        target: kg.genre,
        uncertainty: round(adjacent ? 0.95 : 0.85, 4),
        rationale: adjacent
          ? `Never tried ${kg.genre}, but it's adjacent to a genre they already enjoy — high-value probe.`
          : `Never tried ${kg.genre}; the model has no evidence either way.`,
        probe: { strategy: 'explore-new', genre: kg.genre, templateId: kg.templateId },
      });
    }

    // stale beliefs (decayed since last reinforced)
    for (const n of g.nodes) {
      if (!n.lastSeen || n.frequency < 2) continue;
      const ageDays = (asOfMs - Date.parse(n.lastSeen)) / WorldModelService.DAY_MS;
      if (ageDays > halfLifeDays && n.confidence < 0.4) {
        items.push({
          dimension: n.id,
          kind: 'stale',
          target: n.label,
          uncertainty: round(clamp(ageDays / (2 * halfLifeDays), 0.3, 0.9), 4),
          rationale: `"${n.label}" was reinforced ${Math.round(ageDays)}d ago and has decayed — re-test whether it still holds.`,
          probe: { strategy: 're-test', genre: genreOf(n) },
        });
      }
    }

    items.sort((a, b) => b.uncertainty - a.uncertainty);

    // Guarantee: the model must always have something it wants to learn.
    if (!items.length) {
      const top = g.nodes.find((n) => n.id.startsWith('engaged:genre:'));
      items.push({
        dimension: top ? top.id : 'drift',
        kind: 'forming',
        target: top?.label || 'preferences',
        uncertainty: 0.3,
        rationale: 'Model is confident everywhere — re-test the top preference for drift, since people change.',
        probe: { strategy: 're-test', genre: top ? genreOf(top) : undefined },
      });
    }

    return items.slice(0, 8);
  }

  // --- explore vs exploit (the #5 seed) --------------------------------------

  private recommend(genrePref: Prediction[], uncertainty: UncertaintyItem[], knownGenres: KnownGenre[]): Recommendation {
    const topGenre = genrePref[0];
    const probe = uncertainty[0];
    const exploitValue = topGenre ? round(topGenre.probability * topGenre.confidence, 4) : 0;
    const exploreValue = probe ? probe.uncertainty : 0;

    // Deterministic explore/exploit schedule: while there is no strong preference,
    // EXPLORE to learn the person; once a strong preference exists, EXPLOIT it —
    // except still take an occasional high-value probe into an adjacent untried
    // genre (the "introduce electronic jazz" move). No preference exhausted → the
    // model naturally settles into exploitation, but the uncertainty set is never
    // empty, so it can always resume learning if the person drifts.
    const strongPref = !!topGenre && topGenre.confidence >= 0.5;
    const adjacentProbe = uncertainty.find((u) => u.kind === 'unexplored' && u.uncertainty >= 0.95);
    const mode: 'explore' | 'exploit' = !strongPref ? 'explore' : adjacentProbe ? 'explore' : 'exploit';

    if (mode === 'exploit') {
      const genre = topGenre!.value;
      return {
        mode,
        genre,
        templateId: templateIdFor(genre, knownGenres),
        topicFocus: undefined,
        hypothesis: `Reinforce the preference for ${genre} and confirm it still holds.`,
        rationale: `Strong preference (conf=${topGenre!.confidence}); no adjacent probe outranks it.`,
        exploitValue,
        exploreValue,
      };
    }

    // Explore: learning target is the adjacent probe when we already have a pref,
    // else the top uncertainty item. Always resolve a BUILDABLE delivery genre —
    // if the target is a topic/trait (no genre of its own), deliver it inside the
    // person's preferred genre and carry the topic as `topicFocus`.
    const target = strongPref && adjacentProbe ? adjacentProbe : probe;
    let genre: string | undefined;
    let templateId: string | undefined;
    let topicFocus: string | undefined;
    if (target.probe.genre && templateIdFor(target.probe.genre, knownGenres)) {
      genre = target.probe.genre;
      templateId = target.probe.templateId || templateIdFor(genre, knownGenres);
    } else if (topGenre) {
      genre = topGenre.value;
      templateId = templateIdFor(genre, knownGenres);
      topicFocus = target.kind !== 'unexplored' ? target.target : undefined;
    } else {
      genre = knownGenres[0]?.genre;
      templateId = knownGenres[0]?.templateId;
    }

    return {
      mode,
      genre: genre || target.target,
      templateId,
      topicFocus,
      hypothesis:
        target.kind === 'unexplored'
          ? `Does the user enjoy ${target.target}?`
          : target.kind === 'stale'
          ? `Does "${target.target}" still hold, or has it faded?`
          : `Sharpen the forming belief "${target.target}".`,
      rationale: target.rationale,
      exploitValue,
      exploreValue,
    };
  }

  // --- helpers ---------------------------------------------------------------

  private knownGenres(): KnownGenre[] {
    try {
      const reg = this.templates.listTemplates() as { templates?: Array<{ id: string; genreFamily?: string }> };
      return (reg.templates || []).map((t) => ({
        genre: String(t.id).replace(/\.v\d+$/i, ''),
        templateId: t.id,
        family: t.genreFamily || 'unknown',
      }));
    } catch {
      return [];
    }
  }

  private modelConfidence(g: PersonGraph): number {
    const top = g.nodes.slice(0, 5);
    const avg = top.length ? top.reduce((a, n) => a + n.confidence, 0) / top.length : 0;
    const coverage = g.stats.signalCount / (g.stats.signalCount + 10); // saturates with data
    return round(avg * coverage, 4);
  }
}

// --- types --------------------------------------------------------------------

export interface Prediction { value: string; probability: number; confidence: number }
export interface Predictions {
  genrePreference: Prediction[];
  topicAffinity: Prediction[];
  completionProbability: { probability: number; confidence: number };
  engagementProfile: { style: string; confidence: number };
}
export interface UncertaintyItem {
  dimension: string;
  kind: 'forming' | 'unexplored' | 'stale';
  target: string;
  uncertainty: number;
  rationale: string;
  probe: { strategy: 'reinforce' | 'explore-new' | 're-test'; genre?: string; templateId?: string };
}
export interface Recommendation {
  mode: 'explore' | 'exploit';
  genre: string;
  templateId?: string;
  topicFocus?: string;
  hypothesis: string;
  rationale: string;
  exploitValue: number;
  exploreValue: number;
}
export interface WorldModel {
  personId: string;
  asOf: string;
  modelConfidence: number;
  predictions: Predictions;
  uncertaintySet: UncertaintyItem[];
  recommendation: Recommendation;
  becoming: Array<{ label: string; confidence: number }>;
  basis: { signalCount: number; graphNodes: number };
}

interface KnownGenre { genre: string; templateId: string; family: string }

function conf(nodes: PersonGraphNode[], id: string): number {
  return nodes.find((n) => n.id === id)?.confidence || 0;
}
function genreOf(node: PersonGraphNode): string | undefined {
  const m = node.id.match(/^(?:engaged|mastery):genre:(.+)$/);
  return m ? m[1] : undefined;
}
function templateIdFor(genre: string, known: KnownGenre[]): string | undefined {
  return known.find((k) => k.genre === genre)?.templateId;
}
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
function round(n: number, dp: number): number { const f = 10 ** dp; return Math.round(n * f) / f; }
