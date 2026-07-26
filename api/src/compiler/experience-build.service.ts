import { Injectable } from '@nestjs/common';
import { plainText, shortLabel } from '../shared/text';
import { ExperiencePackage } from '../shared/types';

/**
 * ExperienceBuildService — the single projection from a compiled
 * ExperiencePackage to the engine-neutral component set every renderer builds
 * from.
 *
 * Before this existed the same package was projected three different ways: the
 * mapping manifest flattened everything into bindings, builds.service bolted
 * world layers on as ad-hoc top-level keys, and worker/project-generator
 * re-derived its own GameSpec for the native engines. Each new pipeline layer
 * cost three implementations that drifted, and structure was lost in transit —
 * quests were flattened into loose bindings with no quest table to rejoin.
 *
 * The contract here follows the module shape the ExperienceManifest schema
 * already describes (spec-engine/schemas/experience-manifest.schema.json):
 * named components plus a loadOrder. Two rules make it work across engines:
 *
 *  1. CONTENT LIVES ONCE. The mapping manifest's `bindings` remain the only
 *     store of user content. Every component references binding ids; none of
 *     them copy text. An engine resolves a reference by binding id lookup.
 *  2. DROPS ARE VISIBLE. `validation.componentCoverage` records, per component,
 *     whether it was emitted, came out empty, and why. A layer that silently
 *     produces nothing is the failure mode that kept proceduralMap and
 *     skillTree unread for months.
 */

/** How a component turned out, so a build never drops a layer silently. */
export type ComponentCoverage = 'emitted' | 'empty' | 'unavailable';

export interface ExperienceBuild {
  schemaVersion: string;
  kind: string;
  experienceId: string;
  templateId: string;
  components: Record<string, unknown>;
  loadOrder: string[];
  validation: {
    componentCoverage: Record<string, { status: ComponentCoverage; count: number; note?: string }>;
    bindingCount: number;
  };
}

/** The order an engine instantiates components in; later entries may reference earlier ids. */
const LOAD_ORDER = ['world', 'narrative', 'quests', 'cast', 'knowledge', 'inventory', 'progression', 'challenges'];

/** Placeholder world names the compiler emits when it has nothing better. */
const GENERIC_WORLD_NAMES = new Set(['knowledge frontier', 'optimole experience', 'optomole experience']);

/**
 * What makes something carryable is the verb, not the noun. Each template names
 * its entities in its own genre vocabulary (a courier's `pickup-point` is an
 * arcade's `loot`), but every template's mapping rules draw interactions from a
 * shared vocabulary — so keying inventory off the interaction stays correct as
 * genres are added. Entity types are a secondary signal for rules that declare
 * a carryable noun with a non-acquisitive verb.
 */
const ACQUIRE_INTERACTIONS = new Set(['collect', 'pickup', 'gather', 'mine', 'draw', 'hold', 'claim', 'accept']);
const CARRYABLE_ENTITIES = new Set(['key-item', 'loot', 'evidence', 'collectible', 'resource', 'token', 'card', 'item']);

@Injectable()
export class ExperienceBuildService {
  /**
   * Project a package + its resolved mapping manifest into the component set.
   * `mappingManifest.bindings` is the content store every component points at.
   */
  project(input: { package: ExperiencePackage; mappingManifest: any; templateId?: string }): ExperienceBuild {
    const pkg = (input.package || {}) as Record<string, any>;
    const mapping = input.mappingManifest || {};
    const bindings: any[] = Array.isArray(mapping.bindings) ? mapping.bindings : [];
    const blueprint = (pkg.blueprint || {}) as Record<string, any>;
    const specification = (pkg.specification || {}) as Record<string, any>;

    const index = this.buildIndex(bindings);
    const coverage: ExperienceBuild['validation']['componentCoverage'] = {};

    const components: Record<string, any> = {
      world: this.world(pkg, blueprint, bindings, index),
      narrative: this.narrative(blueprint, specification, index),
      quests: this.quests(blueprint, index),
      cast: this.cast(blueprint, bindings, index),
      knowledge: this.knowledge(blueprint, specification, index),
      inventory: this.inventory(bindings),
      progression: this.progression(pkg, blueprint),
      challenges: this.challenges(blueprint, index),
    };

    for (const name of LOAD_ORDER) {
      const component = components[name];
      const count = this.countOf(component);
      coverage[name] = count > 0
        ? { status: 'emitted', count }
        : { status: 'empty', count: 0, note: component?.emptyReason || 'No source data for this component.' };
      if (component && typeof component === 'object') delete (component as any).emptyReason;
    }

    return {
      schemaVersion: '1.0.0',
      kind: 'optomole.ExperienceBuild',
      experienceId: String(pkg.experience?.id || pkg.id || mapping.experienceId || 'experience'),
      templateId: String(input.templateId || mapping.templateId || ''),
      components,
      loadOrder: LOAD_ORDER,
      validation: { componentCoverage: coverage, bindingCount: bindings.length },
    };
  }

  /**
   * Reverse index over bindings so components can reference content by id
   * instead of copying it. Bindings already carry the join keys — quest-derived
   * bindings keep `sourceRef.questId`, graph-derived ones keep the semantic node
   * / gameplay atom id — there was simply never a table to join against.
   */
  private buildIndex(bindings: any[]) {
    const byQuest = new Map<string, { objectiveIds: string[]; evidenceIds: string[] }>();
    const bySourceId = new Map<string, string>();
    const byLabel = new Map<string, string>();
    const npcIds: string[] = [];
    const byNpcId = new Map<string, string>();

    for (const binding of bindings) {
      const id = String(binding.id || '');
      if (!id) continue;
      const ref = (binding.sourceRef || binding.sourceElement?.sourceRef || {}) as Record<string, any>;

      const questId = ref.questId ? String(ref.questId) : '';
      if (questId) {
        if (!byQuest.has(questId)) byQuest.set(questId, { objectiveIds: [], evidenceIds: [] });
        const entry = byQuest.get(questId)!;
        if (ref.kind === 'evidence') entry.evidenceIds.push(id);
        else entry.objectiveIds.push(id);
      }

      for (const key of ['atomId', 'sourceId', 'npcId']) {
        const value = ref[key] ? String(ref[key]) : '';
        if (value && !bySourceId.has(value)) bySourceId.set(value, id);
      }
      if (ref.kind === 'npc') {
        npcIds.push(id);
        if (ref.npcId) byNpcId.set(String(ref.npcId), id);
      }

      const label = plainText(binding.label ?? binding.sourceElement?.label).toLowerCase().trim();
      if (label && !byLabel.has(label)) byLabel.set(label, id);
    }

    return { byQuest, bySourceId, byLabel, npcIds, byNpcId };
  }

  /** Resolve a free-text snippet back to the binding that carries it, if any. */
  private bindingForText(text: string, index: ReturnType<ExperienceBuildService['buildIndex']>): string | null {
    const needle = plainText(text).toLowerCase().trim();
    if (!needle) return null;
    if (index.byLabel.has(needle)) return index.byLabel.get(needle)!;
    for (const [label, id] of index.byLabel) {
      if (label.length > 8 && (needle.includes(label) || label.includes(needle))) return id;
    }
    return null;
  }

  /**
   * world — the place the experience happens. Regions come from the compiled
   * proceduralMap; the runtime uses them to name and theme its chunks
   * (rooms/waves/chapters/districts) instead of minting "Room 1".
   */
  private world(pkg: Record<string, any>, blueprint: Record<string, any>, bindings: any[], index: ReturnType<ExperienceBuildService['buildIndex']>) {
    const map = blueprint.proceduralMap || pkg.runtimeContract?.map || {};
    const planet = plainText(pkg.experience?.world?.planet);
    const region = plainText(map.regionName);
    const title = this.firstMeaningful([planet, region, plainText(pkg.experience?.title)]) || 'Optomole Experience';

    const regions = this.arrayOf(map.locations)
      .map((location: any, order: number) => {
        const name = plainText(location.name);
        if (!name || GENERIC_WORLD_NAMES.has(name.toLowerCase())) return null;
        return {
          id: `region-${order + 1}`,
          order,
          name,
          description: plainText(location.description),
          type: plainText(location.type) || 'mission_node',
          entityIds: [this.bindingForText(name, index)].filter(Boolean) as string[],
          hazardIds: this.arrayOf(location.hazards)
            .map((hazard: any) => this.bindingForText(plainText(hazard), index))
            .filter(Boolean) as string[],
        };
      })
      .filter(Boolean);

    return {
      kind: 'world.v1',
      identity: {
        title,
        planet: planet || null,
        description: plainText(map.description),
        domain: plainText(pkg.progression?.domain) || null,
      },
      regions,
      emptyReason: regions.length ? undefined : 'proceduralMap carried no usable locations.',
    };
  }

  /**
   * narrative — the order content should be met in. Storyboard scenes carry the
   * selected path through the dependency graph, so beats give an engine its
   * pacing without re-deriving it.
   */
  private narrative(blueprint: Record<string, any>, specification: Record<string, any>, index: ReturnType<ExperienceBuildService['buildIndex']>) {
    const storyboard = blueprint.storyboard || specification.storyboard || {};
    const beats = this.arrayOf(storyboard.scenes)
      .slice()
      .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      .map((scene: any, order: number) => ({
        id: String(scene.id || `beat-${order + 1}`),
        order,
        type: plainText(scene.sceneType) || 'scene',
        title: shortLabel(scene.title) || `Beat ${order + 1}`,
        entityIds: [...this.arrayOf(scene.gameplayAtomIds), ...this.arrayOf(scene.nodeIds)]
          .map((nodeId: any) => index.bySourceId.get(String(nodeId)))
          .filter(Boolean) as string[],
      }));

    return {
      kind: 'narrative.v1',
      beats,
      emptyReason: beats.length ? undefined : 'Storyboard produced no scenes.',
    };
  }

  /**
   * quests — the structure the mapping manifest destroys. Quest-derived bindings
   * keep `sourceRef.questId`, so rebuilding the table is a join, not a re-parse.
   * Every engine can now show a real questline instead of a flat objective pile.
   */
  private quests(blueprint: Record<string, any>, index: ReturnType<ExperienceBuildService['buildIndex']>) {
    const quests = this.arrayOf(blueprint.quests).map((quest: any, order: number) => {
      const questId = String(quest.id || `quest-${order + 1}`);
      const joined = index.byQuest.get(questId) || { objectiveIds: [], evidenceIds: [] };
      return {
        id: questId,
        order,
        title: shortLabel(quest.title) || `Quest ${order + 1}`,
        summary: plainText(quest.summary),
        objectiveIds: joined.objectiveIds,
        evidenceIds: joined.evidenceIds,
        reward: quest.reward || { xp: 100 + order * 25 },
        // Machine-checkable: an engine evaluates this without parsing prose.
        completion: {
          when: 'all-complete',
          targetIds: [...joined.objectiveIds, ...joined.evidenceIds],
        },
      };
    });

    const linked = quests.filter((quest) => quest.objectiveIds.length || quest.evidenceIds.length).length;
    return {
      kind: 'quests.v1',
      quests,
      stats: { total: quests.length, linked },
      emptyReason: quests.length ? undefined : 'Blueprint carried no quests.',
    };
  }

  /** cast — who the player meets, and which quests they hand out. */
  private cast(blueprint: Record<string, any>, bindings: any[], index: ReturnType<ExperienceBuildService['buildIndex']>) {
    const npcBindings = bindings.filter((binding) => binding.gameEntityType === 'npc' || binding.sourceElement?.type === 'npc');
    const declared = this.arrayOf(blueprint.characters);

    const characters = declared.map((character: any, order: number) => {
      const name = shortLabel(character.name || character.title) || `Character ${order + 1}`;
      const bindingId = index.byNpcId.get(String(character.id || '')) || this.bindingForText(name, index) || npcBindings[order]?.id || null;
      return {
        id: String(character.id || `character-${order + 1}`),
        order,
        name,
        role: plainText(character.role) || 'guide',
        bindingId,
        lines: this.arrayOf(character.lines).map((line: any) => plainText(line)).filter(Boolean),
        givesQuestIds: this.arrayOf(character.questIds).map(String),
      };
    });

    // NPC bindings the blueprint never declared as characters still exist in the
    // world (the mapping layer mints them from gameplay NPCs), so carry them.
    for (const binding of npcBindings) {
      if (characters.some((character) => character.bindingId === binding.id)) continue;
      characters.push({
        id: `character-binding-${characters.length + 1}`,
        order: characters.length,
        name: shortLabel(binding.label) || `Guide ${characters.length + 1}`,
        role: 'guide',
        bindingId: String(binding.id),
        lines: this.arrayOf(binding.gameBinding?.dialogue).map((line: any) => plainText(line)).filter(Boolean),
        givesQuestIds: [],
      });
    }

    return {
      kind: 'cast.v1',
      characters,
      emptyReason: characters.length ? undefined : 'No characters or NPC bindings.',
    };
  }

  /**
   * knowledge — the relations between content items. This is the highest-value
   * layer the runtime never received: it turns encounter quizzes from "pick a
   * random sibling" into genuinely related distractors, and lets gates require
   * prerequisites instead of arbitrary counts.
   */
  private knowledge(blueprint: Record<string, any>, specification: Record<string, any>, index: ReturnType<ExperienceBuildService['buildIndex']>) {
    const graph = blueprint.knowledgeGraph || specification.knowledgeGraph || {};
    const relations: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();

    for (const edge of this.arrayOf(graph.edges)) {
      const from = index.bySourceId.get(String(edge.from ?? edge.source ?? ''));
      const to = index.bySourceId.get(String(edge.to ?? edge.target ?? ''));
      if (!from || !to || from === to) continue;
      const type = plainText(edge.type || edge.relation) || 'related_to';
      const key = `${from}->${to}:${type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({
        from,
        to,
        type,
        // Prerequisite edges are the ones a gate can enforce.
        gating: /require|prerequisite|depends|before|precede/i.test(type),
        confidence: typeof edge.confidence === 'number' ? edge.confidence : 0.6,
      });
    }

    return {
      kind: 'knowledge.v1',
      relations,
      stats: {
        graphEdges: this.arrayOf(graph.edges).length,
        resolved: relations.length,
      },
      emptyReason: relations.length
        ? undefined
        : 'Knowledge graph edges did not resolve to bindings (no shared source ids).',
    };
  }

  /** inventory — what the player can carry, derived from carryable bindings. */
  private inventory(bindings: any[]) {
    const items = bindings
      .filter((binding) => ACQUIRE_INTERACTIONS.has(String(binding.interactionType || ''))
        || CARRYABLE_ENTITIES.has(String(binding.gameEntityType || '')))
      .map((binding, order) => {
        const entityType = String(binding.gameEntityType || '');
        const isKey = entityType === 'key-item';
        return {
          id: `item-${order + 1}`,
          bindingId: String(binding.id),
          name: shortLabel(binding.label) || `Item ${order + 1}`,
          acquire: plainText(binding.interactionType) || 'collect',
          // Key items open gates; everything else is evidence the player banks.
          use: isKey ? 'unlock' : 'present-as-evidence',
          consumable: isKey,
          reward: binding.reward || {},
        };
      });

    return {
      kind: 'inventory.v1',
      items,
      emptyReason: items.length ? undefined : 'No carryable bindings in this experience.',
    };
  }

  /**
   * progression — skill branches and achievements. Achievement conditions are
   * emitted as evaluable objects; the compiler's prose ("Complete IRX objective
   * 1") is unusable by any engine, so it becomes a note rather than the rule.
   */
  private progression(pkg: Record<string, any>, blueprint: Record<string, any>) {
    const branches = this.arrayOf(blueprint.skillTree || pkg.progression?.skillTree).map((skill: any, order: number) => ({
      id: String(skill.id || `branch-${order + 1}`),
      label: shortLabel(skill.name || skill.title) || `Branch ${order + 1}`,
      blurb: plainText(skill.description),
      category: plainText(skill.category) || null,
      unlocks: this.arrayOf(skill.unlocks).map(String),
    }));

    const achievements = this.arrayOf(blueprint.achievements).map((achievement: any, order: number) => ({
      id: String(achievement.id || `achievement-${order + 1}`),
      title: shortLabel(achievement.title || achievement.name) || `Achievement ${order + 1}`,
      // Evaluable rule. Without an explicit target the fallback is "finish the
      // experience", which every engine can already check.
      when: { event: 'experience-complete' },
      note: plainText(achievement.condition),
    }));

    return {
      kind: 'progression.v1',
      xpModel: plainText(pkg.runtimeContract?.xpModel) || 'quest-completion',
      xpReward: Number(pkg.progression?.xpReward) || 0,
      branches,
      achievements,
      emptyReason: branches.length || achievements.length ? undefined : 'No skill tree or achievements.',
    };
  }

  /** challenges — the analyst challenge as a first-class, referenceable scene. */
  private challenges(blueprint: Record<string, any>, index: ReturnType<ExperienceBuildService['buildIndex']>) {
    const challenge = blueprint.analystChallenge;
    if (!challenge || typeof challenge !== 'object') {
      return { kind: 'challenges.v1', items: [], emptyReason: 'No analyst challenge compiled.' };
    }

    const correctIds = this.arrayOf(challenge.correctEvidenceSnippets)
      .map((snippet: any) => this.bindingForText(plainText(snippet), index))
      .filter(Boolean) as string[];
    const distractorIds = this.arrayOf(challenge.distractorSnippets)
      .map((snippet: any) => this.bindingForText(plainText(snippet), index))
      .filter(Boolean) as string[];

    return {
      kind: 'challenges.v1',
      items: [
        {
          id: 'challenge-analyst',
          type: 'analyst',
          instructions: plainText(challenge.instructions),
          prompt: plainText(challenge.summaryToVerify),
          correctIds,
          distractorIds,
          // Snippets that never matched a binding still need to be playable.
          correctText: this.arrayOf(challenge.correctEvidenceSnippets).map((snippet: any) => plainText(snippet)).filter(Boolean),
          distractorText: this.arrayOf(challenge.distractorSnippets).map((snippet: any) => plainText(snippet)).filter(Boolean),
        },
      ],
    };
  }

  private firstMeaningful(candidates: string[]): string {
    return candidates.find((value) => value && !GENERIC_WORLD_NAMES.has(value.toLowerCase())) || '';
  }

  /** Item count for coverage reporting — each component's payload array. */
  private countOf(component: any): number {
    if (!component || typeof component !== 'object') return 0;
    for (const key of ['quests', 'regions', 'beats', 'characters', 'relations', 'items', 'branches']) {
      if (Array.isArray(component[key]) && component[key].length) return component[key].length;
    }
    // progression counts either dimension.
    if (Array.isArray(component.achievements) && component.achievements.length) return component.achievements.length;
    return 0;
  }

  private arrayOf(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }
}
