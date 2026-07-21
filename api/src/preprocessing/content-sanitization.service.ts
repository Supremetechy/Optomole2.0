import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { id } from '../shared/ids';
import type { IngestedContentItem } from '../irx/irx.service';

export type NormalizedContentItem = Required<Pick<IngestedContentItem, 'id' | 'sourceType' | 'title' | 'text' | 'origin'>> & {
  metadata?: Record<string, unknown>;
};

export interface SanitizedContentItem extends NormalizedContentItem {
  text: string;
  provenance: {
    sourceId: string;
    sourceType: string;
    origin: string;
    title: string;
    contentHash: string;
    originalLength: number;
    sanitizedLength: number;
    duplicateOf?: string;
  };
  citations: Array<{
    id: string;
    text: string;
    kind: 'url' | 'inline' | 'reference';
    sourceId: string;
  }>;
  sensitiveInformation: Array<{
    type: 'EMAIL' | 'PHONE' | 'SSN' | 'CREDIT_CARD' | 'API_KEY';
    count: number;
    confidence: number;
  }>;
  sanitization: {
    status: 'ready' | 'duplicate' | 'corrupted';
    duplicateOf?: string;
    corruptedTextSignals: string[];
    noiseRemoved: string[];
    formattingChanges: string[];
    intentPreservationScore: number;
  };
}

@Injectable()
export class ContentSanitizationService {
  sanitize(input: { title: string; items: NormalizedContentItem[] }) {
    const seen = new Map<string, string>();
    const documents = input.items.map((item, order) => {
      const originalText = String(item.text || '');
      const normalizedText = this.normalizeFormatting(originalText);
      const citations = this.extractCitations(normalizedText, item.id);
      const noiseResult = this.removeNoise(normalizedText);
      const contentHash = this.hash(this.dedupeKey(noiseResult.text));
      const duplicateOf = seen.get(contentHash);
      if (!duplicateOf) seen.set(contentHash, item.id);

      const corruptedTextSignals = this.detectCorruption(noiseResult.text);
      const sensitiveInformation = this.identifySensitiveInformation(noiseResult.text);
      const formattingChanges = this.formattingChanges(originalText, normalizedText);
      const intentPreservationScore = this.intentPreservationScore(originalText, noiseResult.text, citations.length);

      return {
        ...item,
        order,
        text: noiseResult.text,
        provenance: {
          sourceId: item.id,
          sourceType: item.sourceType,
          origin: item.origin,
          title: item.title,
          contentHash,
          originalLength: originalText.length,
          sanitizedLength: noiseResult.text.length,
          ...(duplicateOf ? { duplicateOf } : {}),
        },
        citations,
        sensitiveInformation,
        sanitization: {
          status: duplicateOf ? 'duplicate' : corruptedTextSignals.length ? 'corrupted' : 'ready',
          ...(duplicateOf ? { duplicateOf } : {}),
          corruptedTextSignals,
          noiseRemoved: noiseResult.removed,
          formattingChanges,
          intentPreservationScore,
        },
      } satisfies SanitizedContentItem & { order: number };
    });

    const activeDocuments = documents.filter((document) => document.sanitization.status !== 'duplicate' && document.text.trim());

    return {
      schemaVersion: '0.1.0',
      kind: 'optimole.contentSanitization',
      id: id('sanitize'),
      generatedAt: new Date().toISOString(),
      title: input.title,
      documents,
      items: activeDocuments.map(({ order: _order, ...document }) => document),
      stats: {
        inputDocumentCount: input.items.length,
        outputDocumentCount: activeDocuments.length,
        duplicateCount: documents.filter((document) => document.sanitization.status === 'duplicate').length,
        corruptedCount: documents.filter((document) => document.sanitization.status === 'corrupted').length,
        sensitiveFindingCount: documents.reduce((sum, document) => sum + document.sensitiveInformation.reduce((inner, finding) => inner + finding.count, 0), 0),
        citationCount: documents.reduce((sum, document) => sum + document.citations.length, 0),
        noiseRemovalCount: documents.reduce((sum, document) => sum + document.sanitization.noiseRemoved.length, 0),
      },
    };
  }

  private normalizeFormatting(text: string): string {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, '  ')
      .replace(/[ \f\v]+$/gm, '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private removeNoise(text: string) {
    const removed: string[] = [];
    const lines = String(text || '').split('\n');
    const cleaned = lines.filter((line) => {
      const trimmed = line.trim();
      if (/^(unsubscribe|view in browser|privacy policy|copyright \d{4}|sent from my)\b/i.test(trimmed)) {
        removed.push(trimmed);
        return false;
      }
      if (/^[-_=*]{5,}$/.test(trimmed)) {
        removed.push(trimmed);
        return false;
      }
      if (/^page \d+(?: of \d+)?$/i.test(trimmed)) {
        removed.push(trimmed);
        return false;
      }
      return true;
    });
    return {
      text: cleaned.join('\n').replace(/[ ]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim(),
      removed: [...new Set(removed)].slice(0, 24),
    };
  }

  private detectCorruption(text: string): string[] {
    const signals: string[] = [];
    const value = String(text || '');
    if (value.includes('\uFFFD')) signals.push('replacement-character');
    if (/(.)\1{24,}/.test(value)) signals.push('repeated-character-run');
    if (/[^\s]{180,}/.test(value)) signals.push('extreme-token-length');
    const alphaNumeric = (value.match(/[a-z0-9]/gi) || []).length;
    const symbols = (value.match(/[^\w\s.,;:!?'"()[\]{}@/#%&+-]/g) || []).length;
    if (value.length > 80 && symbols / Math.max(1, alphaNumeric) > 0.25) signals.push('high-symbol-ratio');
    if (value.length > 120 && alphaNumeric / value.length < 0.35) signals.push('low-readable-character-ratio');
    return signals;
  }

  private identifySensitiveInformation(text: string) {
    const patterns: Array<[SanitizedContentItem['sensitiveInformation'][number]['type'], RegExp, number]> = [
      ['EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 0.96],
      ['PHONE', /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, 0.82],
      ['SSN', /\b\d{3}-\d{2}-\d{4}\b/g, 0.98],
      ['CREDIT_CARD', /\b(?:\d[ -]*?){13,16}\b/g, 0.78],
      ['API_KEY', /\b(?:sk|pk|api|key|token)[_-]?[a-z0-9]{20,}\b/gi, 0.74],
    ];
    return patterns
      .map(([type, pattern, confidence]) => ({ type, count: (text.match(pattern) || []).length, confidence }))
      .filter((finding) => finding.count > 0);
  }

  private extractCitations(text: string, sourceId: string) {
    const citations = new Map<string, { id: string; text: string; kind: 'url' | 'inline' | 'reference'; sourceId: string }>();
    const add = (citationText: string, kind: 'url' | 'inline' | 'reference') => {
      const clean = citationText.trim().replace(/[),.;]+$/, '');
      if (!clean || citations.has(clean.toLowerCase())) return;
      citations.set(clean.toLowerCase(), { id: id('citation'), text: clean, kind, sourceId });
    };

    (text.match(/https?:\/\/[^\s)]+/gi) || []).forEach((match) => add(match, 'url'));
    (text.match(/\[[^\]]{1,80}\]\([^)]+\)/g) || []).forEach((match) => add(match, 'inline'));
    (text.match(/\[(?:\d{1,3}|[A-Z][A-Za-z]+,\s*\d{4})\]/g) || []).forEach((match) => add(match, 'reference'));
    (text.match(/\((?:[A-Z][A-Za-z-]+(?:\s+et al\.)?,\s*\d{4}[a-z]?)\)/g) || []).forEach((match) => add(match, 'reference'));

    return [...citations.values()].slice(0, 60);
  }

  private formattingChanges(originalText: string, normalizedText: string): string[] {
    const changes: string[] = [];
    if (/\r/.test(originalText)) changes.push('line-endings-normalized');
    if (/\t/.test(originalText)) changes.push('tabs-expanded');
    if (/[“”‘’]/.test(originalText)) changes.push('smart-quotes-normalized');
    if (/\n{3,}/.test(originalText)) changes.push('excess-blank-lines-collapsed');
    if (originalText.trim() !== originalText) changes.push('outer-whitespace-trimmed');
    if (originalText !== normalizedText && !changes.length) changes.push('minor-whitespace-normalized');
    return changes;
  }

  private intentPreservationScore(originalText: string, sanitizedText: string, citationCount: number): number {
    const originalTerms = this.meaningTerms(originalText);
    const sanitizedTerms = this.meaningTerms(sanitizedText);
    if (!originalTerms.size) return 1;
    const retained = [...originalTerms].filter((term) => sanitizedTerms.has(term)).length;
    const retention = retained / originalTerms.size;
    const citationBonus = citationCount ? 0.03 : 0;
    return Number(Math.min(1, Math.max(0, retention + citationBonus)).toFixed(3));
  }

  private meaningTerms(text: string): Set<string> {
    const stop = new Set(['this', 'that', 'with', 'from', 'into', 'have', 'will', 'your', 'about', 'their', 'there', 'when', 'then', 'than', 'they', 'the', 'and', 'for']);
    return new Set((String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter((term) => !stop.has(term)));
  }

  private dedupeKey(text: string): string {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }
}
