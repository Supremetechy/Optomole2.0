export type ExperienceOutputTypeId =
  | 'educational-experience'
  | 'business-simulation'
  | 'research-exploration'
  | 'personal-story';

export interface ExperienceOutputType {
  id: ExperienceOutputTypeId;
  title: string;
  inputSignals: string[];
  output: string;
  exampleInput: string;
  exampleOutput: string;
  recommendedArchetype: 'mission-rpg' | 'business-sim' | 'detective' | 'adventure';
  recommendedTemplateFamily: string;
}

export const EXPERIENCE_OUTPUT_TYPES: Record<ExperienceOutputTypeId, ExperienceOutputType> = {
  'educational-experience': {
    id: 'educational-experience',
    title: 'Educational Experience',
    inputSignals: ['textbook', 'chapter', 'course', 'lesson', 'curriculum', 'study guide', 'worksheet', 'student'],
    output: 'Interactive learning adventure',
    exampleInput: 'Textbook chapter',
    exampleOutput: 'Ancient Civilization Explorer',
    recommendedArchetype: 'mission-rpg',
    recommendedTemplateFamily: 'rpg',
  },
  'business-simulation': {
    id: 'business-simulation',
    title: 'Business Simulation',
    inputSignals: ['business assignment', 'mba', 'case study', 'market', 'strategy', 'budget', 'revenue', 'pricing', 'tradeoff', 'stakeholder'],
    output: 'Strategy simulation',
    exampleInput: 'MBA Case Study',
    exampleOutput: 'CEO Decision Simulation',
    recommendedArchetype: 'business-sim',
    recommendedTemplateFamily: 'board-sim',
  },
  'research-exploration': {
    id: 'research-exploration',
    title: 'Research Exploration',
    inputSignals: ['scientific paper', 'research paper', 'abstract', 'methodology', 'hypothesis', 'experiment', 'dataset', 'results', 'citation', 'study'],
    output: 'Discovery simulation',
    exampleInput: 'Research Paper',
    exampleOutput: 'Laboratory Investigation',
    recommendedArchetype: 'detective',
    recommendedTemplateFamily: 'learning-navigation',
  },
  'personal-story': {
    id: 'personal-story',
    title: 'Personal Story',
    inputSignals: ['email', 'journal', 'diary', 'photo', 'life archive', 'memory', 'family', 'personal', 'biography', 'timeline'],
    output: 'Personal documentary experience',
    exampleInput: 'Life Archive',
    exampleOutput: 'Interactive Biography',
    recommendedArchetype: 'adventure',
    recommendedTemplateFamily: 'open-world-action',
  },
};

export function classifyExperienceOutputType(input: { sourceType?: unknown; title?: unknown; text?: unknown; metadata?: unknown }) {
  const haystack = JSON.stringify({
    sourceType: input.sourceType || '',
    title: input.title || '',
    text: input.text || '',
    metadata: input.metadata || {},
  }).toLowerCase();

  const scored = Object.values(EXPERIENCE_OUTPUT_TYPES)
    .map((type) => ({
      type,
      score: type.inputSignals.filter((signal) => haystack.includes(signal)).length,
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  return {
    selected: best.score > 0 ? best.type : EXPERIENCE_OUTPUT_TYPES['educational-experience'],
    confidence: best.score > 0 ? Number(Math.min(0.96, 0.54 + best.score * 0.08).toFixed(2)) : 0.42,
    scores: scored.map((entry) => ({ id: entry.type.id, score: entry.score })),
    catalog: Object.values(EXPERIENCE_OUTPUT_TYPES),
  };
}
