import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';
import { id } from '../shared/ids';
import { phraseLabel, plainText, shortLabel } from '../shared/text';
import { EngineTarget, ExperiencePackage } from '../shared/types';

export interface RegistryEntry {
  id: string;
  name: string;
  genreFamily: string;
  templatePath: string;
  mappingRulesPath: string;
  status: string;
  engineTargets: string[];
  bestFor?: string[];
}

export interface TemplateRegistry {
  schemaVersion: string;
  kind: string;
  name: string;
  defaultTemplateId: string;
  templates: RegistryEntry[];
}

export interface TemplateManifest {
  id: string;
  name: string;
  genreFamily: string;
  version: string;
  engineTargets: string[];
  mechanics: string[];
  runtimeLoop?: string[];
  entityTypes: string[];
  interactionTypes: string[];
  assetSlots: Array<Record<string, unknown>>;
  dataContract?: Record<string, unknown>;
  engineSkeletons: Record<string, { kind: string; path: string; loader: string; notes?: string }>;
}

export interface MappingRule {
  id: string;
  workElementType: string;
  sourceSignals?: string[];
  gameEntityType: string;
  interactionType: string;
  templateSlot: string;
  priority?: number;
  feedbackStrategy?: string;
  rewardStrategy?: string;
}

export interface MappingRules {
  schemaVersion: string;
  templateId: string;
  rules: MappingRule[];
}

export interface RegisterTemplateInput {
  entry: RegistryEntry;
  template: TemplateManifest;
  mappingRules: MappingRules;
}

@Injectable()
export class TemplatesService {
  listTemplates() {
    const registry = this.loadRegistry();
    return {
      ok: true,
      registry: {
        schemaVersion: registry.schemaVersion,
        name: registry.name,
        defaultTemplateId: registry.defaultTemplateId,
      },
      templates: registry.templates,
    };
  }

  getTemplate(templateId: string) {
    const entry = this.findEntry(templateId);
    return {
      ok: true,
      template: this.loadTemplate(entry),
      mappingRules: this.loadMappingRules(entry),
    };
  }

  resolve(input: { package: ExperiencePackage; target?: EngineTarget; preferredTemplateId?: string }) {
    if (!input.package) throw new BadRequestException('package is required.');
    const target = input.target || 'browser';
    // Precedence: explicit templateId > the user's genre selection carried on
    // the package (templatePreference) > content-inferred recommendation.
    const hintEntry = input.preferredTemplateId ? null : this.matchEntryByHint(input.package.templatePreference, target);
    const entry = input.preferredTemplateId
      ? this.findEntry(input.preferredTemplateId)
      : hintEntry || this.recommendEntry(input.package, target);
    const template = this.loadTemplate(entry);
    const mappingRules = this.loadMappingRules(entry);

    if (!template.engineTargets.includes(target)) {
      throw new BadRequestException(`Template ${template.id} does not support target ${target}.`);
    }

    return {
      ok: true,
      template,
      mappingManifest: this.buildMappingManifest(input.package, template, mappingRules, target),
    };
  }

  register(input: RegisterTemplateInput) {
    if (!input?.entry?.id || !input.template || !input.mappingRules) {
      throw new BadRequestException('entry, template, and mappingRules are required.');
    }
    if (input.entry.id !== input.template.id || input.entry.id !== input.mappingRules.templateId) {
      throw new BadRequestException('entry.id, template.id, and mappingRules.templateId must match.');
    }

    const registry = this.loadRegistry();
    const folder = this.safeFolderName(input.entry.id);
    const registryDir = path.dirname(this.registryPath());
    fs.mkdirSync(path.join(registryDir, folder), { recursive: true });

    const entry: RegistryEntry = {
      ...input.entry,
      templatePath: `${folder}/template.json`,
      mappingRulesPath: `${folder}/mapping-rules.json`,
      status: input.entry.status || 'active',
      engineTargets: input.template.engineTargets,
    };

    fs.writeFileSync(path.join(registryDir, entry.templatePath), JSON.stringify(input.template, null, 2), 'utf8');
    fs.writeFileSync(path.join(registryDir, entry.mappingRulesPath), JSON.stringify(input.mappingRules, null, 2), 'utf8');

    const nextTemplates = registry.templates.filter((item) => item.id !== entry.id);
    nextTemplates.push(entry);
    fs.writeFileSync(this.registryPath(), JSON.stringify({ ...registry, templates: nextTemplates }, null, 2), 'utf8');

    return { ok: true, entry, template: input.template, mappingRules: input.mappingRules };
  }

  compatibility(templateId: string, target?: EngineTarget) {
    const entry = this.findEntry(templateId);
    const template = this.loadTemplate(entry);
    const targetSupported = target ? template.engineTargets.includes(target) : true;
    return {
      ok: true,
      templateId,
      target: target || null,
      compatible: targetSupported,
      engineTargets: template.engineTargets,
      mechanics: template.mechanics,
      requiredAssetSlots: template.assetSlots.filter((slot) => slot.required === true),
      engineSkeleton: target ? template.engineSkeletons[target] || null : null,
      issues: targetSupported ? [] : [`Template ${templateId} does not support target ${target}.`],
    };
  }

  validatePackage(templateId: string, input: { package: ExperiencePackage; target?: EngineTarget }) {
    const resolved = this.resolve({ package: input.package, target: input.target || 'browser', preferredTemplateId: templateId });
    const template = resolved.template;
    const manifest = resolved.mappingManifest;
    const requiredBindings = Array.isArray(template.dataContract?.requiredBindings)
      ? template.dataContract.requiredBindings as string[]
      : [];
    const presentWorkTypes = new Set(manifest.bindings.map((binding: any) => binding.sourceElement?.type || binding.workElementType));
    const missingRequiredBindings = requiredBindings.filter((binding) => !presentWorkTypes.has(binding));
    const missingRequiredAssetSlots = template.assetSlots
      .filter((slot) => slot.required === true)
      .filter((slot) => !manifest.bindings.some((binding: any) => binding.gameBinding?.templateSlot === slot.id || binding.templateSlot === slot.id))
      .map((slot) => slot.id);

    return {
      ok: true,
      valid: missingRequiredBindings.length === 0,
      templateId,
      target: input.target || 'browser',
      missingRequiredBindings,
      missingRequiredAssetSlots,
      bindingCount: manifest.bindings.length,
      mappingManifest: manifest,
    };
  }

  private buildMappingManifest(pkg: ExperiencePackage, template: TemplateManifest, mappingRules: MappingRules, target: EngineTarget) {
    // Content precedence: the pipeline's gameplay projection (gameplayNormalization
    // / knowledgeGraph) is the highest-fidelity view of the ingested source — it
    // already carries per-element gameplay type, interaction, salience and reward.
    // Quest bindings supplement it. Historically only quests were read, so every
    // extracted concept, entity and action was discarded at build time.
    const graphBindings = this.graphBindings(pkg, mappingRules);
    const questBindings = this.questBindings(pkg, mappingRules);
    const bindings = this.dedupeBindings([...graphBindings, ...questBindings]).slice(0, TemplatesService.MAX_BINDINGS);

    return {
      schemaVersion: '1.0.0',
      id: id('mapping'),
      templateId: template.id,
      experienceId: pkg.experience?.id || pkg.id || id('exp'),
      target,
      generatedAt: new Date().toISOString(),
      engineSkeleton: template.engineSkeletons[target] || null,
      requiredRuntimeSystems: template.mechanics,
      assetSlots: template.assetSlots,
      bindingSources: {
        graph: graphBindings.length,
        quests: questBindings.length,
        emitted: bindings.length,
      },
      bindings,
    };
  }

  private questBindings(pkg: ExperiencePackage, mappingRules: MappingRules) {
    const quests = Array.isArray(pkg.blueprint?.quests) ? pkg.blueprint.quests as Array<Record<string, any>> : [];
    return quests.flatMap((quest, questIndex) => {
      const objectiveBindings = this.arrayOf(quest.objectives).map((objective, objectiveIndex) => {
        // Packages can arrive here without passing through compiler normalization
        // (a client may POST one straight to /v1/builds), so an objective may still
        // be a bare string. plainText handles both shapes.
        const description = plainText(objective) || plainText(quest.summary);
        // A package can reach here without compiler normalization (a client may
        // POST one straight to /v1/builds), so the sentence may still be raw.
        // Naming it here too means the binding label is a name on every path.
        const label = phraseLabel(objective?.title) || phraseLabel(description) || `Objective ${objectiveIndex + 1}`;
        const text = `${objective.title || ''} ${objective.prompt || ''} ${quest.title || ''} ${quest.summary || ''}`;
        const rule = this.matchRule(mappingRules.rules, text, 'procedure-step');
        return this.binding(rule, {
          sourceRef: { kind: 'objective', questId: quest.id, questIndex, objectiveIndex },
          label,
          description,
          reward: quest.reward || {},
        });
      });

      const evidenceBindings = this.arrayOf(quest.evidence).map((evidence, evidenceIndex) => {
        const description = plainText(evidence);
        const label = phraseLabel(evidence?.label) || phraseLabel(description) || `Evidence ${evidenceIndex + 1}`;
        const text = `${evidence.kind || ''} ${evidence.text || ''} ${quest.title || ''}`;
        const fallback = evidence.correct === false ? 'hazard' : 'evidence';
        const rule = this.matchRule(mappingRules.rules, text, fallback);
        return this.binding(rule, {
          sourceRef: { kind: 'evidence', questId: quest.id, questIndex, evidenceIndex },
          label,
          description,
          reward: evidence.correct === false ? { focusPenalty: 15 } : quest.reward || {},
        });
      });

      return [...objectiveBindings, ...evidenceBindings];
    });
  }

  /** Upper bound on emitted bindings — a large graph should not produce an unplayable room count. */
  private static readonly MAX_BINDINGS = 60;

  /**
   * Gameplay atom type -> the work-element type the template's mapping rules key
   * off. This keeps each template in charge of the concrete game entity: an
   * `inventory_item` becomes a key-item in key-lock and a collectible in arcade,
   * because both declare an `evidence` rule.
   */
  private static readonly ATOM_WORK_TYPE: Record<string, string> = {
    quiz: 'evidence',
    inventory_item: 'evidence',
    puzzle: 'procedure-step',
    mission: 'procedure-step',
    challenge: 'procedure-step',
    simulation: 'metric',
    branch: 'decision-point',
    boss_battle: 'hazard',
    avoidance_challenge: 'hazard',
  };

  /** Semantic/KG node type -> work-element type, for sources with no gameplay layer. */
  private static readonly NODE_WORK_TYPE: Record<string, string> = {
    learning_objective: 'procedure-step',
    action: 'procedure-step',
    concept: 'evidence',
    proper_noun: 'evidence',
    entity: 'evidence',
    person: 'evidence',
    place: 'evidence',
  };

  /**
   * Project the ingested content graph into bindings.
   *
   * Prefers `gameplayNormalization.gameplayAtoms` (already typed for gameplay),
   * falling back to the semantic layer of the knowledge graph. Atom labels are
   * short by construction, so descriptions are enriched from the originating
   * semantic node's `context` — that's the sentence the element was extracted
   * from, and it is what the runtime shows as evidence.
   */
  private graphBindings(pkg: ExperiencePackage, mappingRules: MappingRules) {
    const blueprint = (pkg.blueprint || {}) as Record<string, any>;
    const specification = (pkg.specification || {}) as Record<string, any>;
    const gameplay = blueprint.gameplayNormalization || specification.gameplayNormalization || null;
    const graph = blueprint.knowledgeGraph || specification.knowledgeGraph || null;
    const semantic = blueprint.semanticExtraction || specification.semanticExtraction || null;
    const storyboard = blueprint.storyboard || specification.storyboard || null;

    const context = this.sourceContextIndex(semantic, graph);
    const order = this.storyboardOrder(storyboard);
    const atoms = this.arrayOf(gameplay?.gameplayAtoms);
    const items = atoms.length ? atoms : this.semanticNodes(graph);
    if (!items.length) return [] as ReturnType<TemplatesService['binding']>[];

    const bindings = items.map((item, index) => {
      const atomType = String(item.gameplayType || item.type || '').toLowerCase();
      const declaredWorkType = atoms.length
        ? TemplatesService.ATOM_WORK_TYPE[atomType]
        : TemplatesService.NODE_WORK_TYPE[atomType];

      const sourceId = String(item.sourceId || item.id || '');
      const label = shortLabel(item.label || item.title) || `Element ${index + 1}`;
      // The extracted sentence, when we can find it; otherwise the label stands alone.
      const description = plainText(context.get(sourceId)) || plainText(item.summary) || label;
      // A declared gameplay type is authoritative. Keyword matching only guesses
      // for untyped elements — running it over the source sentence would let
      // words like "decide" or "if" reclassify a collectible as a gate.
      const rule = declaredWorkType
        ? this.ruleFor(mappingRules.rules, declaredWorkType)
        : this.matchRule(mappingRules.rules, `${label} ${description}`, atoms.length ? 'procedure-step' : 'evidence');

      // Narrative order drives spawn priority: the runtime sorts descending, so
      // earlier storyboard elements land in earlier rooms.
      const sequence = order.get(String(item.id)) ?? order.get(sourceId) ?? index;
      return this.binding(rule, {
        sourceRef: { kind: 'graph', atomId: item.id || null, sourceId: sourceId || null, sourceKind: item.sourceKind || item.type || null },
        label,
        description,
        evidence: description,
        reward: this.atomReward(item),
        priority: TemplatesService.MAX_BINDINGS * 2 - sequence,
      });
    });

    const npcBindings = this.arrayOf(gameplay?.npcs).map((npc, index) => this.npcBinding(npc, gameplay, index));
    return [...npcBindings, ...bindings];
  }

  /** Map a source element id -> the sentence it was extracted from. */
  private sourceContextIndex(semantic: any, graph: any): Map<string, string> {
    const index = new Map<string, string>();
    const remember = (node: any) => {
      const key = String(node?.id || '');
      if (!key) return;
      const text = plainText(node.context) || plainText(node.text) || plainText(node.goalStatement);
      if (text) index.set(key, text);
    };
    for (const key of ['concepts', 'entities', 'actions', 'people', 'places', 'learningObjectives']) {
      this.arrayOf(semantic?.[key]).forEach(remember);
    }
    for (const node of this.arrayOf(graph?.nodes)) {
      remember({ id: node.id, ...(node.properties || {}) });
    }
    return index;
  }

  /** Element id -> position along the storyboard's selected narrative path. */
  private storyboardOrder(storyboard: any): Map<string, number> {
    const order = new Map<string, number>();
    const push = (rawId: unknown) => {
      const key = String(rawId || '');
      if (key && !order.has(key)) order.set(key, order.size);
    };
    for (const scene of this.arrayOf(storyboard?.scenes).sort((a, b) => (a.order || 0) - (b.order || 0))) {
      this.arrayOf(scene.gameplayAtomIds).forEach(push);
      this.arrayOf(scene.nodeIds).forEach(push);
    }
    this.arrayOf(storyboard?.selectedPath?.nodeIds).forEach(push);
    for (const anchor of this.arrayOf(storyboard?.anchorNodes)) push(anchor.id);
    return order;
  }

  /** Semantic-layer graph nodes, used when no gameplay projection exists. */
  private semanticNodes(graph: any): Array<Record<string, any>> {
    return this.arrayOf(graph?.nodes)
      .filter((node) => node.layer === 'semantic' || TemplatesService.NODE_WORK_TYPE[String(node.type || '').toLowerCase()])
      .map((node) => ({
        id: node.id,
        sourceId: node.id,
        label: node.label,
        type: node.type,
        sourceKind: node.type,
        ...(node.properties || {}),
      }));
  }

  private atomReward(item: Record<string, any>): Record<string, unknown> {
    const reward = (item.reward || {}) as Record<string, unknown>;
    const salience = Number(item.salience);
    return {
      ...reward,
      ...(Number.isFinite(salience) ? { salience } : {}),
      ...(item.successCondition ? { successCondition: item.successCondition } : {}),
    };
  }

  /**
   * NPCs bypass rule matching: no template declares a work-element rule for them,
   * but the runtime looks for `gameEntityType === 'npc'` when populating rooms.
   */
  private npcBinding(npc: Record<string, any>, gameplay: any, index: number) {
    const dialogue = this.arrayOf(gameplay?.npcDialogue).find((line) => line.npcId === npc.id);
    const lines = this.arrayOf(dialogue?.lines).map((line) => plainText(line)).filter(Boolean);
    const label = shortLabel(npc.name) || `Guide ${index + 1}`;
    const description = plainText(dialogue?.prompt) || plainText(npc.role) || label;
    return {
      id: id('binding'),
      sourceElement: {
        type: 'npc',
        label,
        description,
        evidence: lines.join(' ') || description,
        sourceRef: { kind: 'npc', npcId: npc.id || null, missionId: npc.missionId || null },
        mediaRefs: [],
      },
      gameBinding: {
        gameEntityType: 'npc',
        interactionType: 'talk',
        mechanic: 'npc',
        templateSlot: 'room-npc',
        gameVerb: 'talk',
        workVerb: 'npc',
        feedback: 'dialogue',
        reward: { strategy: 'dialogue', trust: npc.trust ?? 50 },
        successConditions: ['complete:talk'],
        failureConditions: [],
        spawnRules: { placement: 'template-default', priority: TemplatesService.MAX_BINDINGS * 2 },
        dialogue: lines,
      },
      sourceRef: { kind: 'npc', npcId: npc.id || null },
      workElementType: 'npc',
      gameEntityType: 'npc',
      interactionType: 'talk',
      templateSlot: 'room-npc',
      label,
      description,
      feedback: 'dialogue',
      reward: { strategy: 'dialogue', trust: npc.trust ?? 50 },
    };
  }

  /**
   * Drop bindings that repeat an element already emitted. The compiler can emit
   * the same excerpt several times (once per quest it appears in), and the graph
   * layer overlaps the quest layer by construction.
   */
  private dedupeBindings<T extends { sourceElement?: any; label?: string }>(bindings: T[]): T[] {
    const seen = new Set<string>();
    return bindings.filter((binding) => {
      const label = plainText(binding.sourceElement?.label ?? binding.label).toLowerCase().replace(/\s+/g, ' ').trim();
      const key = `${binding.sourceElement?.type || ''}::${label}`;
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private binding(rule: MappingRule, input: { sourceRef: Record<string, unknown>; label: string; description: string; evidence?: string; reward: Record<string, unknown>; priority?: number }) {
    const sourceElement = {
      type: rule.workElementType,
      label: input.label,
      description: input.description,
      // Callers that have a distinct supporting excerpt pass it explicitly;
      // otherwise the description doubles as the evidence body.
      evidence: input.evidence ?? input.description,
      sourceRef: input.sourceRef,
      mediaRefs: [],
    };
    const gameBinding = {
      gameEntityType: rule.gameEntityType,
      interactionType: rule.interactionType,
      mechanic: rule.gameEntityType,
      templateSlot: rule.templateSlot,
      gameVerb: rule.interactionType,
      workVerb: rule.workElementType,
      feedback: rule.feedbackStrategy,
      reward: {
        strategy: rule.rewardStrategy,
        ...input.reward,
      },
      successConditions: [`complete:${rule.interactionType}`],
      failureConditions: rule.interactionType === 'avoid' ? ['collision', 'incorrect-selection'] : ['incorrect-selection'],
      spawnRules: { placement: 'template-default', priority: input.priority ?? rule.priority ?? 0 },
    };
    return {
      id: id('binding'),
      sourceElement,
      gameBinding,
      sourceRef: input.sourceRef,
      workElementType: rule.workElementType,
      gameEntityType: rule.gameEntityType,
      interactionType: rule.interactionType,
      templateSlot: rule.templateSlot,
      label: input.label,
      description: input.description,
      feedback: rule.feedbackStrategy,
      reward: {
        strategy: rule.rewardStrategy,
        ...input.reward,
      },
    };
  }

  /**
   * Signals are matched on word boundaries. Plain substring matching made short
   * signals ("if", "step", "target") fire inside unrelated words ("specific",
   * "sidestep", "targeting"), which skewed long excerpts toward whichever rule
   * happened to own the most common fragments.
   */
  private static readonly SIGNAL_PATTERNS = new Map<string, RegExp>();

  private signalPattern(signal: string): RegExp {
    const key = signal.toLowerCase();
    let pattern = TemplatesService.SIGNAL_PATTERNS.get(key);
    if (!pattern) {
      pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      TemplatesService.SIGNAL_PATTERNS.set(key, pattern);
    }
    return pattern;
  }

  /** The rule a template declares for a known work-element type. */
  private ruleFor(rules: MappingRule[], workElementType: string): MappingRule {
    return rules.find((rule) => rule.workElementType === workElementType) || rules[0];
  }

  private matchRule(rules: MappingRule[], text: string, fallbackWorkType: string): MappingRule {
    const lowered = String(text || '').toLowerCase();
    const scored = rules
      .map((rule) => ({
        rule,
        score: (rule.priority || 0) + (rule.sourceSignals || []).filter((signal) => this.signalPattern(signal).test(lowered)).length * 50,
      }))
      .sort((a, b) => b.score - a.score);
    return scored.find((item) => item.score > (item.rule.priority || 0))?.rule
      || rules.find((rule) => rule.workElementType === fallbackWorkType)
      || rules[0];
  }

  /**
   * Map a runtime archetype id (mission-rpg, business-sim, ...) to the template
   * genreFamily it plays best in. Lets a user pass an archetype and still land
   * on the right template.
   */
  private static readonly ARCHETYPE_FAMILY: Record<string, string> = {
    'mission-rpg': 'rpg',
    'escape-room': 'action-adventure',
    'adventure': 'open-world-action',
    'business-sim': 'board-sim',
    'detective': 'shooter',
  };

  /**
   * Resolve a user-supplied genre/template hint to a registered template that
   * supports the target. Accepts a full template id (`quest-rpg-progression.v1`),
   * a versionless id (`quest-rpg-progression`), a genreFamily (`rpg`), or a
   * runtime archetype (`mission-rpg`). Returns null when nothing matches
   * confidently, so callers fall back to content-based recommendation.
   */
  private matchEntryByHint(hint: string | undefined, target: EngineTarget): RegistryEntry | null {
    const raw = String(hint || '').trim().toLowerCase();
    if (!raw) return null;
    const candidates = this.loadRegistry().templates.filter(
      (entry) => entry.status === 'active' && entry.engineTargets.includes(target),
    );
    if (!candidates.length) return null;

    const stripVersion = (value: string) => value.toLowerCase().replace(/\.v\d+$/, '');
    const family = TemplatesService.ARCHETYPE_FAMILY[raw] || raw;

    return (
      candidates.find((entry) => entry.id.toLowerCase() === raw || stripVersion(entry.id) === raw) ||
      candidates.find((entry) => entry.genreFamily.toLowerCase() === family) ||
      candidates.find((entry) => stripVersion(entry.id).includes(raw) || raw.includes(stripVersion(entry.id))) ||
      candidates.find((entry) => entry.genreFamily.toLowerCase().includes(family) || family.includes(entry.genreFamily.toLowerCase())) ||
      null
    );
  }

  private recommendEntry(pkg: ExperiencePackage, target: EngineTarget): RegistryEntry {
    const registry = this.loadRegistry();
    const genre = String((pkg.experience?.genre as { id?: string; title?: string } | undefined)?.id || (pkg.experience?.genre as { title?: string } | undefined)?.title || '').toLowerCase();
    const text = JSON.stringify({
      genre,
      sourceType: pkg.source?.sourceType,
      title: pkg.experience?.title,
      experienceOutputType: (pkg.experience as any)?.outputType || (pkg.specification as any)?.experienceOutputType,
      outputExperience: (pkg.experience as any)?.outputExperience,
      blueprint: pkg.blueprint,
    }).toLowerCase();

    const candidates = registry.templates.filter((entry) => entry.status === 'active' && entry.engineTargets.includes(target));
    if (!candidates.length) throw new NotFoundException(`No active templates support target ${target}.`);

    const scored = candidates.map((entry) => {
      let score = entry.id === registry.defaultTemplateId ? 10 : 0;
      if (genre && entry.id === genre) score += 250;
      if (genre && entry.id.includes(genre)) score += 100;
      if (genre && entry.genreFamily.toLowerCase().includes(genre)) score += 80;
      if (text.includes('hazard') || text.includes('definition')) score += entry.genreFamily === 'arcade' ? 60 : 0;
      if (text.includes('step') || text.includes('sop') || text.includes('procedure') || text.includes('course')) score += entry.genreFamily === 'action-adventure' ? 70 : 0;
      if (text.includes('metric') || text.includes('budget') || text.includes('decision') || text.includes('tradeoff')) score += entry.genreFamily === 'board-sim' ? 70 : 0;
      if (text.includes('daily') || text.includes('habit') || text.includes('task') || text.includes('reading')) score += entry.genreFamily === 'idle' ? 70 : 0;
      if (text.includes('threat') || text.includes('judgement') || text.includes('true-vs-false')) score += entry.genreFamily === 'shooter' ? 70 : 0;
      if (text.includes('backlog') || text.includes('checklist') || text.includes('runbook')) score += entry.genreFamily === 'open-world-action' ? 70 : 0;
      if (text.includes('ebook') || text.includes('chapter') || text.includes('certification')) score += entry.genreFamily === 'rpg' ? 70 : 0;
      if (text.includes('reference') || text.includes('manual') || text.includes('knowledge base')) score += entry.genreFamily === 'sandbox-survival' ? 70 : 0;
      if (text.includes('recall') || text.includes('research notes') || text.includes('concept')) score += entry.genreFamily === 'learning-navigation' ? 70 : 0;
      if (text.includes('educational-experience') || text.includes('interactive learning adventure')) score += entry.genreFamily === 'rpg' || entry.genreFamily === 'learning-navigation' ? 90 : 0;
      if (text.includes('business-simulation') || text.includes('ceo decision simulation')) score += entry.genreFamily === 'board-sim' ? 100 : 0;
      if (text.includes('research-exploration') || text.includes('laboratory investigation')) score += entry.genreFamily === 'learning-navigation' || entry.genreFamily === 'shooter' ? 90 : 0;
      if (text.includes('personal-story') || text.includes('interactive biography')) score += entry.genreFamily === 'open-world-action' || entry.genreFamily === 'rpg' ? 90 : 0;
      return { entry, score };
    }).sort((a, b) => b.score - a.score);

    return scored[0].entry;
  }

  private findEntry(templateId: string): RegistryEntry {
    const registry = this.loadRegistry();
    const entry = registry.templates.find((item) => item.id === templateId);
    if (!entry) throw new NotFoundException(`Template not found: ${templateId}`);
    return entry;
  }

  private loadRegistry(): TemplateRegistry {
    const registryPath = this.registryPath();
    return JSON.parse(fs.readFileSync(registryPath, 'utf8')) as TemplateRegistry;
  }

  private loadTemplate(entry: RegistryEntry): TemplateManifest {
    return JSON.parse(fs.readFileSync(this.resolveTemplatePath(entry.templatePath), 'utf8')) as TemplateManifest;
  }

  private loadMappingRules(entry: RegistryEntry): MappingRules {
    return JSON.parse(fs.readFileSync(this.resolveTemplatePath(entry.mappingRulesPath), 'utf8')) as MappingRules;
  }

  private registryPath(): string {
    return path.resolve(process.cwd(), gatewayConfig().templateRegistryPath);
  }

  private resolveTemplatePath(relativePath: string): string {
    return path.resolve(path.dirname(this.registryPath()), relativePath);
  }

  private arrayOf(value: unknown): Array<Record<string, any>> {
    return Array.isArray(value) ? value as Array<Record<string, any>> : [];
  }

  private safeFolderName(value: string): string {
    return String(value).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/(^-|-$)/g, '');
  }
}
