import { Injectable } from '@nestjs/common';
import { ContentNode, SemanticModel, SemanticNode } from './semantic-model.service';

/**
 * FormSynthesisService — Stage 2.5 of the content-to-experience compiler.
 *
 * Every stage before this one already derived its numbers from the user's
 * content: pacing from the emotional arc, aggression from named risks, geometry
 * from traversal directives. But the *form* those numbers described was a
 * constant. The emitter always built the same game — a side-scrolling platformer
 * with collectibles and a goal at the right edge — and the compiler's only other
 * option was to hand the experience off to one of eleven pre-authored templates.
 * So content chose the numbers and the labels, and something else chose the game.
 *
 * A form is the answer to the three questions a template answers implicitly:
 *
 *   topology    how space is organized      (a run, a room, a map, a grid, a lane)
 *   verbs       what the player can do      (traverse, leap, collect, strike, connect…)
 *   resolution  what winning means          (reach it, gather it, link it, order it)
 *
 * Those three compose. Five topologies × the verb sets content actually implies ×
 * four resolutions is not a catalog of games — it is a space of them, and the
 * point of deriving it here is that a source nobody anticipated can land
 * somewhere nobody pre-authored.
 *
 * Two rules carried from the stages around it:
 *  1. PROVENANCE SURVIVES. Every choice carries `derivedFrom` semantic node ids
 *     and a plain-language line in `rationale`, so "why is this a node map?" has
 *     an answer that ends at a sentence in the upload.
 *  2. DROPS ARE VISIBLE. `coverage` records which content signals were read and
 *     which were absent, so a form chosen by default is distinguishable from one
 *     chosen by evidence.
 */

/** What the player is able to do. Verbs become input bindings and interactions. */
export type PlayerVerb =
  | 'traverse'  // move through the space
  | 'leap'      // vertical traversal — only meaningful under gravity
  | 'collect'   // acquire the content's items
  | 'strike'    // fight what the content named as hostile
  | 'evade'     // survive what the content named as dangerous
  | 'inspect'   // examine people/places and read what they carry
  | 'connect'   // link things the content relates to each other
  | 'order'     // put a sequence into its correct order
  | 'allocate'; // spend a limited resource across competing demands

/** How the playable space is organized. Decides layout, gravity, and camera. */
export type TopologyId = 'side-scroll' | 'room-graph' | 'node-map' | 'board' | 'timeline';

/** What ends the experience. Decides the win trigger the emitter compiles. */
export type ResolutionId = 'reach-goal' | 'collect-all' | 'connect-all' | 'order-sequence';

export type LayoutId = 'linear' | 'perimeter' | 'radial' | 'grid' | 'lane';

export interface TopologySpec {
  id: TopologyId;
  layout: LayoutId;
  /**
   * Whether the world pulls. A gravity form is a platformer and its player
   * machine jumps; a planar form is top-down and its player machine steers.
   * This is the single most consequential bit in the whole form — it decides
   * which movement verbs are even coherent.
   */
  gravity: boolean;
  /** Radius (radial), columns (grid), or run length (linear/lane) in DSL units. */
  span: number;
}

export interface ExperienceForm {
  schemaVersion: string;
  kind: string;
  experienceId: string;
  topology: TopologySpec;
  /** Ordered; the first is the form's defining verb. */
  verbs: PlayerVerb[];
  inputBindings: Array<{ action: string; keys: string[] }>;
  resolution: { id: ResolutionId; parameters: Record<string, string | number | boolean> };
  /** A stable, readable name for the composed form: `node-map/connect/connect-all`. */
  signature: string;
  /** Every topology's score, so a near-miss is visible rather than discarded. */
  scores: Record<TopologyId, number>;
  rationale: string[];
  derivedFrom: string[];
  confidence: number;
  coverage: Record<string, { status: 'emitted' | 'empty'; count: number; note?: string }>;
}

/** Layout, gravity, and span per topology — the invariant half of the choice. */
const TOPOLOGY_SHAPES: Record<TopologyId, Omit<TopologySpec, 'id'>> = {
  'side-scroll': { layout: 'linear', gravity: true, span: 3 },
  'room-graph': { layout: 'perimeter', gravity: false, span: 9 },
  'node-map': { layout: 'radial', gravity: false, span: 7 },
  board: { layout: 'grid', gravity: false, span: 4 },
  timeline: { layout: 'lane', gravity: false, span: 3.5 },
};

/**
 * Keys per action. Movement is WASD + arrows because a planar form needs four
 * directions and a side-scroller needs two of the same ones — one vocabulary,
 * so a player who learns one form can play the next.
 */
const KEYS: Record<string, string[]> = {
  MoveLeft: ['A', 'LeftArrow'],
  MoveRight: ['D', 'RightArrow'],
  MoveUp: ['W', 'UpArrow'],
  MoveDown: ['S', 'DownArrow'],
  Jump: ['Space', 'W', 'UpArrow'],
  Attack: ['J', 'F'],
  Interact: ['E', 'Enter'],
};

/** A relationship graph this dense is the content's actual subject. */
const NODE_MAP_RELATIONSHIP_FLOOR = 6;
/** Below this many ordered beats, "sequence" is a story, not a puzzle. */
const TIMELINE_EVENT_FLOOR = 4;
/** Distinct places worth walking between rather than scrolling past. */
const ROOM_GRAPH_LOCATION_FLOOR = 3;

/**
 * Relation types the knowledge graph mints as bookkeeping rather than as
 * something the source said.
 *
 * This exclusion is the difference between reading the content and reading the
 * compiler. Every upload arrives with ~60 relationship nodes because the graph
 * builder emits co-occurrence, normalization, and traversal edges for any text
 * at all, and the list is then capped — so raw relationship COUNT is very
 * nearly a constant, and scoring on it made every source look like a network.
 * What is left after this filter is the handful of edges the material actually
 * asserted, which is what a topology should be read from.
 */
const SCAFFOLDING_RELATIONS = new Set([
  'co_occurs_with',
  'normalizes_to',
  'contains_gameplay_atom',
  'covers',
  'traverses',
  'transitions_to',
  'guides',
  'related_to',
]);

/**
 * How the source talks about itself.
 *
 * Structure alone cannot separate a runbook from a story: preprocessing gives
 * both the same node census (one location, three storyboard beats, a capped
 * edge list). The distinction lives in the prose — a procedure says "before",
 * "then", "do not proceed"; a concept network says "connects to", "depends on".
 * Matches are counted per 100 words so a long upload does not outscore a dense
 * one, and the matched phrases are quoted in the rationale, so the evidence for
 * a form is a line the user can find in their own material.
 */
const LEXICAL_MARKERS: Record<'procedural' | 'relational' | 'spatial' | 'tabular', RegExp> = {
  procedural: /\b(step\s*\d|first,|then,|next,|after\s+\w+ing|before\s+\w+ing|finally|phase|stage\s*\d|proceed|in sequence|precedes?|subsequently)\b/gi,
  relational: /\b(connects? to|linked? to|links? \w+ to|relates? to|related to|depends? on|is produced by|is part of|network|consists? of|supports?|receives? \w+ from|belongs to)\b/gi,
  spatial: /\b(room|hall|chamber|floor|basement|corridor|area|zone|wing|storeroom|lab|office|deck|building)\b/gi,
  tabular: /(\|.*\|)|\b(column|row|budget|allocate|cost|capacity|quota|per unit|line item|spreadsheet)\b/gi,
};

interface LexicalProfile {
  /** Matches per 100 words, per marker family. */
  density: Record<keyof typeof LEXICAL_MARKERS, number>;
  /** A couple of matched phrases per family, for the rationale. */
  samples: Record<keyof typeof LEXICAL_MARKERS, string[]>;
  words: number;
}

@Injectable()
export class FormSynthesisService {
  synthesize(input: { model: SemanticModel; package?: Record<string, any> }): ExperienceForm {
    const model = input.model;
    const nodes = model.semanticNodes || [];
    const contentNodes = model.contentNodes || [];
    const byKind = (kind: SemanticNode['kind']) => nodes.filter((node) => node.kind === kind);

    const locations = byKind('location');
    const events = byKind('event');
    const relationships = byKind('relationship');
    const items = byKind('item');
    const hazards = byKind('hazard');
    const actors = byKind('actor');
    const objectives = byKind('objective');

    const rationale: string[] = [];
    const derivedFrom = new Set<string>();
    const note = (line: string, sources: SemanticNode[]) => {
      rationale.push(line);
      for (const source of sources.slice(0, 8)) derivedFrom.add(source.id);
    };

    const lexical = this.readSource(input.package || {});
    const scores = this.scoreTopologies({ locations, events, relationships, items, hazards, actors, objectives, contentNodes, lexical });
    for (const [family, density] of Object.entries(lexical.density) as Array<[keyof typeof LEXICAL_MARKERS, number]>) {
      if (density < 1) continue;
      const quoted = lexical.samples[family].map((phrase) => `“${phrase}”`).join(', ');
      rationale.push(`Source reads as ${family} (${density.toFixed(1)} markers/100 words: ${quoted}).`);
      for (const contentNode of contentNodes.slice(0, 3)) derivedFrom.add(contentNode.id);
    }
    const requested = this.requestedTopology(input.package || {});
    const [winner, runnerUp] = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[TopologyId, number]>;
    const topologyId = requested || winner[0];

    if (requested) {
      rationale.push(`Topology pinned to '${requested}' by the caller; content scored '${winner[0]}' highest.`);
    } else {
      rationale.push(
        `Topology '${topologyId}' scored ${winner[1].toFixed(2)}` +
          (runnerUp ? `, ahead of '${runnerUp[0]}' at ${runnerUp[1].toFixed(2)}.` : '.'),
      );
    }

    const topology: TopologySpec = { id: topologyId, ...TOPOLOGY_SHAPES[topologyId] };

    // --- verbs ---------------------------------------------------------------
    // Traverse is unconditional: every form is entered by moving through it.
    // Everything else has to be earned by something the content actually
    // contains, so a source with no named risk never compiles a combat verb.
    const verbs: PlayerVerb[] = ['traverse'];

    if (topology.gravity) {
      verbs.push('leap');
      rationale.push('Gravity topology → leap is a movement verb.');
    }
    if (items.length) {
      verbs.push('collect');
      note(`${items.length} item node(s) in the source → collect.`, items);
    }
    const fightable = hazards.filter((hazard) => !this.isEnvironmental(hazard));
    const hostile = actors.filter((actor) => actor.attributes.hostile === true);
    if (fightable.length || hostile.length) {
      verbs.push('strike');
      note(`${fightable.length + hostile.length} confrontable threat(s) → strike.`, [...fightable, ...hostile]);
    }
    const environmental = hazards.filter((hazard) => this.isEnvironmental(hazard));
    if (environmental.length) {
      verbs.push('evade');
      note(`${environmental.length} environmental hazard(s) → evade.`, environmental);
    }
    if (topologyId === 'node-map' || this.gatingCount(relationships) >= 2) {
      verbs.push('connect');
      note(`${relationships.length} relationship edge(s) → connect.`, relationships);
    }
    if (topologyId === 'timeline') {
      verbs.push('order');
      note(`${events.length} ordered beat(s) → order.`, events);
    }
    if (topologyId === 'board') {
      verbs.push('allocate');
      note('Tabular/structured source → allocate a limited resource.', objectives);
    }
    if (actors.length > hostile.length) {
      verbs.push('inspect');
      note(`${actors.length - hostile.length} non-hostile cast member(s) → inspect.`, actors);
    }

    // --- resolution ----------------------------------------------------------
    const resolution = this.resolutionFor(topologyId, verbs, { items, events, relationships });
    rationale.push(`Resolution '${resolution.id}': ${resolution.why}`);

    const inputBindings = this.bindingsFor(verbs, topology);

    // Confidence is the mean of the evidence that produced the choice, damped
    // when the winning topology barely beat the next one — a coin-flip form
    // should not report itself as a confident reading of the content.
    const evidence = nodes.filter((node) => derivedFrom.has(node.id));
    const meanConfidence = evidence.length
      ? evidence.reduce((total, node) => total + (node.confidence || 0), 0) / evidence.length
      : 0.4;
    const margin = runnerUp ? Math.min(1, Math.max(0, winner[1] - runnerUp[1]) / Math.max(winner[1], 0.001)) : 1;
    const confidence = round(meanConfidence * (0.55 + 0.45 * margin), 4);

    return {
      schemaVersion: '1.0.0',
      kind: 'optomole.ExperienceForm',
      experienceId: model.experienceId,
      topology,
      verbs,
      inputBindings,
      resolution: { id: resolution.id, parameters: resolution.parameters },
      signature: `${topology.id}/${verbs.slice(0, 3).join('+')}/${resolution.id}`,
      scores,
      rationale,
      derivedFrom: [...derivedFrom],
      confidence,
      coverage: {
        locations: cover(locations.length, 'Places become rooms; a room-graph needs several.'),
        events: cover(events.length, 'Ordered beats are what a timeline orders.'),
        relationships: cover(relationships.length, 'Edges are what a node map connects.'),
        items: cover(items.length, 'Items are what collect-all counts.'),
        hazards: cover(hazards.length, 'Named risks decide strike vs evade.'),
        actors: cover(actors.length, 'Cast decides whether inspect exists.'),
        structuredSources: cover(
          contentNodes.filter((node) => node.sourceType === 'table' || node.sourceType === 'structured').length,
          'Tabular sources are what push toward a board.',
        ),
      },
    };
  }

  /**
   * Score every topology against the content's shape.
   *
   * Scores are deliberately additive and small: each is a count normalized
   * against the threshold at which that shape starts to make sense, so a source
   * with six relationships and six locations produces a close call rather than
   * a landslide — and the margin shows up in `confidence`.
   */
  private scoreTopologies(input: {
    locations: SemanticNode[];
    events: SemanticNode[];
    relationships: SemanticNode[];
    items: SemanticNode[];
    hazards: SemanticNode[];
    actors: SemanticNode[];
    objectives: SemanticNode[];
    contentNodes: ContentNode[];
    lexical: LexicalProfile;
  }): Record<TopologyId, number> {
    const { locations, events, relationships, items, hazards, actors, objectives, contentNodes, lexical } = input;

    const structured = contentNodes.filter((node) => node.sourceType === 'table' || node.sourceType === 'structured').length;
    const ordered = events.filter((event) => Number.isFinite(Number(event.attributes.order))).length;
    const procedural = events.filter((event) => /step|procedure|sequence|phase|stage/i.test(String(event.attributes.sceneType || event.attributes.verb || ''))).length;
    const interiors = locations.filter((location) => String(location.attributes.enclosure || '') === 'interior').length;
    const gating = this.gatingCount(relationships);
    // Only edges the source asserted — see SCAFFOLDING_RELATIONS.
    const asserted = relationships.filter(
      (relationship) => !SCAFFOLDING_RELATIONS.has(String(relationship.attributes.relation || '').toLowerCase()),
    );
    const ordering = asserted.filter((relationship) =>
      /precede|before|after|then|next|step|depend|require|sequence|follow/i.test(String(relationship.attributes.relation || '')),
    ).length;
    const resourceObjectives = objectives.filter((objective) =>
      /budget|cost|allocat|resource|tradeoff|priorit|capacity|spend/i.test(
        `${objective.attributes.label} ${objective.attributes.summary || ''} ${objective.attributes.successMetric || ''}`,
      ),
    ).length;

    // Lexical density carries most of the weight and structure corroborates it.
    // That ordering is deliberate: preprocessing hands every source a nearly
    // identical node census, so structure alone cannot tell a runbook from a
    // story, while the prose says which it is in the first sentence.
    const say = (family: keyof typeof LEXICAL_MARKERS) => ratio(lexical.density[family], 4);

    // side-scroll is the floor, not a winner: it scores a small constant so a
    // source with no distinguishing shape still compiles to something playable,
    // but any real signal elsewhere beats it.
    return {
      'side-scroll': round(0.5 + ratio(items.length, 6) * 0.4 + ratio(hazards.length, 5) * 0.3, 4),
      'room-graph': round(
        say('spatial') * 1.0
          + ratio(locations.length, ROOM_GRAPH_LOCATION_FLOOR) * 1.1
          + ratio(interiors, 2) * 0.5
          + ratio(actors.length, 4) * 0.3,
        4,
      ),
      'node-map': round(
        say('relational') * 1.2 + ratio(asserted.length, NODE_MAP_RELATIONSHIP_FLOOR) * 1.2 + ratio(gating, 3) * 0.6,
        4,
      ),
      board: round(say('tabular') * 0.9 + ratio(structured, 1) * 1.0 + ratio(resourceObjectives, 2) * 0.9, 4),
      timeline: round(
        say('procedural') * 1.2
          // Three ordered storyboard beats is what EVERY source gets, so ordered
          // events are corroboration at low weight, never the reason on their own.
          + ratio(ordered, TIMELINE_EVENT_FLOOR) * 0.6
          + ratio(procedural, 3) * 0.7
          + ratio(ordering, 3) * 0.5,
        4,
      ),
    };
  }

  /**
   * Read the upload's own prose. Returns marker density per 100 words plus the
   * phrases that matched, so the form's rationale can quote the material rather
   * than assert a category over it.
   */
  private readSource(pkg: Record<string, any>): LexicalProfile {
    const text = String(pkg?.source?.text || '');
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const density = {} as LexicalProfile['density'];
    const samples = {} as LexicalProfile['samples'];

    for (const [family, pattern] of Object.entries(LEXICAL_MARKERS) as Array<[keyof typeof LEXICAL_MARKERS, RegExp]>) {
      const matches = words ? text.match(new RegExp(pattern.source, pattern.flags)) || [] : [];
      density[family] = words ? round((matches.length / words) * 100, 3) : 0;
      samples[family] = [...new Set(matches.map((match) => match.trim().toLowerCase()))].slice(0, 3);
    }

    return { density, samples, words };
  }

  /**
   * What ends the experience. Resolution follows from the form's defining verb,
   * because "what winning means" and "what the player mostly does" are the same
   * question asked twice — a map you connect ends when it is connected.
   */
  private resolutionFor(
    topologyId: TopologyId,
    verbs: PlayerVerb[],
    content: { items: SemanticNode[]; events: SemanticNode[]; relationships: SemanticNode[] },
  ): { id: ResolutionId; parameters: Record<string, string | number | boolean>; why: string } {
    if (topologyId === 'node-map' && verbs.includes('connect')) {
      return {
        id: 'connect-all',
        parameters: { nodeCount: content.relationships.length },
        why: 'a map is finished when every relation it holds has been walked.',
      };
    }
    if (topologyId === 'timeline' && verbs.includes('order')) {
      return {
        id: 'order-sequence',
        parameters: { beatCount: content.events.length },
        why: 'an ordered source is finished when its order has been reproduced.',
      };
    }
    if (verbs.includes('collect') && content.items.length >= 2) {
      return {
        id: 'collect-all',
        parameters: { itemCount: content.items.length },
        why: `the source names ${content.items.length} things worth carrying; leaving one behind should not win.`,
      };
    }
    return {
      id: 'reach-goal',
      parameters: {},
      why: 'nothing in the source gates completion, so arriving is the completion.',
    };
  }

  /** Input bindings implied by the verb set — never a fixed control scheme. */
  private bindingsFor(verbs: PlayerVerb[], topology: TopologySpec): Array<{ action: string; keys: string[] }> {
    const actions: string[] = ['MoveLeft', 'MoveRight'];
    // Planar forms steer in four directions. A gravity form must NOT bind
    // MoveUp — the same key is Jump, and binding both makes a jump also a
    // vertical thrust the physics never asked for.
    if (!topology.gravity) actions.push('MoveUp', 'MoveDown');
    if (verbs.includes('leap')) actions.push('Jump');
    if (verbs.includes('strike')) actions.push('Attack');
    if (verbs.some((verb) => verb === 'inspect' || verb === 'connect' || verb === 'order' || verb === 'allocate')) {
      actions.push('Interact');
    }
    return actions.map((action) => ({ action, keys: KEYS[action] }));
  }

  /** An explicit caller/author override, honored but recorded in the rationale. */
  private requestedTopology(pkg: Record<string, any>): TopologyId | null {
    const raw = String(pkg?.form?.topology || pkg?.options?.topology || '').trim().toLowerCase();
    return (Object.keys(TOPOLOGY_SHAPES) as TopologyId[]).find((id) => id === raw) || null;
  }

  private gatingCount(relationships: SemanticNode[]): number {
    return relationships.filter((relationship) => relationship.attributes.gating === true).length;
  }

  /**
   * Mirrors ExperienceDirectiveService: a risk you route around is terrain, a
   * risk you confront is a body. The two stages must agree or the form promises
   * a verb the entities never provide.
   */
  private isEnvironmental(hazard: SemanticNode): boolean {
    const type = String(hazard.attributes.gameplayType || '').toLowerCase();
    return type === 'branch' || type === 'avoidance_challenge' || type === 'simulation';
  }
}

function ratio(count: number, floor: number): number {
  if (floor <= 0) return 0;
  return Math.min(1.5, count / floor);
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function cover(count: number, note: string): { status: 'emitted' | 'empty'; count: number; note?: string } {
  return count > 0 ? { status: 'emitted', count } : { status: 'empty', count: 0, note };
}
