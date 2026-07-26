import { Injectable } from '@nestjs/common';
import { id } from '../shared/ids';
import { documentSentences, keyPhrases, phraseLabel, SCAFFOLDING_WORDS } from '../shared/text';
import type { SanitizedContentItem } from './content-sanitization.service';

export interface SemanticExtractionInput {
  title: string;
  items: SanitizedContentItem[];
  sanitization?: unknown;
  goals?: string[];
  achievements?: string[];
}

@Injectable()
export class SemanticExtractionService {
  extract(input: SemanticExtractionInput) {
    const documents = input.items.map((item, index) => this.extractDocument(item, index));
    const concepts = this.uniqueByText(documents.flatMap((document) => document.concepts));
    const actions = documents.flatMap((document) => document.actions);
    const entities = this.uniqueByText(documents.flatMap((document) => document.entities));
    const impacts = documents.flatMap((document) => document.impacts);
    const relationships = this.extractRelationships(concepts, actions, documents, impacts);
    const chronology = this.extractChronology(actions);
    const dependencies = this.extractDependencies(actions, documents);
    const learningObjectives = this.extractLearningObjectives(input, concepts, actions);
    // Context Modeling (5W1H): the semantic engine's understanding of Who / What /
    // Where / When / Why / How, folded together from the per-document signals.
    const contextModel = this.buildContextModel({ entities, concepts, actions, chronology, impacts, relationships });
    const rhetorical = {
      quotes: documents.flatMap((document) => document.quotes),
      examples: documents.flatMap((document) => document.examples),
      anecdotes: documents.flatMap((document) => document.anecdotes),
    };

    return {
      schemaVersion: '0.1.0',
      kind: 'optimole.semanticExtraction',
      id: id('sem'),
      generatedAt: new Date().toISOString(),
      title: input.title,
      documents,
      people: entities.filter((entity) => entity.type === 'PERSON'),
      places: entities.filter((entity) => entity.type === 'PLACE'),
      dates: entities.filter((entity) => entity.type === 'DATE'),
      entities,
      concepts,
      actions,
      relationships,
      chronology,
      dependencies,
      learningObjectives,
      impacts,
      contextModel,
      examples: rhetorical.examples,
      anecdotes: rhetorical.anecdotes,
      importantQuotes: rhetorical.quotes,
      stats: {
        documentCount: documents.length,
        conceptCount: concepts.length,
        actionCount: actions.length,
        impactCount: impacts.length,
        relationshipCount: relationships.length,
        causalRelationshipCount: relationships.filter((relationship) => relationship.type === 'causal' || relationship.type === 'impact').length,
      },
    };
  }

  private extractDocument(item: SanitizedContentItem, index: number) {
    const sentences = this.sentences(item.text);
    const paragraphs = String(item.text || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const sections = this.sections(item.text, item.title);
    return {
      id: item.id,
      order: index,
      title: item.title,
      sourceType: item.sourceType,
      origin: item.origin,
      provenance: item.provenance,
      citations: item.citations,
      sensitiveInformation: item.sensitiveInformation,
      sanitization: item.sanitization,
      segmentation: {
        sectionCount: sections.length,
        paragraphCount: paragraphs.length,
        sentenceCount: sentences.length,
        sections,
      },
      entities: this.extractEntities(sentences, item.id),
      concepts: this.extractConcepts(sentences, item.id),
      actions: this.extractActions(sentences, item.id),
      impacts: this.extractImpacts(sentences, item.id),
      quotes: this.extractQuotes(sentences, item.id),
      examples: this.extractExamples(sentences, item.id),
      anecdotes: this.extractAnecdotes(sentences, item.id),
      salience: this.salience(item.text, index),
    };
  }

  private sections(text: string, fallbackTitle: string) {
    const lines = String(text || '').split('\n');
    const headings = lines
      .map((line, index) => ({ line: line.trim().replace(/^#+\s*/, ''), index }))
      .filter((entry) => /^#{1,3}\s+/.test(lines[entry.index]) || /^[A-Z][A-Z0-9\s-]{6,}$/.test(entry.line));
    if (!headings.length) return [{ title: fallbackTitle, order: 0 }];
    return headings.slice(0, 12).map((heading, order) => ({ title: heading.line, order }));
  }

  private extractEntities(sentences: string[], sourceId: string) {
    const entities: any[] = [];
    sentences.forEach((sentence, sentenceIndex) => {
      const dateMatches = sentence.match(/\b(?:Q[1-4]\s*)?\d{4}\b|\b(?:today|tomorrow|yesterday|weekly|monthly|quarterly|daily)\b/gi) || [];
      dateMatches.forEach((text) => entities.push(this.entity(text, 'DATE', sourceId, sentenceIndex, sentence, 0.86)));

      const orgMatches = sentence.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+(?:Inc|LLC|Corp|Corporation|University|Agency|Department|Team|Platform|CRM|API|Ops|SecOps))\b/g) || [];
      orgMatches.forEach((text) => entities.push(this.entity(text, 'ORGANIZATION', sourceId, sentenceIndex, sentence, 0.78)));

      const personMatches = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) || [];
      personMatches
        .filter((text) => !orgMatches.some((org) => org.includes(text)))
        .filter((text) => !this.isNonNamePhrase(text))
        .forEach((text) => {
          // Only call it a PERSON when the sentence gives person evidence (a title
          // or a person-verb near the mention). Otherwise it is a capitalized
          // concept/proper noun, not a human — keep it, but out of "who".
          const isPerson = this.hasPersonEvidence(text, sentence);
          entities.push(
            isPerson
              ? this.entity(text, 'PERSON', sourceId, sentenceIndex, sentence, 0.74)
              : this.entity(text, 'PROPER_NOUN', sourceId, sentenceIndex, sentence, 0.5),
          );
        });

      const placeMatches = sentence.match(/\b(?:in|at|from|to)\s+([A-Z][A-Za-z0-9.-]*(?:\s+[A-Z][A-Za-z0-9.-]*){0,3})\b/g) || [];
      placeMatches.forEach((match) => entities.push(this.entity(match.replace(/^(in|at|from|to)\s+/i, ''), 'PLACE', sourceId, sentenceIndex, sentence, 0.62)));
    });
    return this.uniqueByText(entities).slice(0, 40);
  }

  /**
   * True when a capitalized run is clearly not a personal name: it leads with a
   * determiner/pronoun/quantifier ("The Industrial Revolution", "Our Q3 Plan") or
   * ends in a common non-name noun ("... Revolution", "... Theory").
   */
  private isNonNamePhrase(text: string): boolean {
    const tokens = text.split(/\s+/);
    const leaders = new Set([
      'the', 'a', 'an', 'this', 'that', 'these', 'those', 'our', 'their', 'its', 'his', 'her', 'my', 'your',
      'we', 'they', 'it', 'he', 'she', 'some', 'many', 'most', 'each', 'every', 'another', 'other', 'no',
    ]);
    if (leaders.has(tokens[0]?.toLowerCase())) return true;
    const nonNameNouns = new Set([
      'Revolution', 'Theory', 'Physics', 'Chemistry', 'Biology', 'History', 'Age', 'Era', 'Period', 'Act',
      'Law', 'Effect', 'Model', 'System', 'Method', 'Process', 'Report', 'Study', 'Project', 'Program',
      'Plan', 'Strategy', 'Framework', 'Principle', 'Equation', 'Formula', 'Movement', 'Doctrine', 'War',
    ]);
    return nonNameNouns.has(tokens[tokens.length - 1]);
  }

  /** A title prefix or a nearby person-verb is evidence the mention is a human. */
  private hasPersonEvidence(text: string, sentence: string): boolean {
    if (/\b(Dr|Mr|Mrs|Ms|Prof|Professor|President|CEO|CTO|CFO|Director|Senator|Governor|Sir|Dame|Lord|Lady|Captain|Doctor)\.?\s/.test(sentence)) {
      return true;
    }
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cue = '(said|says|wrote|writes|argues|argued|explains|explained|developed|discovered|invented|founded|proposed|noted|observed|created|designed|reported|claims|claimed|led|leads|joined|hired|met|asked|told)';
    const nearBefore = new RegExp(`${escaped}\\s+(?:\\w+\\s+){0,2}${cue}\\b`, 'i');
    const nearAfter = new RegExp(`\\b${cue}\\s+(?:by\\s+)?(?:\\w+\\s+){0,2}${escaped}`, 'i');
    return nearBefore.test(sentence) || nearAfter.test(sentence);
  }

  private entity(text: string, type: string, sourceId: string, sentenceIndex: number, context: string, confidence: number) {
    return {
      id: id('entity'),
      text,
      type,
      sourceId,
      sentenceIndex,
      confidence,
      context,
    };
  }

  /**
   * Concepts, ranked by how much they actually say.
   *
   * Counting occurrences and sorting by the count surfaces whatever generic
   * noun the document repeats most — a real run over an architecture doc
   * returned "layer", "inbox", "source", "person" as its top concepts, which
   * then became region names and collectible labels. Frequency measures how
   * often a word appears, not how much it identifies.
   *
   * So three things happen here that raw counting did not do:
   *
   *  1. SINGULAR AND PLURAL ARE ONE CONCEPT. "signal" and "signals" competed as
   *     separate entries and split their own frequency.
   *  2. A PHRASE SUBSUMES ITS PARTS. If "signal extraction" was extracted, the
   *     bare "signal" is not also a concept — the longer phrase is what the
   *     document is about, and it makes a legible label.
   *  3. SALIENCE IS A 0-1 SCORE, NOT A TALLY. Every other producer in this
   *     service emits salience in 0-1 and downstream layers treat it as one:
   *     the knowledge graph passes it straight through as edge confidence, so a
   *     phrase seen ten times was scoring an edge at 10. Specificity is blended
   *     in, so a precise phrase outranks a common word that appears twice as often.
   */
  private extractConcepts(sentences: string[], sourceId: string) {
    const found = new Map<string, {
      id: string; text: string; tokens: string[]; occurrences: number;
      sentenceIndex: number; context: string;
    }>();

    sentences.forEach((sentence, sentenceIndex) => {
      keyPhrases(sentence).forEach((phrase) => {
        const tokens = this.conceptTokens(phrase);
        if (!tokens.length) return;
        if (tokens.length === 1 && SCAFFOLDING_WORDS.has(tokens[0])) return;
        const key = tokens.join(' ');
        const current = found.get(key);
        if (current) {
          current.occurrences += 1;
          // Keep the surface form that reads best: prefer one carrying real
          // capitalization ("Signal Extraction" over "signal extraction").
          if (/[A-Z]/.test(phrase) && !/[A-Z]/.test(current.text)) current.text = phrase;
          return;
        }
        found.set(key, {
          id: id('concept'),
          text: phrase,
          tokens,
          occurrences: 1,
          sentenceIndex,
          context: sentence,
        });
      });
    });

    const surviving = this.dropSubsumedPhrases([...found.values()]);
    // A phrase seen once in a long document is usually a passing turn of
    // phrase, not a topic. Repeats are preferred when the document supplies
    // enough of them; a short document keeps everything rather than emptying.
    const repeated = surviving.filter((entry) => entry.occurrences > 1);
    const kept = repeated.length >= 12 ? repeated : surviving;
    const maxOccurrences = kept.reduce((most, entry) => Math.max(most, entry.occurrences), 1);

    return kept
      .map((entry) => {
        // Log-scaled so one runaway word cannot flatten everything below it.
        // Frequency carries most of the weight: specificity is a tie-breaker
        // between comparably common phrases, and when it led instead, a
        // four-word fragment seen once outranked the document's actual subject.
        const frequency = Math.log1p(entry.occurrences) / Math.log1p(maxOccurrences);
        const specificity = Math.min(1, 0.3 + 0.25 * (entry.tokens.length - 1));
        return {
          id: entry.id,
          text: entry.text,
          type: 'CONCEPT',
          sourceId,
          sentenceIndex: entry.sentenceIndex,
          confidence: Math.min(0.95, 0.58 + entry.occurrences * 0.04),
          salience: Number((0.7 * frequency + 0.3 * specificity).toFixed(3)),
          occurrences: entry.occurrences,
          context: entry.context,
        };
      })
      .sort((a, b) => b.salience - a.salience || b.occurrences - a.occurrences)
      .slice(0, 36);
  }

  /** Lowercase tokens with the plural collapsed, so "Signals" and "signal" match. */
  private conceptTokens(phrase: string): string[] {
    return phrase
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9-]/g, ''))
      .filter(Boolean)
      .map((token) => this.singular(token));
  }

  /** Crude but predictable: only strip an -s that is really a plural marker. */
  private singular(token: string): string {
    if (token.length <= 3) return token;
    if (/(?:ss|us|is|as|os|ics)$/.test(token)) return token;
    if (/ies$/.test(token)) return `${token.slice(0, -3)}y`;
    return token.replace(/s$/, '');
  }

  /**
   * Drop a phrase whose tokens appear, in order, inside a longer phrase that is
   * not markedly rarer. "signal" goes when "signal extraction" is present;
   * "layer" survives if nothing longer ever contained it.
   */
  private dropSubsumedPhrases<T extends { tokens: string[]; occurrences: number }>(entries: T[]): T[] {
    const longestFirst = [...entries].sort((a, b) => b.tokens.length - a.tokens.length);
    return entries.filter((entry) =>
      !longestFirst.some((other) =>
        other !== entry
        && other.tokens.length > entry.tokens.length
        // A parent seen far less often than its part is the rarer coinage, and
        // dropping the part on its account would lose the real topic.
        && other.occurrences >= entry.occurrences * 0.5
        && this.containsSequence(other.tokens, entry.tokens)));
  }

  private containsSequence(haystack: string[], needle: string[]): boolean {
    for (let start = 0; start + needle.length <= haystack.length; start += 1) {
      if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
    }
    return false;
  }

  private extractActions(sentences: string[], sourceId: string) {
    const actionCue = /\b(write|segment|automate|test|increase|improve|review|identify|extract|normalize|build|create|connect|verify|avoid|compare|analyze|configure|complete|select|confirm|submit|route|convert|compile|unlock|restore|promote|restart|isolate)\b/i;
    return sentences
      .map((sentence, sentenceIndex) => ({ sentence, sentenceIndex, match: sentence.match(actionCue) }))
      .filter((entry) => entry.match)
      .slice(0, 30)
      .map((entry, order) => ({
        id: id('action'),
        text: entry.sentence,
        // An action is a whole sentence on purpose — it is the instruction. But
        // downstream it also has to NAME things (an enemy, a collectible, a
        // quest step), and a sentence makes a terrible name: a hazard once
        // reached the screen as "Without it, adding the second consumer later
        // means a second scoring model…". `label` is the noun phrase the
        // sentence is about, so callers have something to display.
        label: phraseLabel(entry.sentence),
        verb: entry.match?.[1]?.toLowerCase(),
        type: /\b(avoid|warning|risk|mistake|fail|threat)\b/i.test(entry.sentence) ? 'MISTAKE_OR_RISK' : 'ACTION',
        sourceId,
        sentenceIndex: entry.sentenceIndex,
        order,
        confidence: 0.74,
      }));
  }

  private extractImpacts(sentences: string[], sourceId: string) {
    return sentences
      .filter((sentence) => /\b(impact|effect|outcome|result(?:s|ed)?|leads? to|led to|caus\w*|therefore|because|transform\w*|chang\w*|influenc\w*|enabl\w*|improv\w*|reduc\w*|increas\w*|decreas\w*|drove|drives?)\b/i.test(sentence))
      .slice(0, 18)
      .map((sentence, index) => ({
        id: id('impact'),
        type: 'Impact',
        statement: sentence,
        label: phraseLabel(sentence),
        sourceId,
        order: index,
        polarity: /\b(reduc\w*|decreas\w*|risk|fail\w*|loss|cost)\b/i.test(sentence) ? 'negative-or-mitigating' : 'positive-or-causal',
        confidence: 0.68,
      }));
  }

  private extractRelationships(concepts: any[], actions: any[], documents: any[], impacts: any[] = []) {
    const relationships: any[] = [];
    const conceptPairs = concepts.slice(0, 14);
    for (let index = 0; index < conceptPairs.length - 1; index += 1) {
      relationships.push({
        id: id('rel'),
        type: 'semantic',
        from: conceptPairs[index].id,
        to: conceptPairs[index + 1].id,
        relation: 'co_occurs_with',
        confidence: 0.56,
      });
    }
    documents.flatMap((document) => document.segmentation.sections).forEach((section, index, all) => {
      if (index < all.length - 1) {
        relationships.push({
          id: id('rel'),
          type: 'hierarchical',
          from: section.title,
          to: all[index + 1].title,
          relation: 'adjacent_section',
          confidence: 0.6,
        });
      }
    });
    actions.forEach((action) => {
      if (/\b(because|leads? to|led to|results? in|resulted in|therefore|so that|caus\w*|influenc\w*|enabl\w*|transform\w*)\b/i.test(action.text)) {
        relationships.push({
          id: id('rel'),
          type: 'causal',
          from: action.id,
          to: concepts[0]?.id || action.id,
          relation: 'affects',
          confidence: 0.72,
          evidence: action.text,
        });
      }
    });
    impacts.forEach((impact) => {
      relationships.push({
        id: id('rel'),
        type: 'impact',
        from: actions.find((action) => action.sourceId === impact.sourceId)?.id || concepts[0]?.id || impact.sourceId,
        to: impact.id,
        relation: 'produces_impact',
        confidence: impact.confidence || 0.64,
        evidence: impact.statement,
      });
    });
    return relationships;
  }

  private extractChronology(actions: any[]) {
    return actions.slice(0, 16).map((action, index, all) => ({
      id: id('time'),
      actionId: action.id,
      order: index,
      before: all[index + 1]?.id || null,
      after: all[index - 1]?.id || null,
      cue: /\b(first|before|then|after|finally|next)\b/i.exec(action.text)?.[1]?.toLowerCase() || null,
    }));
  }

  private extractDependencies(actions: any[], documents: any[]) {
    const dependencies = actions
      .filter((action) => /\b(before|after|requires|required|must|need|depends|prerequisite)\b/i.test(action.text))
      .map((action) => ({
        id: id('dep'),
        relation: /\bafter\b/i.test(action.text) ? 'follows' : 'requires',
        from: action.id,
        to: actions.find((candidate) => candidate.id !== action.id)?.id || action.id,
        type: 'temporal_dependency',
        confidence: 0.68,
        evidence: action.text,
      }));
    if (!dependencies.length && documents.length > 1) {
      return documents.slice(0, -1).map((document, index) => ({
        id: id('dep'),
        relation: 'precedes',
        from: document.id,
        to: documents[index + 1].id,
        type: 'document_sequence',
        confidence: 0.5,
      }));
    }
    return dependencies;
  }

  private extractLearningObjectives(input: SemanticExtractionInput, concepts: any[], actions: any[]) {
    const goals = input.goals?.length ? input.goals : [`Understand ${input.title}`];
    return goals.map((goal, index) => ({
      id: id('objective'),
      type: 'LearningObjective',
      goalStatement: goal,
      relatedConceptIds: concepts.slice(index, index + 5).map((concept) => concept.id),
      requiredActionIds: actions.slice(index, index + 4).map((action) => action.id),
      successMetric: input.achievements?.[index] || 'Player can select source-backed evidence and complete the mission.',
      confidence: 0.78,
    }));
  }

  private buildContextModel(input: { entities: any[]; concepts: any[]; actions: any[]; chronology: any[]; impacts: any[]; relationships: any[] }) {
    return {
      who: input.entities.filter((entity) => ['PERSON', 'ORGANIZATION'].includes(entity.type)).slice(0, 12),
      what: input.concepts.slice(0, 12),
      where: input.entities.filter((entity) => entity.type === 'PLACE').slice(0, 8),
      when: input.entities.filter((entity) => entity.type === 'DATE').slice(0, 8),
      why: input.impacts.slice(0, 10),
      how: input.actions.slice(0, 12),
      relationshipCount: input.relationships.length,
    };
  }

  private extractQuotes(sentences: string[], sourceId: string) {
    return sentences
      .filter((sentence) => /["“”]/.test(sentence))
      .slice(0, 12)
      .map((sentence, index) => ({
        id: id('quote'),
        type: 'Quote',
        statement: sentence,
        speaker: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:said|argues|wrote|explains)\b/.exec(sentence)?.[1] || 'Unknown',
        sourceId,
        order: index,
        confidence: 0.72,
      }));
  }

  private extractExamples(sentences: string[], sourceId: string) {
    return sentences
      .filter((sentence) => /\b(for example|such as|imagine|e\.g\.)\b/i.test(sentence))
      .slice(0, 12)
      .map((sentence, index) => ({
        id: id('example'),
        type: 'Example',
        scenario: sentence,
        sourceId,
        order: index,
        confidence: 0.76,
      }));
  }

  private extractAnecdotes(sentences: string[], sourceId: string) {
    return sentences
      .filter((sentence) => /\b(once|when|after|before)\b/i.test(sentence) && /\b(struggled|failed|won|lost|learned|discovered)\b/i.test(sentence))
      .slice(0, 8)
      .map((sentence, index) => ({
        id: id('anecdote'),
        type: 'Anecdote',
        storyArc: sentence,
        sourceId,
        order: index,
        confidence: 0.62,
      }));
  }
  private salience(text: string, order: number) {
    const lengthScore = Math.min(0.4, String(text || '').length / 6000);
    return Number((0.55 + lengthScore - order * 0.02).toFixed(3));
  }

  private uniqueByText<T extends { text?: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = String(item.text || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Structure-aware segmentation, shared with IRX and emotional intelligence. */
  private sentences(text: string): string[] {
    return documentSentences(text);
  }
}
