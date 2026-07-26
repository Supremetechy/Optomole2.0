import { Injectable } from '@nestjs/common';
import { id } from '../shared/ids';
import { HUMAN_EXPERIENCES } from '../shared/human-experiences';
import { documentSentences } from '../shared/text';
import type { SanitizedContentItem } from './content-sanitization.service';

export interface EmotionalIntelligenceInput {
  title: string;
  items: SanitizedContentItem[];
  semanticExtraction?: any;
}

/**
 * Emotional Intelligence Engine — layer 3 of the Optomole preprocessing flow.
 *
 * Where the Semantic Intelligence Engine surfaces *what* the content means, this
 * engine surfaces how it *feels*. It reads the sanitized content and extracts:
 *   - emotions          discrete emotional states embedded in the content
 *                       (e.g. Curiosity, Confidence, Discovery, Challenge)
 *   - emotionArc        the beginning / middle / end emotional trajectory
 *                       (e.g. Confusion -> Struggle -> Achievement)
 *   - stakeholderSentiment  per-actor sentiment in business content
 *                       (e.g. Customer: Frustration, Company: Urgency, Solution: Optimism)
 *
 * Output is consumed by the Storyboard Generator (scene emotion beats) and folded
 * into the ExperienceManifest emotion_model by the compiler.
 */
@Injectable()
export class EmotionalIntelligenceService {
  /** keyword -> emotion label. Order-independent; every hit adds weight. */
  private readonly emotionLexicon: Record<string, string[]> = {
    curiosity: ['curious', 'wonder', 'explore', 'question', 'investigate', 'intrigue', 'why', 'how', 'what if', 'discover'],
    confidence: ['confident', 'certain', 'proven', 'clearly', 'demonstrates', 'established', 'reliable', 'robust', 'assured'],
    discovery: ['discover', 'found', 'reveal', 'uncover', 'breakthrough', 'insight', 'realize', 'novel', 'new finding'],
    challenge: ['challenge', 'difficult', 'obstacle', 'problem', 'complex', 'hard', 'barrier', 'threat', 'risk'],
    confusion: ['confusion', 'unclear', 'uncertain', 'ambiguous', 'lost', 'puzzled', "don't understand", 'complicated', 'overwhelmed'],
    struggle: ['struggle', 'fail', 'setback', 'stuck', 'frustrated', 'exhaust', 'pressure', 'strain', 'blocked'],
    achievement: ['achieve', 'success', 'accomplish', 'win', 'complete', 'master', 'triumph', 'solved', 'overcome', 'milestone'],
    frustration: ['frustrat', 'annoyed', 'disappoint', 'complaint', 'angry', 'blocked', 'delay', 'broken', 'pain point'],
    urgency: ['urgent', 'immediately', 'critical', 'now', 'deadline', 'asap', 'time-sensitive', 'must', 'escalat', 'priority'],
    optimism: ['optimis', 'hope', 'promising', 'improve', 'growth', 'opportunity', 'positive', 'confident future', 'bright'],
    determination: ['determined', 'commit', 'persist', 'drive', 'resolve', 'push forward', 'relentless', 'focused'],
  };

  private readonly positiveWords = ['success', 'improve', 'gain', 'benefit', 'growth', 'win', 'optimis', 'hope', 'solve', 'resolve', 'strong', 'confident', 'opportunity', 'reliable'];
  private readonly negativeWords = ['fail', 'risk', 'loss', 'frustrat', 'delay', 'problem', 'threat', 'broken', 'complaint', 'decline', 'weak', 'blocked', 'pain', 'error', 'concern'];

  /** stakeholder role -> mention cues, used to attribute sentiment in business content. */
  private readonly stakeholderRoles: Record<string, string[]> = {
    Customer: ['customer', 'user', 'client', 'buyer', 'subscriber', 'consumer', 'audience'],
    Company: ['company', 'team', 'organization', 'business', 'we ', 'our ', 'leadership', 'stakeholder', 'internal'],
    Solution: ['solution', 'product', 'feature', 'platform', 'fix', 'approach', 'system', 'roadmap', 'strategy'],
    Market: ['market', 'competitor', 'industry', 'segment', 'demand', 'trend'],
  };

  extract(input: EmotionalIntelligenceInput) {
    const documents = input.items.map((item, index) => this.analyzeDocument(item, index));
    const allSentences = documents.flatMap((document) => document.sentences);

    const emotions = this.aggregateEmotions(documents);
    const emotionArc = this.buildEmotionArc(allSentences);
    const stakeholderSentiment = this.buildStakeholderSentiment(allSentences);
    const overallSentiment = this.overallSentiment(allSentences);
    // Human experiences the content evokes (Momentum, Flow, Mastery, ...) — the
    // felt states gameplay can be designed to cultivate for the user.
    const experienceTargets = this.detectExperiences(allSentences);

    return {
      schemaVersion: '0.1.0',
      kind: 'optimole.emotionalIntelligence',
      id: id('emo'),
      generatedAt: new Date().toISOString(),
      title: input.title,
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        order: document.order,
        dominantEmotion: document.dominantEmotion,
        emotions: document.emotions,
      })),
      emotions,
      emotionArc,
      stakeholderSentiment,
      overallSentiment,
      experienceTargets,
      stats: {
        documentCount: documents.length,
        distinctEmotionCount: emotions.length,
        stakeholderCount: stakeholderSentiment.length,
        experienceTargetCount: experienceTargets.length,
        sentenceCount: allSentences.length,
      },
    };
  }

  private analyzeDocument(item: SanitizedContentItem, index: number) {
    const sentences = this.sentences(item.text);
    const scores = this.scoreEmotions(sentences.join(' '));
    const emotions = this.rankEmotions(scores).slice(0, 6);
    return {
      id: item.id,
      title: item.title,
      order: index,
      sentences,
      emotions,
      dominantEmotion: emotions[0]?.emotion || 'neutral',
    };
  }

  private aggregateEmotions(documents: Array<{ emotions: Array<{ emotion: string; score: number }> }>) {
    const totals = new Map<string, number>();
    documents.forEach((document) => {
      document.emotions.forEach(({ emotion, score }) => {
        totals.set(emotion, (totals.get(emotion) || 0) + score);
      });
    });
    const max = Math.max(1, ...totals.values());
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([emotion, score]) => ({
        id: id('emotion'),
        emotion: this.label(emotion),
        weight: score,
        intensity: Number((score / max).toFixed(3)),
        confidence: Number(Math.min(0.95, 0.55 + score / (max * 4)).toFixed(3)),
      }));
  }

  /** Split the narrative into thirds and name the dominant emotion of each stage. */
  private buildEmotionArc(sentences: string[]) {
    if (!sentences.length) {
      return { beginning: 'neutral', middle: 'neutral', end: 'neutral', stages: [] };
    }
    const third = Math.max(1, Math.ceil(sentences.length / 3));
    const stages = [
      { stage: 'beginning', sentences: sentences.slice(0, third) },
      { stage: 'middle', sentences: sentences.slice(third, third * 2) },
      { stage: 'end', sentences: sentences.slice(third * 2) },
    ].map((segment) => {
      const ranked = this.rankEmotions(this.scoreEmotions(segment.sentences.join(' ')));
      return {
        stage: segment.stage,
        emotion: this.label(ranked[0]?.emotion || 'neutral'),
        secondary: ranked.slice(1, 3).map((entry) => this.label(entry.emotion)),
        confidence: Number(Math.min(0.9, 0.5 + (ranked[0]?.score || 0) * 0.1).toFixed(3)),
      };
    });
    return {
      beginning: stages[0].emotion,
      middle: stages[1].emotion,
      end: stages[2].emotion,
      stages,
    };
  }

  private buildStakeholderSentiment(sentences: string[]) {
    return Object.entries(this.stakeholderRoles)
      .map(([role, cues]) => {
        const mentions = sentences.filter((sentence) => {
          const lowered = sentence.toLowerCase();
          return cues.some((cue) => lowered.includes(cue));
        });
        if (!mentions.length) return null;
        const emotionScores = this.scoreEmotions(mentions.join(' '));
        const ranked = this.rankEmotions(emotionScores);
        const sentiment = this.overallSentiment(mentions);
        return {
          id: id('stakeholder'),
          role,
          sentiment: sentiment.label,
          sentimentScore: sentiment.score,
          emotion: this.label(ranked[0]?.emotion || sentiment.label),
          mentions: mentions.length,
          evidence: mentions.slice(0, 3),
          confidence: Number(Math.min(0.92, 0.5 + mentions.length * 0.05).toFixed(3)),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }

  /**
   * Score each catalogued human experience against the content. Any that register
   * are ranked and returned with the gameplay lever used to cultivate them, so the
   * compiler can target the strongest felt experiences when generating gameplay.
   */
  private detectExperiences(sentences: string[]) {
    const text = sentences.join(' ').toLowerCase();
    const max = Math.max(
      1,
      ...HUMAN_EXPERIENCES.map((experience) => this.countHits(text, experience.cues)),
    );
    return HUMAN_EXPERIENCES.map((experience) => ({ experience, score: this.countHits(text, experience.cues) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry) => ({
        id: id('experience'),
        experienceId: entry.experience.id,
        name: entry.experience.name,
        description: entry.experience.description,
        gameplayLever: entry.experience.gameplayLever,
        score: entry.score,
        intensity: Number((entry.score / max).toFixed(3)),
        confidence: Number(Math.min(0.92, 0.5 + entry.score * 0.06).toFixed(3)),
      }));
  }

  private overallSentiment(sentences: string[]) {
    const text = sentences.join(' ').toLowerCase();
    const positive = this.countHits(text, this.positiveWords);
    const negative = this.countHits(text, this.negativeWords);
    const total = positive + negative;
    const score = total ? Number(((positive - negative) / total).toFixed(3)) : 0;
    const label = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'mixed';
    return { label, score, positive, negative };
  }

  private scoreEmotions(text: string): Map<string, number> {
    const lowered = text.toLowerCase();
    const scores = new Map<string, number>();
    Object.entries(this.emotionLexicon).forEach(([emotion, cues]) => {
      const hits = this.countHits(lowered, cues);
      if (hits) scores.set(emotion, hits);
    });
    return scores;
  }

  private rankEmotions(scores: Map<string, number>) {
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([emotion, score]) => ({ emotion, score }));
  }

  private countHits(text: string, cues: string[]): number {
    return cues.reduce((sum, cue) => {
      let count = 0;
      let position = text.indexOf(cue);
      while (position !== -1) {
        count += 1;
        position = text.indexOf(cue, position + cue.length);
      }
      return sum + count;
    }, 0);
  }

  private label(emotion: string): string {
    if (!emotion) return 'Neutral';
    return emotion.charAt(0).toUpperCase() + emotion.slice(1);
  }

  /** Structure-aware segmentation, shared with the other extraction layers. */
  private sentences(text: string): string[] {
    return documentSentences(text);
  }
}
