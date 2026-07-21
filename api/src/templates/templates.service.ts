import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';
import { id } from '../shared/ids';
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
    const quests = Array.isArray(pkg.blueprint?.quests) ? pkg.blueprint.quests as Array<Record<string, any>> : [];
    const bindings = quests.flatMap((quest, questIndex) => {
      const objectiveBindings = this.arrayOf(quest.objectives).map((objective, objectiveIndex) => {
        const text = `${objective.title || ''} ${objective.prompt || ''} ${quest.title || ''} ${quest.summary || ''}`;
        const rule = this.matchRule(mappingRules.rules, text, 'procedure-step');
        return this.binding(rule, {
          sourceRef: { kind: 'objective', questId: quest.id, questIndex, objectiveIndex },
          label: objective.title || quest.title || `Objective ${objectiveIndex + 1}`,
          description: objective.prompt || quest.summary || '',
          reward: quest.reward || {},
        });
      });

      const evidenceBindings = this.arrayOf(quest.evidence).map((evidence, evidenceIndex) => {
        const text = `${evidence.kind || ''} ${evidence.text || ''} ${quest.title || ''}`;
        const fallback = evidence.correct === false ? 'hazard' : 'evidence';
        const rule = this.matchRule(mappingRules.rules, text, fallback);
        return this.binding(rule, {
          sourceRef: { kind: 'evidence', questId: quest.id, questIndex, evidenceIndex },
          label: evidence.text || `Evidence ${evidenceIndex + 1}`,
          description: evidence.text || '',
          reward: evidence.correct === false ? { focusPenalty: 15 } : quest.reward || {},
        });
      });

      return [...objectiveBindings, ...evidenceBindings];
    });

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
      bindings,
    };
  }

  private binding(rule: MappingRule, input: { sourceRef: Record<string, unknown>; label: string; description: string; reward: Record<string, unknown> }) {
    const sourceElement = {
      type: rule.workElementType,
      label: input.label,
      description: input.description,
      evidence: input.description,
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
      spawnRules: { placement: 'template-default', priority: rule.priority || 0 },
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

  private matchRule(rules: MappingRule[], text: string, fallbackWorkType: string): MappingRule {
    const lowered = String(text || '').toLowerCase();
    const scored = rules
      .map((rule) => ({
        rule,
        score: (rule.priority || 0) + (rule.sourceSignals || []).filter((signal) => lowered.includes(signal.toLowerCase())).length * 50,
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
