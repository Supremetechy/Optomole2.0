import { Injectable } from '@nestjs/common';
import { id as makeId } from '../shared/ids';
import { plainText, shortLabel } from '../shared/text';
import { ExperiencePackage } from '../shared/types';

/**
 * SemanticModelService — Stages 0 and 1 of the content-to-experience compiler.
 *
 * The preprocessing engines each emit their own richly-shaped document
 * (semanticExtraction has concepts/actions/entities, emotionalIntelligence has
 * emotions/arcs, gameplayNormalization has atoms/npcs/bosses…). Every consumer
 * downstream therefore had to know all five shapes, which is why directives were
 * never built: there was no single typed input to resolve *from*.
 *
 * This service folds all of them into the two canonical shapes the pipeline
 * contract names:
 *
 *   Stage 0  ContentNode[]   — raw material normalized, format-agnostic from here
 *   Stage 1  SemanticNode[]  — meaning, with provenance and confidence
 *
 * Two rules carried from ExperienceBuildService:
 *  1. CONTENT LIVES ONCE. A ContentNode's `raw` is a *reference* to the source
 *     item, never a second copy of its text. SemanticNodes carry short labels
 *     plus `sourceNodeIds` back to the content they came from.
 *  2. DROPS ARE VISIBLE. `coverage` records what each source layer contributed,
 *     so a preprocessing layer that produced nothing is reported, not silent.
 */

export type ContentSourceType = 'text' | 'table' | 'image' | 'audio' | 'structured';

export interface ContentNode {
  id: string;
  sourceType: ContentSourceType;
  /** A reference to the source payload — never a copy of it. */
  raw: { ref: string; title: string; characters: number };
  /** Where it came from: "design_doc.md#L120", "enemies.csv:row14". */
  origin: string;
  hints?: Record<string, string>;
}

/**
 * The Checklist names six kinds. `item` and `hazard` are added because the
 * experience layer has to place collectibles and threats as first-class things:
 * folding them into `event` lost the distinction between "something happened"
 * and "something is carryable", and that distinction is exactly what decides
 * whether a node becomes a pickup, an NPC, or a room feature.
 */
export type SemanticKind =
  | 'actor'
  | 'location'
  | 'event'
  | 'mood'
  | 'relationship'
  | 'objective'
  | 'item'
  | 'hazard';

export interface SemanticNode {
  id: string;
  /** Traceability back to ContentNode ids. */
  sourceNodeIds: string[];
  kind: SemanticKind;
  attributes: Record<string, string | number | boolean>;
  /** 0–1. Tabular/declared data is 1.0; inferred prose carries its extractor's score. */
  confidence: number;
  /** The upstream id (semantic entity, gameplay atom, npc…) this node folds. */
  originId?: string;
  /** Binding id when the mapping manifest already carries this content. */
  bindingId?: string | null;
}

export interface SemanticModel {
  schemaVersion: string;
  kind: string;
  experienceId: string;
  contentNodes: ContentNode[];
  semanticNodes: SemanticNode[];
  coverage: Record<string, { status: 'emitted' | 'empty'; count: number; note?: string }>;
  stats: {
    contentNodeCount: number;
    semanticNodeCount: number;
    byKind: Record<string, number>;
    meanConfidence: number;
  };
}

/** Deterministic data (declared characters, table rows) is not an inference. */
const DECLARED_CONFIDENCE = 1;

/**
 * `type` values that mean "this is a gameplay atom", not "this is a place".
 *
 * The compiler builds `proceduralMap.locations` partly from gameplay atoms, so a
 * frequently-mentioned concept ("layer", "inbox") arrives shaped like a location
 * and carrying its atom type. Promoting those produced one scene per concept,
 * each named after a common noun. A region is somewhere the player goes; these
 * are things the player learns, and they already become items and quizzes.
 */
const NON_LOCATION_TYPES = new Set([
  'quiz', 'inventory_item', 'puzzle', 'simulation', 'challenge', 'branch',
  'mission', 'boss_battle', 'avoidance_challenge', 'dialogue',
]);

/** Emotion labels that imply pressure rather than calm, used to score mood nodes. */
const HIGH_PRESSURE_EMOTIONS = new Set([
  'fear', 'anger', 'urgency', 'anxiety', 'tension', 'frustration', 'stress', 'alarm', 'panic',
]);

/** Emotions that read as reward/relief — the release end of a tension curve. */
const LOW_PRESSURE_EMOTIONS = new Set([
  'joy', 'trust', 'relief', 'calm', 'satisfaction', 'confidence', 'pride', 'hope',
]);

@Injectable()
export class SemanticModelService {
  /**
   * Project a compiled package into the canonical model. Preprocessing output is
   * used when the package carries it (`specification.preprocessing`); otherwise
   * the blueprint is read directly, so AI-compiled packages that never ran the
   * preprocessing pipeline still produce a usable model instead of nothing.
   */
  project(input: { package: ExperiencePackage; mappingManifest?: any }): SemanticModel {
    const pkg = (input.package || {}) as Record<string, any>;
    const preprocessing = (pkg.specification?.preprocessing || {}) as Record<string, any>;
    const blueprint = (pkg.blueprint || {}) as Record<string, any>;
    const bindings: any[] = Array.isArray(input.mappingManifest?.bindings) ? input.mappingManifest.bindings : [];

    this.lastLocationRejects = 0;
    const contentNodes = this.contentNodes(preprocessing, pkg);
    const contentIds = contentNodes.map((node) => node.id);
    const bindingByLabel = this.bindingIndex(bindings);

    const semantic = preprocessing.semanticExtraction || {};
    const emotional = preprocessing.emotionalIntelligence || {};
    const gameplay = preprocessing.gameplayNormalization || {};
    const graph = preprocessing.knowledgeGraph || blueprint.knowledgeGraph || {};
    const storyboard = preprocessing.storyboard || blueprint.storyboard || {};

    const layers: Array<{ name: string; nodes: SemanticNode[]; note: string }> = [
      { name: 'actors', nodes: this.actors(gameplay, semantic, blueprint, contentIds), note: 'No people, NPCs, or declared characters in the source.' },
      { name: 'locations', nodes: this.locations(semantic, blueprint, contentIds), note: 'No places named in the source and no map locations compiled.' },
      { name: 'events', nodes: this.events(semantic, storyboard, contentIds), note: 'No actions or storyboard scenes to sequence.' },
      { name: 'moods', nodes: this.moods(emotional, contentIds), note: 'Emotional intelligence produced no emotions or arc.' },
      { name: 'objectives', nodes: this.objectives(semantic, gameplay, blueprint, contentIds), note: 'No learning objectives, missions, or quests.' },
      { name: 'items', nodes: this.items(gameplay, bindings, contentIds), note: 'No collectible atoms or carryable bindings.' },
      { name: 'hazards', nodes: this.hazards(gameplay, contentIds), note: 'No risks, mistakes, or bosses in the source.' },
      { name: 'relationships', nodes: this.relationships(semantic, graph, contentIds), note: 'No relationships or graph edges resolved.' },
    ];

    const coverage: SemanticModel['coverage'] = {};
    const semanticNodes: SemanticNode[] = [];
    for (const layer of layers) {
      const filtered = layer.name === 'locations' && this.lastLocationRejects
        ? `${this.lastLocationRejects} map entries were gameplay atoms, not places, and did not become regions.`
        : undefined;
      coverage[layer.name] = layer.nodes.length
        ? { status: 'emitted', count: layer.nodes.length, ...(filtered ? { note: filtered } : {}) }
        : { status: 'empty', count: 0, note: filtered || layer.note };
      // Confidence is a 0-1 contract, and this is the boundary that enforces it.
      // Upstream layers do not all honor it: knowledge-graph edges derived from
      // gameplay atoms carry the atom's `salience`, which is an occurrence COUNT
      // (a concept seen ten times scores 10), so an unclamped copy would let one
      // frequently-mentioned phrase outweigh every other signal downstream.
      for (const node of layer.nodes) {
        node.confidence = Number.isFinite(node.confidence)
          ? Math.max(0, Math.min(1, node.confidence))
          : 0.5;
      }
      semanticNodes.push(...layer.nodes);
    }

    // Rejoin to the content store so a directive can reference a binding
    // instead of carrying a label an engine would have to string-match.
    for (const node of semanticNodes) {
      if (node.bindingId) continue;
      const label = String(node.attributes.label || node.attributes.name || '').toLowerCase().trim();
      node.bindingId = (label && bindingByLabel.get(label)) || null;
    }

    const byKind: Record<string, number> = {};
    for (const node of semanticNodes) byKind[node.kind] = (byKind[node.kind] || 0) + 1;
    const meanConfidence = semanticNodes.length
      ? Number((semanticNodes.reduce((total, node) => total + node.confidence, 0) / semanticNodes.length).toFixed(3))
      : 0;

    return {
      schemaVersion: '1.0.0',
      kind: 'optomole.SemanticModel',
      experienceId: String(pkg.experience?.id || pkg.id || 'experience'),
      contentNodes,
      semanticNodes,
      coverage,
      stats: {
        contentNodeCount: contentNodes.length,
        semanticNodeCount: semanticNodes.length,
        byKind,
        meanConfidence,
      },
    };
  }

  // ---- Stage 0 ----

  /**
   * Normalize whatever the ingest produced into ContentNodes. Sanitized items
   * are the usual source; a package compiled straight from a source payload
   * still yields one node so provenance is never empty.
   */
  private contentNodes(preprocessing: Record<string, any>, pkg: Record<string, any>): ContentNode[] {
    const items: any[] = this.arrayOf(preprocessing.contentSanitization?.items)
      .concat(this.arrayOf(preprocessing.semanticExtraction?.documents).filter((document: any) =>
        !this.arrayOf(preprocessing.contentSanitization?.items).some((item: any) => item.id === document.id)));

    const nodes = items.map((item: any) => ({
      id: String(item.id || makeId('content')),
      sourceType: this.sourceTypeOf(item),
      raw: {
        ref: String(item.id || ''),
        title: shortLabel(item.title) || 'Source',
        characters: String(item.text || '').length,
      },
      origin: String(item.origin || item.provenance?.origin || 'ingest'),
      hints: this.hintsOf(item),
    }));

    if (nodes.length) return nodes;

    const source = pkg.source || {};
    return [{
      id: makeId('content'),
      sourceType: this.sourceTypeOf(source),
      raw: {
        ref: String(source.uri || pkg.experience?.id || 'source'),
        title: shortLabel(source.title || pkg.experience?.title) || 'Source',
        characters: String(source.text || '').length,
      },
      origin: String(source.uri || 'direct-source'),
    }];
  }

  private sourceTypeOf(item: any): ContentSourceType {
    const declared = String(item?.sourceType || item?.mimeType || '').toLowerCase();
    if (/image|png|jpe?g|svg|webp/.test(declared)) return 'image';
    if (/audio|mp3|wav|voice|transcri/.test(declared)) return 'audio';
    if (/csv|xls|sheet|table/.test(declared)) return 'table';
    if (/json|yaml|structured|api/.test(declared)) return 'structured';
    return 'text';
  }

  /** Author-supplied tags travel with the node so Stage 2 can honor intent. */
  private hintsOf(item: any): Record<string, string> | undefined {
    const metadata = item?.metadata;
    if (!metadata || typeof metadata !== 'object') return undefined;
    const hints: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || typeof value === 'object') continue;
      hints[key] = String(value);
    }
    return Object.keys(hints).length ? hints : undefined;
  }

  // ---- Stage 1 layers ----

  /**
   * actor — anyone the player can meet or fight. Normalized NPCs are declared
   * (confidence 1.0); people lifted from prose keep their extractor's score, so
   * a designer can review low-confidence casting.
   */
  private actors(gameplay: Record<string, any>, semantic: Record<string, any>, blueprint: Record<string, any>, contentIds: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    const seen = new Set<string>();

    const push = (name: string, attributes: Record<string, string | number | boolean>, confidence: number, sourceIds: string[], originId?: string) => {
      const label = shortLabel(name);
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: sourceIds.length ? sourceIds : contentIds.slice(0, 1),
        kind: 'actor',
        attributes: { label, ...attributes },
        confidence,
        originId,
      });
    };

    for (const npc of this.arrayOf(gameplay.npcs)) {
      push(npc.name, {
        role: plainText(npc.role) || 'guide',
        archetype: 'ally',
        hostile: false,
        trust: Number(npc.trust) || 50,
        missionId: String(npc.missionId || ''),
      }, DECLARED_CONFIDENCE, [String(npc.sourceEntityId || '')].filter(Boolean), String(npc.id || ''));
    }

    for (const character of this.arrayOf(blueprint.characters)) {
      push(character.name || character.title, {
        role: plainText(character.role) || 'guide',
        archetype: 'ally',
        hostile: false,
        lineCount: this.arrayOf(character.lines).length,
      }, DECLARED_CONFIDENCE, [], String(character.id || ''));
    }

    // Bosses are actors too — they are the ones that need a combat directive.
    for (const boss of this.arrayOf(gameplay.bosses)) {
      push(boss.name, {
        role: 'antagonist',
        archetype: 'boss',
        hostile: true,
        threat: 1,
        defeatCondition: plainText(boss.defeatCondition) || 'resolve the challenge',
      }, DECLARED_CONFIDENCE, [String(boss.sourceActionId || '')].filter(Boolean), String(boss.id || ''));
    }

    for (const person of this.arrayOf(semantic.people)) {
      push(person.text, {
        role: 'source-figure',
        archetype: 'ally',
        hostile: false,
      }, Number(person.confidence) || 0.7, [String(person.sourceId || '')].filter(Boolean), String(person.id || ''));
    }

    return nodes;
  }

  /**
   * location — where the experience happens. Compiled map locations win over
   * prose-extracted places because they already carry type and hazards.
   */
  private locations(semantic: Record<string, any>, blueprint: Record<string, any>, contentIds: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    const seen = new Set<string>();
    const map = blueprint.proceduralMap || {};
    let rejected = 0;

    for (const location of this.arrayOf(map.locations)) {
      const label = shortLabel(location.name);
      if (!label || seen.has(label.toLowerCase())) continue;
      if (!this.looksLikeAPlace(label, location.type)) {
        rejected += 1;
        continue;
      }
      seen.add(label.toLowerCase());
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'location',
        attributes: {
          label,
          type: plainText(location.type) || 'mission_node',
          description: plainText(location.description).slice(0, 240),
          hazardCount: this.arrayOf(location.hazards).length,
          enclosure: /interior|room|lab|vault|chamber|office/i.test(`${label} ${location.type || ''}`) ? 'interior' : 'exterior',
        },
        confidence: DECLARED_CONFIDENCE,
        originId: String(location.id || ''),
      });
    }

    for (const place of this.arrayOf(semantic.places)) {
      const label = shortLabel(place.text);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: [String(place.sourceId || '')].filter(Boolean).length ? [String(place.sourceId)] : contentIds.slice(0, 1),
        kind: 'location',
        attributes: { label, type: 'referenced_place', enclosure: 'exterior', hazardCount: 0 },
        confidence: Number(place.confidence) || 0.6,
        originId: String(place.id || ''),
      });
    }

    // Rejections are not silent: they are the difference between one region per
    // concept and one region per place, and a reader should see the count.
    if (rejected) this.lastLocationRejects = rejected;
    return nodes;
  }

  /** Set by `locations()`; reported in coverage so the filter is never invisible. */
  private lastLocationRejects = 0;

  /**
   * A place is somewhere the player can be. A bare lowercase common noun
   * ("layer", "signals") is a concept the extractor happened to rank highly, and
   * a gameplay-atom type is positive proof the entry was never a location.
   */
  private looksLikeAPlace(label: string, type: unknown): boolean {
    if (NON_LOCATION_TYPES.has(String(type || '').toLowerCase())) return false;
    const tokens = label.split(/\s+/);
    if (tokens.length === 1 && label === label.toLowerCase()) return false;
    return true;
  }

  /** event — the things that happen, in the order the storyboard chose. */
  private events(semantic: Record<string, any>, storyboard: Record<string, any>, contentIds: string[]): SemanticNode[] {
    const scenes = this.arrayOf(storyboard.scenes)
      .slice()
      .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

    const nodes: SemanticNode[] = scenes.map((scene: any, order: number) => ({
      id: makeId('sem'),
      sourceNodeIds: contentIds.slice(0, 1),
      kind: 'event' as const,
      attributes: {
        label: shortLabel(scene.title) || `Beat ${order + 1}`,
        order,
        sceneType: plainText(scene.sceneType) || 'scene',
        emotion: plainText(scene.emotion || scene.dominantEmotion) || 'neutral',
        atomIds: this.arrayOf(scene.gameplayAtomIds).join(','),
      },
      confidence: DECLARED_CONFIDENCE,
      originId: String(scene.id || ''),
    }));

    if (nodes.length) return nodes;

    // No storyboard: fall back to extracted actions in chronological order, so
    // narrative directives still have beats to gate on.
    return this.arrayOf(semantic.actions).slice(0, 12).map((action: any, order: number) => ({
      id: makeId('sem'),
      sourceNodeIds: [String(action.sourceId || '')].filter(Boolean).length ? [String(action.sourceId)] : contentIds.slice(0, 1),
      kind: 'event' as const,
      attributes: {
        label: shortLabel(action.text) || `Step ${order + 1}`,
        order,
        sceneType: action.type === 'MISTAKE_OR_RISK' ? 'complication' : 'action',
        verb: plainText(action.verb) || 'act',
      },
      confidence: Number(action.confidence) || 0.7,
      originId: String(action.id || ''),
    }));
  }

  /**
   * mood — the felt state the content carries. This is the node kind pacing is
   * resolved from, so an arc with no mood nodes means a flat experience; the
   * arc stages are emitted as ordered moods, not just one aggregate.
   */
  private moods(emotional: Record<string, any>, contentIds: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    const arc = emotional.emotionArc || {};
    const stages = this.arrayOf(arc.stages);
    const staged = stages.length
      ? stages.map((stage: any, order: number) => ({ order, emotion: String(stage.emotion || 'neutral'), stage: String(stage.stage || ['beginning', 'middle', 'end'][order] || 'middle') }))
      : ['beginning', 'middle', 'end']
        .map((stage, order) => ({ order, stage, emotion: String(arc[stage] || '') }))
        .filter((entry) => entry.emotion);

    for (const entry of staged) {
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'mood',
        attributes: {
          label: entry.emotion,
          stage: entry.stage,
          order: entry.order,
          tone: entry.emotion.toLowerCase(),
          pressure: this.pressureOf(entry.emotion),
        },
        confidence: 0.8,
      });
    }

    for (const emotion of this.arrayOf(emotional.emotions).slice(0, 6)) {
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'mood',
        attributes: {
          label: String(emotion.emotion || 'neutral'),
          stage: 'overall',
          order: 99,
          tone: String(emotion.emotion || 'neutral').toLowerCase(),
          pressure: this.pressureOf(String(emotion.emotion || '')),
          weight: Number(emotion.score) || 0,
        },
        confidence: Number(emotion.confidence) || 0.7,
        originId: String(emotion.id || ''),
      });
    }

    return nodes;
  }

  /** 0–1 tension a named emotion implies. Neutral sits mid-curve, not at zero. */
  private pressureOf(emotion: string): number {
    const key = String(emotion || '').toLowerCase().trim();
    if (HIGH_PRESSURE_EMOTIONS.has(key)) return 0.9;
    if (LOW_PRESSURE_EMOTIONS.has(key)) return 0.25;
    return 0.5;
  }

  /** objective — what the player is being asked to accomplish. */
  private objectives(semantic: Record<string, any>, gameplay: Record<string, any>, blueprint: Record<string, any>, contentIds: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];

    for (const objective of this.arrayOf(semantic.learningObjectives)) {
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'objective',
        attributes: {
          label: shortLabel(objective.goalStatement) || 'Objective',
          successMetric: plainText(objective.successMetric).slice(0, 200),
          conceptCount: this.arrayOf(objective.relatedConceptIds).length,
        },
        confidence: Number(objective.confidence) || 0.78,
        originId: String(objective.id || ''),
      });
    }

    for (const mission of this.arrayOf(gameplay.missions)) {
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'objective',
        attributes: {
          label: shortLabel(mission.title) || 'Mission',
          summary: plainText(mission.summary).slice(0, 200),
          stepCount: this.arrayOf(mission.objectives).length,
          xp: Number(mission.reward?.xp) || 0,
        },
        confidence: DECLARED_CONFIDENCE,
        originId: String(mission.id || ''),
      });
    }

    for (const quest of this.arrayOf(blueprint.quests)) {
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'objective',
        attributes: {
          label: shortLabel(quest.title) || 'Quest',
          summary: plainText(quest.summary).slice(0, 200),
          questId: String(quest.id || ''),
        },
        confidence: DECLARED_CONFIDENCE,
        originId: String(quest.id || ''),
      });
    }

    return nodes;
  }

  /** item — what the player can pick up. Keyed off the acquisitive verb. */
  private items(gameplay: Record<string, any>, bindings: any[], contentIds: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    const seen = new Set<string>();

    const atoms = this.arrayOf(gameplay.gameplayAtoms)
      .filter((atom: any) => atom.gameplayType === 'inventory_item' || atom.interactionType === 'collect');
    for (const atom of atoms) {
      const label = shortLabel(atom.label);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: [String(atom.sourceId || '')].filter(Boolean).length ? [String(atom.sourceId)] : contentIds.slice(0, 1),
        kind: 'item',
        attributes: {
          label,
          acquire: plainText(atom.interactionType) || 'collect',
          salience: Number(atom.salience) || 0.6,
          xp: Number(atom.reward?.xp) || 0,
        },
        confidence: DECLARED_CONFIDENCE,
        originId: String(atom.id || ''),
      });
    }

    for (const binding of bindings) {
      const entityType = String(binding.gameEntityType || '');
      if (!['key-item', 'loot', 'evidence', 'collectible', 'resource', 'token', 'card', 'item'].includes(entityType)) continue;
      const label = shortLabel(binding.label);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'item',
        attributes: { label, acquire: plainText(binding.interactionType) || 'collect', entityType, salience: 0.6 },
        confidence: DECLARED_CONFIDENCE,
        bindingId: String(binding.id),
      });
    }

    return nodes;
  }

  /** hazard — the threats a region is themed and populated with. */
  private hazards(gameplay: Record<string, any>, contentIds: string[]): SemanticNode[] {
    const atoms = this.arrayOf(gameplay.gameplayAtoms).filter((atom: any) => atom.sourceKind === 'hazard');
    return atoms.map((atom: any, order: number) => ({
      id: makeId('sem'),
      sourceNodeIds: [String(atom.sourceId || '')].filter(Boolean).length ? [String(atom.sourceId)] : contentIds.slice(0, 1),
      kind: 'hazard' as const,
      attributes: {
        label: shortLabel(atom.label) || `Hazard ${order + 1}`,
        gameplayType: plainText(atom.gameplayType) || 'challenge',
        severity: Math.min(1, Number(atom.salience) || 0.6),
        successCondition: plainText(atom.successCondition).slice(0, 160),
      },
      confidence: DECLARED_CONFIDENCE,
      originId: String(atom.id || ''),
    }));
  }

  /** relationship — how the content connects. Gating edges become prerequisites. */
  private relationships(semantic: Record<string, any>, graph: Record<string, any>, contentIds: string[]): SemanticNode[] {
    const edges = this.arrayOf(graph.edges).length ? this.arrayOf(graph.edges) : this.arrayOf(semantic.relationships);
    const seen = new Set<string>();
    const nodes: SemanticNode[] = [];

    for (const edge of edges.slice(0, 60)) {
      const from = String(edge.from ?? edge.source ?? '');
      const to = String(edge.to ?? edge.target ?? '');
      if (!from || !to || from === to) continue;
      const relation = plainText(edge.relation || edge.type) || 'related_to';
      const key = `${from}->${to}:${relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({
        id: makeId('sem'),
        sourceNodeIds: contentIds.slice(0, 1),
        kind: 'relationship',
        attributes: {
          label: relation,
          from,
          to,
          relation,
          gating: /require|prerequisite|depends|before|precede/i.test(relation),
        },
        confidence: Number(edge.confidence) || 0.6,
        originId: String(edge.id || ''),
      });
    }

    return nodes;
  }

  private bindingIndex(bindings: any[]): Map<string, string> {
    const index = new Map<string, string>();
    for (const binding of bindings) {
      const label = plainText(binding.label ?? binding.sourceElement?.label).toLowerCase().trim();
      if (label && !index.has(label)) index.set(label, String(binding.id));
    }
    return index;
  }

  private arrayOf(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }
}
