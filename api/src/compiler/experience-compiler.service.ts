import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { classifyExperienceOutputType, EXPERIENCE_OUTPUT_TYPES } from '../shared/experience-output-types';
import { id } from '../shared/ids';
import { HUMAN_EXPERIENCES } from '../shared/human-experiences';
import { plainText, shortLabel } from '../shared/text';
import { ExperiencePackage, SourcePayload } from '../shared/types';
import { gatewayConfig } from '../shared/config';
import { GameReferencesService } from '../game-references/game-references.service';
import {
  ArchetypeId,
  buildRuntimeContract,
  displayGenre,
  heuristicArchetype,
  normalizeArchetypeId,
  RUNTIME_ARCHETYPES,
} from '../shared/runtime-archetypes';

type AiProvider = 'openai' | 'claude' | 'gemini' | 'local';

export interface AiCompilerOptions {
  provider?: AiProvider;
  model?: string;
  apiKeys?: {
    openai?: string;
    claude?: string;
    gemini?: string;
  };
}

// The `local` provider runs fully offline against an OpenAI-compatible server
// (Ollama / LM Studio) and needs no API key, unlike the hosted providers.
const KEYLESS_PROVIDERS = new Set<AiProvider>(['local']);

@Injectable()
export class ExperienceCompilerService {
  constructor(private readonly gameReferences: GameReferencesService) {}

  /**
   * "Model off a favorite game." When options carry a `gameReferenceId`, fold the
   * reference's template/archetype/mechanics mapping into the compile options so
   * the ExperienceManifest is shaped like that game — but never override an
   * explicit user selection (templateId / genre / archetype). Returns a new
   * options object; provenance is stored under `gameReference` for the manifest
   * and the AI prompt.
   */
  applyGameReference(options: Record<string, unknown>): Record<string, unknown> {
    const referenceId = String((options as any).gameReferenceId || (options as any).favoriteGameId || '').trim();
    if (!referenceId) return options;
    const steering = this.gameReferences.steeringFor(referenceId);
    if (!steering) return options;

    const next: Record<string, unknown> = { ...options };
    // Choosing a favorite is a deliberate act, so it outranks the `genre`
    // dropdown (which always carries a default). A directly-specified
    // `templateId` is more precise still, so that alone is left untouched.
    const hasExplicitTemplateId = Boolean(next.templateId && String(next.templateId).trim());
    if (!hasExplicitTemplateId) {
      next.templateId = steering.templateId;
      // Drop the genre default so templatePreference resolves via templateId.
      delete next.genre;
    }
    if (!(next.archetype && String(next.archetype).trim())) next.archetype = steering.archetype;
    next.gameReference = {
      id: referenceId,
      title: steering.title,
      category: steering.category,
      genreFamily: steering.genreFamily,
      templateId: steering.templateId,
      archetype: steering.archetype,
      mechanics: steering.mechanics,
    };
    return next;
  }

  canCompile(options: Record<string, unknown> = {}) {
    const ai = this.aiOptions(options);
    if (!ai.provider) return false;
    return KEYLESS_PROVIDERS.has(ai.provider) || Boolean(this.keyFor(ai.provider, ai));
  }

  async compileWithAi(source: SourcePayload, rawOptions: Record<string, unknown> = {}): Promise<ExperiencePackage> {
    const options = this.applyGameReference(rawOptions);
    const ai = this.aiOptions(options);
    if (!ai.provider) throw new BadRequestException('AI provider is required.');
    const keyless = KEYLESS_PROVIDERS.has(ai.provider);
    const apiKey = this.keyFor(ai.provider, ai);
    if (!keyless && !apiKey) throw new BadRequestException(`API key is required for ${ai.provider}.`);

    const manifest = await this.callProvider(ai.provider, apiKey, ai.model || this.defaultModel(ai.provider), source, options);
    return this.packageFromManifest(this.normalizeManifest(manifest, source, options), source, options, ai);
  }

  private async callProvider(provider: AiProvider, apiKey: string, model: string, source: SourcePayload, options: Record<string, unknown>) {
    const prompt = this.prompt(source, options);
    if (provider === 'openai') return this.callOpenAi(apiKey, model, prompt);
    if (provider === 'claude') return this.callClaude(apiKey, model, prompt);
    if (provider === 'local') return this.callLocal(model, prompt);
    return this.callGemini(apiKey, model, prompt);
  }

  /**
   * Offline compile against a local OpenAI-compatible server (Ollama / LM Studio).
   * No network call leaves the machine and no API key is used. The endpoint and
   * model tag come from LOCAL_AI_BASE_URL / LOCAL_AI_MODEL. We ask for a JSON
   * object response; `parseJson` still salvages the manifest if the local model
   * wraps it in prose or fences.
   */
  private async callLocal(model: string, prompt: string) {
    const baseUrl = gatewayConfig().localAiBaseUrl.replace(/\/$/, '');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: this.systemPrompt() },
            { role: 'user', content: prompt },
          ],
        }),
      });
    } catch (err) {
      throw new Error(
        `Local compile could not reach ${baseUrl}. Is the local model server running ` +
          `(e.g. \`ollama serve\`) and the model "${model}" loaded? (${(err as Error).message})`,
      );
    }
    const data = await this.readJson(response);
    if (!response.ok) throw new Error(`Local compile failed: ${this.errorMessage(data, response.status)}`);
    const text = Array.isArray(data?.choices)
      ? data.choices.map((choice: any) => choice?.message?.content || '').join('\n')
      : '';
    return this.parseJson(text);
  }

  private async callOpenAi(apiKey: string, model: string, prompt: string) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: this.systemPrompt() }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
        text: {
          format: {
            type: 'json_object',
          },
        },
      }),
    });
    const data = await this.readJson(response);
    if (!response.ok) throw new Error(`OpenAI compile failed: ${this.errorMessage(data, response.status)}`);
    return this.parseJson(this.extractOpenAiText(data));
  }

  private async callClaude(apiKey: string, model: string, prompt: string) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2026-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 12000,
        system: this.systemPrompt(),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await this.readJson(response);
    if (!response.ok) throw new Error(`Claude compile failed: ${this.errorMessage(data, response.status)}`);
    const text = Array.isArray(data?.content)
      ? data.content.map((part: any) => part?.text || '').join('\n')
      : '';
    return this.parseJson(text);
  }

  private async callGemini(apiKey: string, model: string, prompt: string) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${this.systemPrompt()}\n\n${prompt}` }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    const data = await this.readJson(response);
    if (!response.ok) throw new Error(`Gemini compile failed: ${this.errorMessage(data, response.status)}`);
    const text = Array.isArray(data?.candidates)
      ? data.candidates.flatMap((candidate: any) => candidate?.content?.parts || []).map((part: any) => part?.text || '').join('\n')
      : '';
    return this.parseJson(text);
  }

  private prompt(source: SourcePayload, options: Record<string, unknown>) {
    const irx = (source.metadata?.irx && typeof source.metadata.irx === 'object' ? source.metadata.irx : null) as any | null;
    const schema = this.readReference('spec-engine/schemas/experience-manifest.schema.json');
    const skills = this.readReference('scripts/Optomole_Skills.md');
    const reference = (options as any).gameReference as { title?: string; category?: string; genreFamily?: string; mechanics?: string[] } | undefined;
    const referenceDirective = reference?.title
      ? [
          `Model the experience off the user's favorite game: "${reference.title}" (${reference.category} / ${reference.genreFamily}).`,
          `Shape quests, progression, and pacing after these mechanics: ${(reference.mechanics || []).join(', ') || 'core loop of that genre'}.`,
          'Keep every quest and evidence item traceable to the user\'s source content — model the FORM off the reference game, fill the CONTENT from the source.',
          '',
        ]
      : [];
    return [
      'Compile the ingested content into ExperienceManifest.json.',
      ...referenceDirective,
      'Use Optomole_Skills.md as the operating directive for the compiler stage.',
      'Use the Optomole IRX, storyboard, knowledge graph, semantic extraction, and compiler references below as the transformation contract.',
      'Do not invent a parallel pipeline. Treat the supplied IRX artifacts as the source of truth.',
      'Return exactly one JSON object. No markdown, prose, or code fences.',
      '',
      'Experience output type catalog:',
      JSON.stringify(Object.values(EXPERIENCE_OUTPUT_TYPES), null, 2),
      '',
      'Select classification.experienceOutputType from the catalog when possible.',
      'Use Educational Experience for textbook chapters, lessons, and course material.',
      'Use Business Simulation for business assignments, MBA cases, strategy, budgets, and tradeoff decisions.',
      'Use Research Exploration for scientific papers, experiments, studies, datasets, and cited findings.',
      'Use Personal Story for emails, journals, photos, life archives, memories, and biographical material.',
      '',
      'Optomole_Skills.md:',
      skills,
      '',
      'ExperienceManifest.schema.json:',
      schema,
      '',
      'Optomole.md:',
      this.readReference('docs/Optomole.md'),
      '',
      'ExperienceCompiler.md:',
      this.readReference('docs/ExperienceCompiler.md'),
      '',
      'optomoleIRX.md:',
      this.readReference('docs/optomoleIRX.md'),
      '',
      'User options:',
      JSON.stringify(this.redactOptions(options), null, 2),
      '',
      'Optimole IRX:',
      JSON.stringify(irx, null, 2),
      '',
      'Extracted semantics:',
      JSON.stringify(source.metadata?.semanticExtraction || irx?.semanticExtraction || null, null, 2),
      '',
      'Emotional intelligence (emotions, emotion arc, stakeholder sentiment, detected experienceTargets — use for emotion_model):',
      JSON.stringify(source.metadata?.emotionalIntelligence || irx?.emotionalIntelligence || null, null, 2),
      '',
      'Human experience catalog (felt states gameplay can cultivate — design quests/progression/rewards toward the detected experienceTargets, drawing from this catalog):',
      JSON.stringify(HUMAN_EXPERIENCES, null, 2),
      '',
      'Knowledge graph:',
      JSON.stringify(source.metadata?.knowledgeGraph || irx?.knowledgeGraph || null, null, 2),
      '',
      'Storyboard:',
      JSON.stringify(source.metadata?.storyboard || irx?.storyboard || null, null, 2),
      '',
      'Raw source payload:',
      JSON.stringify(source, null, 2),
    ].join('\n');
  }

  private systemPrompt() {
    return [
      'You are the Optomole Experience Compiler.',
      'Follow Optomole_Skills.md when it is included in the user prompt.',
      'You compile arbitrary knowledge into a valid ExperienceManifest.json.',
      'Use the provided semantic extraction, emotional intelligence, knowledge graph, and storyboard artifacts before using raw source text.',
      'Never explain. Never output markdown. Never output code fences.',
      'Only emit JSON.',
      'The JSON must include metadata, normalized/source, classification, knowledgeGraph, narrativeGraph, world, quests, characters, progression, achievements, emotion_model, runtime, and accessibility when possible.',
      'Populate emotion_model from the emotional intelligence artifact: emotion_model.journey is the ordered emotion arc (beginning -> middle -> end), and carry through the dominant emotions and stakeholder sentiment.',
      'classification.experienceOutputType MUST be one of: "educational-experience", "business-simulation", "research-exploration", "personal-story".',
      'classification.archetype MUST be exactly one of: "mission-rpg", "escape-room", "adventure", "business-sim", "detective", "AI-generated".',
      'Choose the archetype that best fits the source: mission-rpg for skill/quest learning; escape-room for ordered procedures, runbooks, or step sequences; adventure for narrative journeys or field/exploration content; business-sim for strategy, economics, budgets, or tradeoff decisions; detective for investigations, incidents, security, or evidence analysis; AI-generated only when none clearly fit.',
      'Every quest and evidence item must be traceable to source content.',
      'Infer missing gameplay structure conservatively.',
    ].join('\n');
  }

  private normalizeManifest(value: any, source: SourcePayload, options: Record<string, unknown>) {
    const title = String(value?.metadata?.title || value?.game?.title || value?.title || options.title || source.title || 'Optimole Experience');
    const outputType = classifyExperienceOutputType({
      sourceType: source.sourceType,
      title,
      text: source.text,
      metadata: source.metadata,
    });
    const quests = this.array(value?.quests || value?.experienceManifest?.quests).map((quest: any, index: number) => ({
      id: String(quest.id || `quest-${index + 1}`),
      title: String(quest.title || quest.name || `Quest ${index + 1}`),
      summary: String(quest.summary || quest.description || quest.objective || 'Complete this objective.'),
      // The AI step may return objectives as `{title, prompt}` objects OR as bare
      // strings. In the string case both fields used to collapse to the same raw
      // excerpt, so every downstream label became a 200-char markdown blob. Keep
      // the full text as the prompt and derive a short display title from it.
      objectives: this.array(quest.objectives).map((objective: any, objectiveIndex: number) => {
        const prompt = plainText(objective?.prompt ?? objective?.description ?? objective);
        const declaredTitle = typeof objective === 'object' && objective
          ? plainText(objective.title ?? objective.label)
          : '';
        const title = shortLabel(declaredTitle || prompt) || `Objective ${objectiveIndex + 1}`;
        return {
          id: String(objective?.id || `objective-${index + 1}-${objectiveIndex + 1}`),
          title,
          prompt: prompt || title,
        };
      }),
      reward: quest.reward || { xp: 100 + index * 25 },
      // `label` is the caption the runtime shows; `text` stays the full excerpt.
      evidence: this.array(quest.evidence || quest.evidenceCandidates).map((evidence: any, evidenceIndex: number) => {
        const text = plainText(evidence?.text ?? evidence?.label ?? evidence);
        const declaredLabel = typeof evidence === 'object' && evidence ? plainText(evidence.label) : '';
        return {
          label: shortLabel(declaredLabel || text) || `Evidence ${evidenceIndex + 1}`,
          text,
          correct: evidence?.correct !== false,
        };
      }),
    }));

    return {
      schemaVersion: value?.schemaVersion || '1.2.0',
      kind: value?.kind || 'optimole.ExperienceManifest',
      metadata: {
        id: value?.metadata?.id || value?.id || id('manifest'),
        title,
        generatedAt: new Date().toISOString(),
        compiler: 'ai-provider',
        ...(value?.metadata || {}),
      },
      normalized: value?.normalized || value?.source || {},
      classification: {
        ...(value?.classification || {}),
        experienceOutputType: value?.classification?.experienceOutputType || outputType.selected.id,
        experienceOutputTypeTitle: value?.classification?.experienceOutputTypeTitle || outputType.selected.title,
        experienceOutputTypeConfidence: value?.classification?.experienceOutputTypeConfidence || outputType.confidence,
        outputExperience: value?.classification?.outputExperience || outputType.selected.output,
        exampleTransformation: value?.classification?.exampleTransformation || {
          input: outputType.selected.exampleInput,
          output: outputType.selected.exampleOutput,
        },
      },
      knowledgeGraph: value?.knowledgeGraph || { entities: [], relationships: [] },
      narrativeGraph: value?.narrativeGraph || value?.narrative || {},
      world: value?.world || { planet: options.worldTitle || 'Knowledge Frontier' },
      quests: quests.length ? quests : this.fallbackQuests(source),
      characters: this.array(value?.characters || value?.npcs).length ? this.array(value?.characters || value?.npcs) : [{ name: 'Optimole Guide', role: 'guide' }],
      progression: value?.progression || { xpModel: 'quest-completion' },
      achievements: this.array(value?.achievements),
      emotion_model: value?.emotion_model || value?.emotionModel || this.emotionModelFrom(source),
      runtime: value?.runtime || { target: options.target || 'browser' },
      accessibility: value?.accessibility || {},
      raw: value,
    };
  }

  private packageFromManifest(manifest: any, source: SourcePayload, options: Record<string, unknown>, ai: AiCompilerOptions): ExperiencePackage {
    const title = manifest.metadata.title;
    const experienceId = `exp-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'experience'}`;
    const irx = source.metadata?.irx && typeof source.metadata.irx === 'object' ? source.metadata.irx as any : null;
    const archetypeId = this.selectArchetype(manifest, source, options);
    const archetype = RUNTIME_ARCHETYPES[archetypeId];
    const preference = this.templatePreference(options, manifest);
    return {
      id: experienceId,
      templatePreference: preference,
      source,
      experience: {
        id: experienceId,
        title,
        genre: displayGenre(preference, archetype),
        outputType: manifest.classification?.experienceOutputType,
        outputExperience: manifest.classification?.outputExperience,
        modeledAfter: (options as any).gameReference || null,
        world: manifest.world,
      },
      blueprint: {
        quests: manifest.quests,
        characters: manifest.characters,
        achievements: manifest.achievements,
        goals: source.metadata?.irx && typeof source.metadata.irx === 'object' ? (source.metadata.irx as any).goals || [] : [],
        analystChallenge: this.analystChallenge(manifest.quests, source),
        skillTree: this.skillTree(manifest),
        proceduralMap: this.proceduralMap(manifest, options),
        storyboard: irx?.storyboard || manifest.narrativeGraph,
        knowledgeGraph: irx?.knowledgeGraph || manifest.knowledgeGraph,
      },
      specification: {
        experienceManifest: manifest,
        experienceOutputType: manifest.classification?.experienceOutputType || null,
        preprocessing: irx?.preprocessingPipeline || null,
        semanticExtraction: irx?.semanticExtraction || null,
        emotionalIntelligence: irx?.emotionalIntelligence || source.metadata?.emotionalIntelligence || null,
        gameplayNormalization: irx?.gameplayNormalization || null,
        storyboard: irx?.storyboard || manifest.narrativeGraph,
        knowledgeGraph: irx?.knowledgeGraph || manifest.knowledgeGraph,
        ai: {
          provider: ai.provider,
          model: ai.model || (ai.provider ? this.defaultModel(ai.provider) : null),
        },
      },
      progression: {
        domain: this.domainFor(manifest, source),
        xpReward: this.totalXp(manifest.quests),
        skillTree: this.skillTree(manifest),
        loot: this.lootFor(manifest),
        profileVersion: 'optimole-rpg-v3',
      },
      runtimeContract: buildRuntimeContract({
        archetypeId,
        xpModel: manifest.progression?.xpModel || 'quest-completion',
        xpMultiplier: manifest.progression?.xpMultiplier || 1,
        xpThreshold: manifest.progression?.xpThreshold || 0,
        map: this.proceduralMap(manifest, options),
      }),
      renderTargets: [
        { target: 'pixijs', engine: 'pixijs-runtime', status: 'ready' },
        { target: 'browser', engine: 'browser-engine', status: 'ready' },
      ],
    };
  }

  /**
   * The genre/template the experience should map to. User selection
   * (options) wins; otherwise fall back to the AI's own classification.genre.
   */
  private templatePreference(options: Record<string, unknown>, manifest: any): string | undefined {
    const pref = options.templateId || options.genre || options.archetype || manifest?.classification?.genre;
    const value = typeof pref === 'string' ? pref.trim() : '';
    return value || undefined;
  }

  private aiOptions(options: Record<string, unknown>): AiCompilerOptions {
    const ai = (options.ai || {}) as AiCompilerOptions;
    return {
      provider: ai.provider,
      model: ai.model,
      apiKeys: ai.apiKeys || {},
    };
  }

  private keyFor(provider: AiProvider, options: AiCompilerOptions) {
    if (provider === 'local') return '';
    return options.apiKeys?.[provider] || '';
  }

  private defaultModel(provider: AiProvider) {
    if (provider === 'openai') return 'gpt-4o-mini';
    if (provider === 'claude') return 'claude-3-5-sonnet-latest';
    if (provider === 'local') return gatewayConfig().localAiModel;
    return 'gemini-3.5-flash';
  }

  /**
   * Choose the runtime archetype. The AI compiler is asked to emit
   * `classification.archetype` as one of the six ids; we honor it when valid and
   * otherwise fall back to a domain/genre/content heuristic.
   */
  private selectArchetype(manifest: any, source: SourcePayload, options: Record<string, unknown>): ArchetypeId {
    const aiChoice =
      normalizeArchetypeId(manifest?.classification?.archetype) ||
      normalizeArchetypeId(manifest?.classification?.runtimeArchetype) ||
      normalizeArchetypeId(options.archetype) ||
      normalizeArchetypeId(options.genre);
    if (aiChoice) return aiChoice;

    const outputType = classifyExperienceOutputType({
      sourceType: source.sourceType,
      title: manifest?.metadata?.title,
      text: source.text,
      metadata: source.metadata,
    }).selected;
    if (outputType.recommendedArchetype) return outputType.recommendedArchetype;

    const domain = this.domainFor(manifest, source);
    const genre = String(manifest?.classification?.genre || options.genre || '');
    const text = JSON.stringify({
      title: manifest?.metadata?.title,
      sourceType: source.sourceType,
      classification: manifest?.classification,
      source: source.text,
    });
    return heuristicArchetype({ domain, genre, text });
  }

  private domainFor(manifest: any, source: SourcePayload) {
    const explicit = String(manifest?.classification?.domain || manifest?.metadata?.domain || '').toLowerCase();
    if (['strategy', 'science', 'defense', 'engineering'].includes(explicit)) return explicit;
    const text = JSON.stringify({ title: manifest?.metadata?.title, sourceType: source.sourceType, source: source.text }).toLowerCase();
    const scores = {
      strategy: ['market', 'roadmap', 'competitor', 'growth', 'decision', 'client'].filter((term) => text.includes(term)).length,
      science: ['research', 'model', 'experiment', 'data', 'gradient', 'theory'].filter((term) => text.includes(term)).length,
      defense: ['security', 'risk', 'threat', 'compliance', 'credential', 'breach'].filter((term) => text.includes(term)).length,
      engineering: ['system', 'api', 'build', 'deploy', 'power', 'workflow', 'infrastructure'].filter((term) => text.includes(term)).length,
      aiGenerated: ['ai-generated', 'ai-generated'].filter((term) => text.includes(term)).length,
      research: ['research', 'model', 'experiment', 'data', 'gradient', 'theory'].filter((term) => text.includes(term)).length,
      marketing: ['marketing', 'sales', 'advertising', 'brand', 'promotion', 'promotion'].filter((term) => text.includes(term)).length,
      sales: ['sales', 'advertising', 'brand', 'promotion', 'promotion'].filter((term) => text.includes(term)).length,
    
    };
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'engineering';
  }

  private totalXp(quests: any[]) {
    return this.array(quests).reduce((sum, quest: any, index) => {
      const xp = typeof quest?.reward?.xp === 'number' ? quest.reward.xp : 100 + index * 25;
      return sum + xp;
    }, 0);
  }

  private analystChallenge(quests: any[], source: SourcePayload) {
    const firstQuest = this.array(quests)[0] || {};
    const evidence = this.array(firstQuest.evidence);
    const correctEvidenceSnippets = evidence.filter((item: any) => item.correct !== false).map((item: any) => String(item.text || item.label || item)).slice(0, 6);
    const distractorSnippets = evidence.filter((item: any) => item.correct === false).map((item: any) => String(item.text || item.label || item)).slice(0, 4);
    return {
      instructions: 'Select every source-backed evidence snippet and reject distractors.',
      summaryToVerify: firstQuest.summary || source.text || 'Verify the compiled mission.',
      correctEvidenceSnippets: correctEvidenceSnippets.length ? correctEvidenceSnippets : [String(source.text || firstQuest.summary || 'Review source material.')],
      distractorSnippets,
    };
  }

  private skillTree(manifest: any) {
    const domain = String(manifest?.classification?.domain || manifest?.metadata?.domain || 'engineering').toLowerCase();
    const supplied = this.array(manifest?.skillTree || manifest?.progression?.skillTree);
    if (supplied.length) return supplied;
    return [
      { id: `${domain}-triage`, name: 'Source Triage', description: 'Prioritize source items by mission value.', category: domain, unlocks: [`${domain}-evidence`] },
      { id: `${domain}-evidence`, name: 'Evidence Binding', description: 'Bind objectives to source-backed proof.', category: domain, unlocks: [`${domain}-runtime`] },
      { id: `${domain}-runtime`, name: 'Runtime Transfer', description: 'Carry compiled knowledge into browser and engine runtimes.', category: domain, unlocks: [] },
    ];
  }

  private proceduralMap(manifest: any, options: Record<string, unknown>) {
    const existing = manifest?.proceduralMap || manifest?.world?.proceduralMap;
    if (existing) return existing;
    const worldName = String(manifest?.world?.planet || options.worldTitle || 'Knowledge Frontier');
    return {
      regionName: worldName,
      description: 'A domain map generated from compiled source signals.',
      locations: this.array(manifest?.quests).slice(0, 6).map((quest: any, index) => ({
        name: quest.title || `Mission Node ${index + 1}`,
        description: quest.summary || 'Compiled quest location.',
        type: 'mission_node',
        hazards: this.array(quest.evidence).filter((item: any) => item.correct === false).map((item: any) => String(item.text || item.label || item)).slice(0, 3),
        spawns: ['Evidence prompt', 'Objective marker'],
        lootTable: this.lootFor(manifest),
      })),
    };
  }

  private lootFor(manifest: any) {
    const achievements = this.array(manifest?.achievements).map((achievement: any) => String(achievement.title || achievement.name || achievement.id)).filter(Boolean);
    return achievements.length ? achievements.slice(0, 4) : ['Compiled Insight', 'Evidence Token'];
  }

  private parseJson(text: string) {
    const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
      throw new Error('AI compiler did not return valid JSON.');
    }
  }

  private extractOpenAiText(data: any) {
    if (typeof data?.output_text === 'string') return data.output_text;
    if (Array.isArray(data?.output)) {
      return data.output
        .flatMap((item: any) => item?.content || [])
        .map((part: any) => part?.text || '')
        .join('\n');
    }
    return '';
  }

  private async readJson(response: Response): Promise<any> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return { text };
    }
  }

  private readReference(fileName: string) {
    const candidates = [
      path.resolve(process.cwd(), fileName),
      path.resolve(process.cwd(), '..', fileName),
      path.resolve(__dirname, '..', '..', '..', fileName),
    ];
    const filePath = candidates.find((candidate) => fs.existsSync(candidate));
    return filePath ? fs.readFileSync(filePath, 'utf8').slice(0, 24000) : '';
  }

  private redactOptions(options: Record<string, unknown>) {
    const copy = JSON.parse(JSON.stringify(options || {}));
    if (copy.ai?.apiKeys) {
      Object.keys(copy.ai.apiKeys).forEach((key) => {
        copy.ai.apiKeys[key] = copy.ai.apiKeys[key] ? '[redacted]' : '';
      });
    }
    return copy;
  }

  /**
   * Deterministic emotion_model derived from the Emotional Intelligence Engine
   * artifact, used when the AI provider does not emit one (or no provider is set).
   * journey mirrors the beginning -> middle -> end emotion arc.
   */
  private emotionModelFrom(source: SourcePayload) {
    const emotion = (source.metadata?.emotionalIntelligence
      || (source.metadata?.irx as any)?.emotionalIntelligence) as any | undefined;
    if (!emotion) return { journey: [], emotions: [], stakeholderSentiment: [] };
    const arc = emotion.emotionArc || {};
    const journey = [arc.beginning, arc.middle, arc.end].filter(Boolean).map((label: string) => String(label).toLowerCase());
    return {
      journey,
      arc,
      emotions: this.array(emotion.emotions).map((entry: any) => entry.emotion || entry).filter(Boolean),
      stakeholderSentiment: this.array(emotion.stakeholderSentiment),
      overallSentiment: emotion.overallSentiment || null,
      experienceTargets: this.array(emotion.experienceTargets),
    };
  }

  private fallbackQuests(source: SourcePayload) {
    const text = plainText(source.text) || 'Review the source material.';
    return [{
      id: 'quest-1',
      title: source.title || 'Generated Mission',
      summary: text,
      reward: { xp: 100 },
      evidence: [{ label: shortLabel(source.title || text) || 'Source material', text, correct: true }],
    }];
  }

  private array(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private errorMessage(data: unknown, status: number) {
    if (typeof data === 'object' && data && 'error' in data) {
      const error = (data as { error?: { message?: string } }).error;
      if (error?.message) return error.message;
    }
    return `HTTP ${status}`;
  }
}
