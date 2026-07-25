import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ExperienceCompilerService } from '../compiler/experience-compiler.service';
import { IrxService } from '../irx/irx.service';
import { gatewayConfig } from '../shared/config';
import { classifyExperienceOutputType } from '../shared/experience-output-types';
import { ExperiencePackage, SourcePayload } from '../shared/types';
import { buildRuntimeContract, displayGenre, heuristicArchetype, RUNTIME_ARCHETYPES } from '../shared/runtime-archetypes';

@Injectable()
export class AiGenerationService {
  constructor(
    private readonly compiler: ExperienceCompilerService,
    private readonly irx: IrxService,
  ) {}

  async compileExperience(input: {
    source: SourcePayload;
    options?: Record<string, unknown>;
  }): Promise<ExperiencePackage> {
    const config = gatewayConfig();
    // Fold "model off a favorite game" into options up front so both the AI
    // compiler and the deterministic local fallback are steered by it.
    const options = this.compiler.applyGameReference(input.options || {});
    // Guarantee the compiler receives the full IRX (knowledgeGraph /
    // gameplayNormalization / semanticExtraction). The extracted graph is the
    // ONLY thing that produces content-derived bindings — without it the
    // compiler emits a single generic quest and every build looks identical.
    // The browser used to pre-compute and embed this IRX in source.metadata.irx,
    // but that inflated the request body ~130x (a few hundred KB of text became
    // tens of MB) and 413'd on real uploads, so the customization never arrived.
    // Normalizing server-side from the raw source keeps the client payload tiny.
    const source = this.ensureIrx(input.source, options);
    const enrichedInput = { ...input, source, options };

    if (this.compiler.canCompile(options)) {
      return this.compiler.compileWithAi(source, options);
    }

    const generated = await this.tryPost(`${config.aiGenerationUrl}/v1/experiences/compile`, enrichedInput);
    if (generated) return generated as ExperiencePackage;

    if (config.legacyOptomoleApiUrl) {
      const legacy = await this.tryPost(`${config.legacyOptomoleApiUrl}/api/experience/package`, enrichedInput);
      if (legacy && typeof legacy === 'object' && 'package' in legacy) {
        return (legacy as { package: ExperiencePackage }).package;
      }
    }

    if (config.nodeEnv === 'production') {
      throw new ServiceUnavailableException('AI generation cluster is unavailable.');
    }

    return this.localFallback(source, options);
  }

  /**
   * Ensure `source.metadata.irx` carries a real extracted graph. If the caller
   * already supplied one (legacy browser path, or a pre-normalized person node),
   * we trust it. Otherwise we run the same IrxService the `/irx/normalize` route
   * uses, directly against the raw source, and return the enriched source it
   * produces. Failures degrade gracefully to the original source (the compiler
   * still emits a basic single-quest experience rather than erroring).
   */
  private ensureIrx(source: SourcePayload, options: Record<string, unknown>): SourcePayload {
    const existing = (source?.metadata as Record<string, any> | undefined)?.irx;
    const hasGraph =
      existing && typeof existing === 'object' && (existing.knowledgeGraph || existing.gameplayNormalization);
    if (hasGraph) return source;
    if (!source || (!source.text && !source.title && !source.uri)) return source;

    try {
      const normalized = this.irx.normalize({ source, options });
      return (normalized.source as SourcePayload) || source;
    } catch (_) {
      return source;
    }
  }

  private async tryPost(url: string, body: unknown): Promise<unknown | null> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) return null;
      return response.json();
    } catch (_) {
      return null;
    }
  }

  private localFallback(source: SourcePayload, options: Record<string, unknown> = {}): ExperiencePackage {
    const title = String(options.title || source.title || 'Generated Optimole Experience');
    const experienceId = `exp-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'experience'}`;
    const irx = this.getIrx(source);
    const outputType = classifyExperienceOutputType({
      sourceType: source.sourceType,
      title,
      text: source.text,
      metadata: source.metadata,
    });
    const quests = irx ? this.questsFromIrx(irx, source) : this.singleQuest(title, source);
    const domain = this.domainFor(source, irx);
    const archetypeId = options.genre || options.archetype
      ? heuristicArchetype({
        domain,
        genre: String(options.genre || options.archetype || ''),
        text: JSON.stringify({ title, sourceType: source.sourceType, source: source.text, irx: irx?.classification }),
      })
      : outputType.selected.recommendedArchetype;
    const archetype = RUNTIME_ARCHETYPES[archetypeId];
    const preference = this.templatePreference(options);
    const skillTree = this.skillTree(domain);
    const proceduralMap = this.proceduralMap(title, quests, irx);
    const preprocessing = irx?.preprocessingPipeline || {
      semanticExtraction: irx?.semanticExtraction,
      gameplayNormalization: irx?.gameplayNormalization,
      storyboard: irx?.storyboard,
      knowledgeGraph: irx?.knowledgeGraph,
    };
    return {
      id: experienceId,
      templatePreference: preference,
      source,
      experience: {
        id: experienceId,
        title,
        genre: displayGenre(preference, archetype),
        modeledAfter: (options as any).gameReference || null,
        outputType: outputType.selected.id,
        outputExperience: outputType.selected.output,
        world: { planet: options.worldTitle || 'Knowledge Frontier' },
      },
      blueprint: {
        quests,
        characters: [{ name: 'Optimole Guide', role: 'guide' }],
        achievements: Array.isArray(irx?.achievements)
          ? irx.achievements.map((achievement: string, index: number) => ({
            id: `achievement-${index + 1}`,
            title: achievement,
            condition: `Complete IRX objective ${index + 1}`,
          }))
          : [],
        goals: Array.isArray(irx?.goals) ? irx.goals : [],
        analystChallenge: this.analystChallenge(quests, source),
        skillTree,
        proceduralMap,
        storyboard: irx?.storyboard,
        knowledgeGraph: irx?.knowledgeGraph,
      },
      specification: {
        experienceOutputType: outputType.selected,
        experienceOutputTypeConfidence: outputType.confidence,
        preprocessing,
        semanticExtraction: irx?.semanticExtraction,
        gameplayNormalization: irx?.gameplayNormalization,
        storyboard: irx?.storyboard,
        knowledgeGraph: irx?.knowledgeGraph,
      },
      progression: {
        domain,
        xpReward: quests.reduce((sum: number, quest: any, index: number) => sum + (typeof quest?.reward?.xp === 'number' ? quest.reward.xp : 100 + index * 25), 0),
        skillTree,
        loot: ['Compiled Insight', `${domain[0].toUpperCase()}${domain.slice(1)} Evidence Token`],
        profileVersion: 'optimole-rpg-v3',
      },
      runtimeContract: buildRuntimeContract({ archetypeId, map: proceduralMap }),
      renderTargets: [
        { target: 'pixijs', engine: 'pixijs-runtime', status: 'ready' },
        { target: 'browser', engine: 'pixijs-runtime', status: 'ready' },
      ],
    };
  }

  /** The raw, user-supplied genre/template selection, if any. */
  private templatePreference(options: Record<string, unknown>): string | undefined {
    const pref = options.templateId || options.genre || options.archetype;
    const value = typeof pref === 'string' ? pref.trim() : '';
    return value || undefined;
  }

  private getIrx(source: SourcePayload): any | null {
    const irx = source.metadata?.irx;
    return irx && typeof irx === 'object' ? irx : null;
  }

  private questsFromIrx(irx: any, source: SourcePayload) {
    const blocks = Array.isArray(irx.contentBlocks) ? irx.contentBlocks : [];
    const quests = blocks.slice(0, 12).map((block: any, index: number) => {
      const evidenceCandidates = Array.isArray(block.evidenceCandidates) ? block.evidenceCandidates : [];
      const objectives = Array.isArray(block.objectives) ? block.objectives : [];
      const evidence = evidenceCandidates.length
        ? evidenceCandidates.map((candidate: any) => ({ text: candidate.text || candidate.label || String(candidate), correct: true }))
        : [{ text: block.summary || block.title || source.text || 'Review the source material.', correct: true }];

      return {
        id: `quest-${index + 1}`,
        title: block.title || `${irx.title || 'IRX'} Objective ${index + 1}`,
        summary: block.summary || objectives.join(' ') || source.text || 'Complete the generated mission.',
        objectives: objectives.map((objective: string, objectiveIndex: number) => ({
          id: `objective-${index + 1}-${objectiveIndex + 1}`,
          title: objective,
          prompt: objective,
        })),
        reward: { xp: 100 + index * 25 },
        evidence,
      };
    });

    return quests.length ? quests : this.singleQuest(irx.title || source.title || 'Generated Mission', source);
  }

  private singleQuest(title: string, source: SourcePayload) {
    return [
      {
        id: 'quest-1',
        title,
        summary: source.text || 'Complete the generated mission.',
        reward: { xp: 100 },
        evidence: [{ text: source.text || 'Complete the generated mission.', correct: true }],
      },
    ];
  }

  private domainFor(source: SourcePayload, irx: any | null) {
    const explicit = String(irx?.classification?.domain || source.metadata?.domain || '').toLowerCase();
    if (['strategy', 'science', 'defense', 'engineering'].includes(explicit)) return explicit;
    const text = JSON.stringify(source).toLowerCase();
    const scores = {
      strategy: ['market', 'roadmap', 'competitor', 'growth', 'decision', 'client'].filter((term) => text.includes(term)).length,
      science: ['research', 'model', 'experiment', 'data', 'gradient', 'theory'].filter((term) => text.includes(term)).length,
      defense: ['security', 'risk', 'threat', 'compliance', 'credential', 'breach'].filter((term) => text.includes(term)).length,
      engineering: ['system', 'api', 'build', 'deploy', 'power', 'workflow', 'infrastructure'].filter((term) => text.includes(term)).length,
    };
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'engineering';
  }

  private analystChallenge(quests: any[], source: SourcePayload) {
    const firstQuest = quests[0] || {};
    const evidence = Array.isArray(firstQuest.evidence) ? firstQuest.evidence : [];
    return {
      instructions: 'Select every source-backed evidence snippet and reject distractors.',
      summaryToVerify: firstQuest.summary || source.text || 'Verify the compiled mission.',
      correctEvidenceSnippets: evidence.filter((item: any) => item.correct !== false).map((item: any) => String(item.text || item.label || item)).slice(0, 6),
      distractorSnippets: evidence.filter((item: any) => item.correct === false).map((item: any) => String(item.text || item.label || item)).slice(0, 4),
    };
  }

  private skillTree(domain: string) {
    return [
      { id: `${domain}-triage`, name: 'Source Triage', description: 'Prioritize source items by mission value.', category: domain, unlocks: [`${domain}-evidence`] },
      { id: `${domain}-evidence`, name: 'Evidence Binding', description: 'Bind objectives to source-backed proof.', category: domain, unlocks: [`${domain}-runtime`] },
      { id: `${domain}-runtime`, name: 'Runtime Transfer', description: 'Carry compiled knowledge into browser and engine runtimes.', category: domain, unlocks: [] },
    ];
  }

  private proceduralMap(title: string, quests: any[], irx: any | null = null) {
    const locations = quests.slice(0, 6).map((quest: any, index: number) => ({
      name: quest.title || `Mission Node ${index + 1}`,
      description: quest.summary || 'Compiled quest location.',
      type: 'mission_node',
      hazards: (Array.isArray(quest.evidence) ? quest.evidence : []).filter((item: any) => item.correct === false).map((item: any) => String(item.text || item.label || item)).slice(0, 3),
      spawns: ['Evidence prompt', 'Objective marker'],
      lootTable: ['Compiled Insight', 'Evidence Token'],
    }));

    // A single pasted blob compiles to one quest, which used to leave the world
    // map with one location — so the playable's rooms/waves/chapters had nothing
    // to be named after. Extend the map from the gameplay projection: each
    // gameplay atom is a place in the person's content the runtime can walk.
    const seen = new Set(locations.map((loc) => loc.name.toLowerCase()));
    const atoms = Array.isArray(irx?.gameplayNormalization?.gameplayAtoms) ? irx.gameplayNormalization.gameplayAtoms : [];
    for (const atom of atoms) {
      if (locations.length >= 6) break;
      const name = String(atom.label || atom.title || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      locations.push({
        name,
        description: String(atom.summary || atom.successCondition || `Explore: ${name}`),
        type: String(atom.gameplayType || 'concept_node'),
        hazards: [],
        spawns: ['Evidence prompt', 'Objective marker'],
        lootTable: ['Compiled Insight', 'Evidence Token'],
      });
    }

    return {
      regionName: title,
      description: 'A domain map generated from compiled source signals.',
      locations,
    };
  }
}
