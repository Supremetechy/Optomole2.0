import { BadRequestException, Injectable } from '@nestjs/common';
import type { SanitizedContentItem } from '../preprocessing/content-sanitization.service';
import { PreprocessingPipelineService } from '../preprocessing/preprocessing-pipeline.service';
import { classifyExperienceOutputType } from '../shared/experience-output-types';
import { id } from '../shared/ids';
import { SourcePayload } from '../shared/types';

export interface IngestedContentItem {
  id?: string;
  sourceType?: string;
  title?: string;
  text?: string;
  uri?: string;
  mimeType?: string;
  origin?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizeIrxRequest {
  source?: SourcePayload;
  items?: IngestedContentItem[];
  goals?: string;
  achievements?: string;
  options?: Record<string, unknown>;
}

@Injectable()
export class IrxService {
  constructor(private readonly pipeline: PreprocessingPipelineService) {}

  normalize(body: NormalizeIrxRequest) {
    const items = this.pipeline.normalizeItems(body);
    if (!items.length) throw new BadRequestException('At least one source item or source payload is required.');

    const title = String(body.options?.title || body.source?.title || items[0]?.title || 'Optimole Experience');
    const goals = this.lines(body.goals || String(body.options?.goals || ''));
    const achievements = this.lines(body.achievements || String(body.options?.achievements || ''));
    const sourceTypes = [...new Set(items.map((item) => item.sourceType || 'manual'))];
    const preprocessingPipeline = this.pipeline.run({ ...body, normalizedItems: items });
    const { contentSanitization, semanticExtraction, emotionalIntelligence, gameplayNormalization, storyboard, knowledgeGraph } = preprocessingPipeline;
    const sanitizedItems = contentSanitization.items as SanitizedContentItem[];
    const combinedText = sanitizedItems.map((item) => `# ${item.title}\n${item.text || ''}`).join('\n\n');
    const outputType = classifyExperienceOutputType({
      sourceType: sourceTypes.join(', '),
      title,
      text: combinedText,
      metadata: body.source?.metadata,
    });
    const contentBlocks = this.buildContentBlocks(sanitizedItems);
    const signals = this.extractSignals(combinedText);

    const irx = {
      schemaVersion: '1.0.0',
      kind: 'optimole.irx.experience',
      id: id('irx'),
      generatedAt: new Date().toISOString(),
      title,
      source: {
        primaryType: sourceTypes[0],
        sourceTypes,
        itemCount: items.length,
        sanitizedItemCount: sanitizedItems.length,
        textLength: combinedText.length,
        sanitizationStats: contentSanitization.stats,
      },
      goals,
      achievements,
      desiredOutcomes: [
        ...goals.map((goal) => ({ type: 'goal', label: goal })),
        ...achievements.map((achievement) => ({ type: 'achievement', label: achievement })),
      ],
      contentBlocks,
      signals,
      semanticExtraction,
      emotionalIntelligence,
      gameplayNormalization,
      storyboard,
      knowledgeGraph,
      preprocessingPipeline,
      compilerHints: {
        experienceOutputType: outputType.selected,
        experienceOutputTypeConfidence: outputType.confidence,
        experienceOutputTypeScores: outputType.scores,
        preferredGenre: body.options?.genre || outputType.selected.recommendedArchetype,
        worldTitle: body.options?.worldTitle || 'Knowledge Frontier',
        target: body.options?.target || 'browser',
        recommendedTemplateFamilies: this.recommendFamilies(sourceTypes, combinedText, outputType.selected.recommendedTemplateFamily),
      },
    };

    return {
      ok: true,
      irx,
      source: {
        sourceType: sourceTypes[0],
        title,
        text: this.composeCompilerText(irx, combinedText),
        metadata: {
          ...(body.source?.metadata || {}),
          irx,
          contentSanitization,
          semanticExtraction,
          emotionalIntelligence,
          gameplayNormalization,
          storyboard,
          knowledgeGraph,
        },
      },
    };
  }

  private buildContentBlocks(items: SanitizedContentItem[]) {
    return items.map((item, index) => ({
      id: item.id,
      order: index,
      sourceType: item.sourceType,
      title: item.title,
      origin: item.origin,
      provenance: item.provenance,
      citations: item.citations,
      sensitiveInformation: item.sensitiveInformation,
      sanitization: item.sanitization,
      summary: this.summary(item.text),
      objectives: this.objectives(item.text),
      evidenceCandidates: this.sentences(item.text).slice(0, 8).map((sentence, sentenceIndex) => ({
        id: `${item.id}-evidence-${sentenceIndex + 1}`,
        text: sentence,
      })),
    }));
  }

  private composeCompilerText(irx: any, combinedText: string): string {
    const goals = irx.goals.length ? `\n\nUser goals:\n${irx.goals.map((goal: string) => `- ${goal}`).join('\n')}` : '';
    const achievements = irx.achievements.length ? `\n\nDesired achievements:\n${irx.achievements.map((achievement: string) => `- ${achievement}`).join('\n')}` : '';
    const kgStats = irx.knowledgeGraph?.stats
      ? `\n\nKnowledge graph stats:\n- nodes: ${irx.knowledgeGraph.stats.nodeCount}\n- edges: ${irx.knowledgeGraph.stats.edgeCount}\n- semantic nodes: ${irx.knowledgeGraph.stats.semanticNodeCount}\n- gameplay nodes: ${irx.knowledgeGraph.stats.gameplayNodeCount}\n- storyboard nodes: ${irx.knowledgeGraph.stats.storyboardNodeCount}`
      : '';
    const scenes = Array.isArray(irx.storyboard?.scenes) && irx.storyboard.scenes.length
      ? `\n\nStoryboard scenes:\n${irx.storyboard.scenes.map((scene: any) => `- ${scene.sceneType}: ${scene.title}`).join('\n')}`
      : '';
    return `Convert this Optimole IRX source package into an actionable interactive playable game.\n\nIRX title: ${irx.title}${goals}${achievements}${kgStats}${scenes}\n\nSource content:\n${combinedText}`;
  }

  private extractSignals(text: string) {
    const sentences = this.sentences(text);
    return {
      sentenceCount: sentences.length,
      keywords: this.keywords(text),
      procedures: sentences.filter((sentence) => /\b(step|first|next|then|must|should|required|process|procedure)\b/i.test(sentence)).slice(0, 10),
      risks: sentences.filter((sentence) => /\b(risk|hazard|threat|fail|error|avoid|warning|security|compliance)\b/i.test(sentence)).slice(0, 10),
    };
  }

  private recommendFamilies(sourceTypes: string[], text: string, preferredFamily?: string): string[] {
    const lowered = text.toLowerCase();
    const families = new Set<string>();
    if (preferredFamily) families.add(preferredFamily);
    if (sourceTypes.includes('course') || lowered.includes('step') || lowered.includes('procedure')) families.add('action-adventure');
    if (sourceTypes.includes('tasklist') || lowered.includes('daily') || lowered.includes('habit')) families.add('idle');
    if (lowered.includes('risk') || lowered.includes('hazard') || lowered.includes('threat')) families.add('arcade');
    if (lowered.includes('decision') || lowered.includes('tradeoff') || lowered.includes('budget')) families.add('board-sim');
    if (!families.size) families.add('action-adventure');
    return [...families];
  }

  private objectives(text: string): string[] {
    const sentences = this.sentences(text);
    return sentences
      .filter((sentence) => /\b(complete|review|identify|explain|learn|build|configure|compare|analyze|must|should|required)\b/i.test(sentence))
      .slice(0, 6);
  }

  private summary(text: string): string {
    return this.sentences(text).slice(0, 3).join(' ').slice(0, 600);
  }

  private sentences(text: string): string[] {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  private keywords(text: string): string[] {
    const stop = new Set(['this', 'that', 'with', 'from', 'into', 'have', 'will', 'your', 'about', 'their', 'there', 'when', 'then', 'than', 'they']);
    const counts = new Map<string, number>();
    String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.forEach((word) => {
      if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([word]) => word);
  }

  private lines(value: string): string[] {
    return String(value || '').split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  }
}
