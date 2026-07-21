import { BadRequestException, Injectable } from '@nestjs/common';
import type { IngestedContentItem, NormalizeIrxRequest } from '../irx/irx.service';
import { id } from '../shared/ids';
import { ContentSanitizationService, NormalizedContentItem } from './content-sanitization.service';
import { EmotionalIntelligenceService } from './emotional-intelligence.service';
import { GameplayNormalizationService } from './gameplay-normalization.service';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { SemanticExtractionService } from './semantic-extraction.service';
import { StoryboardService } from './storyboard.service';

@Injectable()
export class PreprocessingPipelineService {
  constructor(
    private readonly contentSanitization: ContentSanitizationService,
    private readonly semanticExtraction: SemanticExtractionService,
    private readonly emotionalIntelligence: EmotionalIntelligenceService,
    private readonly gameplayNormalization: GameplayNormalizationService,
    private readonly storyboard: StoryboardService,
    private readonly knowledgeGraph: KnowledgeGraphService,
  ) {}

  run(body: NormalizeIrxRequest & { normalizedItems?: NormalizedContentItem[] }) {
    const items = body.normalizedItems || this.normalizeItems(body);
    if (!items.length) throw new BadRequestException('At least one source item or source payload is required.');

    const title = String(body.options?.title || body.source?.title || items[0]?.title || 'Optimole Experience');
    const goals = this.lines(body.goals || String(body.options?.goals || ''));
    const achievements = this.lines(body.achievements || String(body.options?.achievements || ''));
    const contentSanitization = this.contentSanitization.sanitize({ title, items });
    const semantic = this.semanticExtraction.extract({
      title,
      items: contentSanitization.items,
      sanitization: contentSanitization,
      goals,
      achievements,
    });
    // Emotional Intelligence Engine: read the sanitized content for emotional
    // states, the beginning/middle/end arc, and stakeholder sentiment before the
    // storyboard turns those beats into scenes.
    const emotionalIntelligence = this.emotionalIntelligence.extract({
      title,
      items: contentSanitization.items,
      semanticExtraction: semantic,
    });
    const gameplay = this.gameplayNormalization.normalize({
      semanticExtraction: semantic,
      preferredGenre: body.options?.genre,
      target: body.options?.target,
    });
    // The storyboard engine pathfinds over the knowledge graph, so build a base
    // graph first (semantic + gameplay layers), hand it to the storyboard, then
    // rebuild the final graph with the completed storyboard layer folded back in.
    const baseGraph = this.knowledgeGraph.build({
      semanticExtraction: semantic,
      gameplayNormalization: gameplay,
      storyboard: {},
    });
    const storyboard = this.storyboard.build({
      knowledgeGraph: baseGraph,
      semanticExtraction: semantic,
      emotionalIntelligence,
      audience: String(body.options?.audience || 'knowledge specialist'),
    });
    const knowledgeGraph = this.knowledgeGraph.build({
      semanticExtraction: semantic,
      gameplayNormalization: gameplay,
      storyboard,
    });

    return {
      schemaVersion: '0.1.0',
      kind: 'optimole.preprocessingPipeline',
      id: id('pipeline'),
      generatedAt: new Date().toISOString(),
      contentSanitization,
      semanticExtraction: semantic,
      emotionalIntelligence,
      gameplayNormalization: gameplay,
      storyboard,
      knowledgeGraph,
    };
  }

  normalizeItems(body: NormalizeIrxRequest): NormalizedContentItem[] {
    const incoming = Array.isArray(body.items) ? body.items : [];
    const items = incoming.map((item, index) => ({
      id: item.id || id('source'),
      sourceType: item.sourceType || body.source?.sourceType || 'manual',
      title: item.title || body.source?.title || `Source ${index + 1}`,
      text: item.text || item.uri || '',
      origin: item.origin || item.mimeType || 'frontend-ingest',
      metadata: item.metadata || {},
    }));

    if (body.source && (body.source.text || body.source.uri || body.source.title)) {
      items.unshift({
        id: id('source'),
        sourceType: body.source.sourceType || 'manual',
        title: body.source.title || 'Source Payload',
        text: body.source.text || body.source.uri || '',
        origin: 'direct-source',
        metadata: body.source.metadata || {},
      });
    }

    return items.filter((item) => item.text || item.title);
  }

  private lines(value: string): string[] {
    return String(value || '').split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  }
}
