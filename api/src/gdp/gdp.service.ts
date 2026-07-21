import { Injectable } from '@nestjs/common';
import { AiGenerationService } from '../integrations/ai-generation.service';
import { SourcePayload } from '../shared/types';
import { gatewayConfig } from '../shared/config';

@Injectable()
export class GdpService {
  constructor(private readonly aiGeneration: AiGenerationService) {}

  async create(body: { source: SourcePayload; options?: Record<string, unknown> }) {
    const compiled = await this.aiGeneration.compileExperience(body);
    const anyPackage = compiled as any;
    const manifest = this.buildExperienceManifest(compiled, body.options || {});
    return {
      ok: true,
      experienceManifest: manifest,
      documents: {
        'Knowledge_graph.json': anyPackage.graphs?.knowledgeGraph || {},
        'narrative.json': compiled.blueprint?.story || {},
        'world.json': compiled.experience?.world || {},
        'npcs.json': { npcs: compiled.blueprint?.characters || [] },
        'dialogue.json': anyPackage.specification?.ai?.npcDialogue || {},
        'gameplay.json': { runtimeContract: compiled.runtimeContract || {}, personalization: compiled.personalization || {} },
        'quest.json': { quests: compiled.blueprint?.quests || [] },
        'progression.json': { skills: compiled.blueprint?.skills || {}, achievements: compiled.blueprint?.achievements || [] },
        'assets.json': compiled.assetPlan || {},
        'analytics.json': compiled.analytics || {},
        'publishing.json': compiled.publishing || {},
      },
    };
  }

  async manifest(body: { source: SourcePayload; options?: Record<string, unknown> }) {
    const gdp = await this.create(body);
    return { ok: true, manifest: gdp.experienceManifest };
  }

  private buildExperienceManifest(pkg: any, options: Record<string, unknown>) {
    const provider = gatewayConfig().legacyOptomoleApiUrl ? 'legacy-optomole-api-or-ai-cluster' : 'gateway-local-fallback';
    const modules = [
      'Knowledge_graph.json',
      'narrative.json',
      'world.json',
      'npcs.json',
      'dialogue.json',
      'gameplay.json',
      'quest.json',
      'progression.json',
      'assets.json',
      'analytics.json',
      'publishing.json',
    ];
    return {
      schemaVersion: '1.0.0',
      kind: 'optimole.ExperienceManifest',
      manifestFile: 'ExperienceManifest.json',
      generatedAt: new Date().toISOString(),
      game: {
        id: pkg.experience?.id || pkg.id,
        title: options.title || pkg.experience?.title || 'Optimole Experience',
        version: options.version || '0.1.0',
        creator: options.creator || 'Optimole API Gateway',
        summary: pkg.specification?.ai?.analysis?.summary || '',
        experienceOutputType: pkg.experience?.outputType || pkg.specification?.experienceOutputType?.id || pkg.specification?.experienceOutputType || null,
        outputExperience: pkg.experience?.outputExperience || pkg.specification?.experienceOutputType?.output || null,
      },
      supportedPlatforms: options.platforms || ['web', 'mobile', 'unreal', 'unity'],
      modules: modules.map((file) => ({
        id: file.replace(/\.json$/, ''),
        kind: `gdp.${file.replace(/\.json$/, '').replace(/_/g, '-')}`,
        path: file,
        contentType: 'application/json',
      })),
      loadOrder: modules,
      difficultyProfiles: { default: pkg.specification?.ai?.adaptiveDifficulty?.tier || 'adaptive', profiles: ['easy', 'normal', 'hard', 'adaptive'] },
      multiplayerCapabilities: pkg.multiplayer || {},
      accessibilityOptions: pkg.personalization?.accessibility || {},
      localization: { defaultLocale: options.language || 'en', supportedLocales: [options.language || 'en'] },
      analyticsConfiguration: { events: ['session_started', 'quest_completed', 'session_completed'] },
      aiModelsUsed: [{ role: 'game-compiler', provider, model: process.env.LLM_MODEL || null }],
      templateCompatibility: { registry: 'templates/registry.json' },
      validation: { status: pkg.validation?.passed ? 'passed' : 'review', report: pkg.validation || {} },
    };
  }
}
