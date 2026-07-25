import { Injectable } from '@nestjs/common';
import { id } from '../shared/ids';
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

  private extractConcepts(sentences: string[], sourceId: string) {
    const concepts = new Map<string, any>();
    sentences.forEach((sentence, sentenceIndex) => {
      this.keyPhrases(sentence).forEach((phrase) => {
        const key = phrase.toLowerCase();
        const current = concepts.get(key);
        concepts.set(key, {
          id: current?.id || id('concept'),
          text: phrase,
          type: 'CONCEPT',
          sourceId,
          sentenceIndex: current?.sentenceIndex ?? sentenceIndex,
          confidence: Math.min(0.95, (current?.confidence || 0.58) + 0.04),
          salience: (current?.salience || 0) + 1,
          context: current?.context || sentence,
        });
      });
    });
    return [...concepts.values()].sort((a, b) => b.salience - a.salience).slice(0, 36);
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

  /** Determiners and quantifiers. A word right after one of these opens a noun phrase. */
  private static readonly DETERMINERS = [
    'a', 'an', 'the', 'this', 'that', 'these', 'those', 'each', 'every', 'some', 'any', 'no', 'all',
    'both', 'either', 'neither', 'much', 'many', 'more', 'most', 'few', 'several', 'such', 'own',
    'my', 'your', 'his', 'her', 'its', 'our', 'their',
  ];

  private static readonly PREPOSITIONS = [
    'of', 'in', 'on', 'at', 'to', 'from', 'by', 'for', 'with', 'without', 'into', 'onto', 'upon',
    'about', 'across', 'after', 'before', 'during', 'through', 'between', 'among', 'against',
    'over', 'under', 'above', 'below', 'within', 'inside', 'outside', 'toward', 'towards', 'via', 'per',
    // participial prepositions — they head a modifier clause, not a concept
    'using', 'including', 'regarding', 'concerning', 'following', 'based', 'given', 'despite',
  ];

  private static readonly SUBORDINATORS = [
    'and', 'or', 'but', 'nor', 'so', 'yet', 'as', 'than', 'because', 'if', 'unless', 'while',
    'when', 'where', 'whether', 'though', 'although', 'since', 'until',
  ];

  /**
   * Words after which a lone following word is almost certainly a verb, not a
   * concept: modals, the infinitive marker, copulas, do-support, negation, and
   * the adverbs that introduce an imperative step ("First, isolate the host").
   */
  private static readonly VERB_LEAD = new Set([
    'to', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
    'have', 'has', 'had', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
    'must', 'need', 'ought', 'let', 'not', 'never', 'also', 'then', 'first', 'second', 'third',
    'next', 'finally', 'likely', 'probably', 'typically', 'generally', 'simply', 'actually',
    'really', 'clearly', 'certainly', 'often', 'usually', 'always',
  ]);

  /**
   * Words that end a noun phrase rather than belong to one. A phrase is never
   * allowed to start or end on one of these, which is what keeps concepts from
   * coming out as mid-sentence fragments.
   */
  private static readonly PHRASE_BOUNDARY = new Set([
    ...SemanticExtractionService.DETERMINERS,
    ...SemanticExtractionService.PREPOSITIONS,
    ...SemanticExtractionService.SUBORDINATORS,
    // pronouns / wh-words
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'us', 'them',
    'who', 'whom', 'whose', 'which', 'what', 'there', 'here',
    // auxiliaries / modals / copulas
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'done',
    'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could',
    'may', 'might', 'must', 'need', 'ought', 'let',
    // sequence / discourse / manner adverbs — these surfaced as standalone "concepts"
    'first', 'second', 'third', 'next', 'then', 'finally', 'also', 'however', 'therefore',
    'thus', 'meanwhile', 'furthermore', 'moreover', 'instead', 'rather', 'again', 'once',
    'very', 'just', 'only', 'even', 'still', 'not', 'never', 'always', 'often', 'usually',
    'likely', 'probably', 'typically', 'generally', 'simply', 'actually', 'really', 'clearly',
    'certainly',
    // high-frequency verbs — splitting on these leaves the noun phrases on either side
    'get', 'gets', 'got', 'make', 'makes', 'made', 'take', 'takes', 'took', 'give', 'gives',
    'use', 'uses', 'used', 'show', 'shows', 'showed', 'know', 'knows', 'knew', 'see', 'sees',
    'come', 'comes', 'came', 'go', 'goes', 'went', 'say', 'says', 'said', 'find', 'finds',
    'found', 'keep', 'keeps', 'kept', 'put', 'puts', 'call', 'calls', 'called', 'become',
    'becomes', 'became', 'includes', 'include', 'included', 'contains', 'contain', 'allows',
    'allow', 'produces', 'produce', 'produced', 'requires', 'require', 'required', 'means',
    'converts', 'convert', 'absorbs', 'absorb', 'splits', 'split', 'fixes', 'fix', 'hosts',
    'host', 'regulates', 'regulate', 'catalyzes', 'catalyze', 'releases', 'release',
    'identify', 'identifies', 'review', 'reviews', 'avoid', 'avoids', 'complete', 'completes',
    'build', 'builds', 'create', 'creates', 'verify', 'verifies', 'compare', 'compares',
    'analyze', 'analyzes', 'configure', 'configures', 'select', 'selects', 'improve',
    'improves', 'increase', 'increases', 'explain', 'explains', 'learn', 'learns',
    'holds', 'hold', 'wants', 'want', 'remains', 'remain', 'depends', 'depend', 'rise', 'rises',
    'encrypt', 'encrypts', 'revoke', 'revokes', 'rotate', 'rotates', 'isolate', 'isolates',
    'restart', 'restarts', 'decide', 'decides', 'enter', 'enters', 'capture', 'captures',
  ]);

  /** Longest phrase we keep. English noun phrases are head-final, so we trim the front. */
  private static readonly MAX_PHRASE_TOKENS = 4;

  /** A third-person verb form ("holds", "reviews") rather than a plural noun ("logs", "class"). */
  private looksThirdPerson(word: string): boolean {
    return /s$/.test(word) && !/(?:ss|us|is|as|os)$/.test(word) && word.length > 3;
  }

  /**
   * Extract noun-phrase-shaped concepts from one sentence.
   *
   * The previous implementation slid a non-overlapping 1-3 word window across the
   * sentence, which chopped clauses at arbitrary points: "Chlorophyll absorbs blue
   * and red light inside the chloroplast" became "Chlorophyll absorbs blue" /
   * "and red light" / "inside the chloroplast". Those fragments became gameplay
   * atom labels, entity captions, and world location names.
   *
   * Instead, split on function words and punctuation and keep the content-word
   * runs between them, then use the surrounding function words to tell a noun
   * phrase from a bare verb — a single word after a modal ("must decide") or
   * before a determiner ("isolate the endpoint") is the predicate, not a concept.
   * Phrases are sliced from the original sentence so real capitalization survives.
   */
  private keyPhrases(sentence: string) {
    const tokens: Array<{ lower: string; start: number; end: number }> = [];
    const wordPattern = /[A-Za-z][A-Za-z0-9-]*/g;
    let match: RegExpExecArray | null;
    while ((match = wordPattern.exec(sentence)) !== null) {
      tokens.push({ lower: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
    }

    const phrases: string[] = [];
    const seen = new Set<string>();
    let run: typeof tokens = [];
    // The function words bracketing the current run; '' means punctuation or
    // the sentence edge, which carries no part-of-speech evidence.
    let leading = '';

    const flush = (trailing: string) => {
      const candidate = run;
      run = [];
      if (!candidate.length) return;

      // "The forensic analyst reviews the logs" -> drop the trailing verb.
      const trailingIsDeterminer = SemanticExtractionService.DETERMINERS.includes(trailing);
      let kept = candidate;
      if (kept.length > 1 && trailingIsDeterminer && this.looksThirdPerson(kept[kept.length - 1].lower)) {
        kept = kept.slice(0, -1);
      }
      // Head-final: "the primary electron transport chain" -> "electron transport chain".
      if (kept.length > SemanticExtractionService.MAX_PHRASE_TOKENS) {
        kept = kept.slice(-SemanticExtractionService.MAX_PHRASE_TOKENS);
      }
      if (!kept.length) return;

      if (kept.length === 1) {
        const word = kept[0];
        // A lone short word ("red", "gas") is noise, not a concept.
        if (word.end - word.start < 5) return;
        // Positional verb test: "must decide whether", "isolate the endpoint".
        const followsVerbLead = SemanticExtractionService.VERB_LEAD.has(leading);
        const precedesFunctionWord = trailingIsDeterminer
          || SemanticExtractionService.PREPOSITIONS.includes(trailing)
          || SemanticExtractionService.SUBORDINATORS.includes(trailing);
        if (followsVerbLead && precedesFunctionWord) return;
        if (trailingIsDeterminer && !SemanticExtractionService.DETERMINERS.includes(leading)) return;
      }

      const phrase = sentence.slice(kept[0].start, kept[kept.length - 1].end).trim();
      const key = phrase.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      phrases.push(phrase);
    };

    for (const token of tokens) {
      if (SemanticExtractionService.PHRASE_BOUNDARY.has(token.lower)) {
        flush(token.lower);
        leading = token.lower;
        continue;
      }
      // Punctuation between two words also ends the phrase — a comma or dash is
      // a clause boundary, not part of the concept.
      const previous = run[run.length - 1];
      if (previous && /[^\s]/.test(sentence.slice(previous.end, token.start))) {
        flush('');
        leading = '';
      }
      run.push(token);
    }
    flush('');

    return phrases.slice(0, 8);
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

  private sentences(text: string): string[] {
    return String(text || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }
}
