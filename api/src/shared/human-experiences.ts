/**
 * Human Experience Catalog.
 *
 * These are experiential/psychological states that Optomole gameplay can be
 * designed to *evoke* in the user — distinct from ExperienceOutputType (which
 * picks the output *format*: educational, business-sim, research, personal-story).
 *
 * The Emotional Intelligence Engine scores which of these a piece of content
 * already evokes, and the compiler receives the catalog as available design
 * targets for quests, progression, and reward loops.
 *
 * Source: HumanExperiences.md
 */
export interface HumanExperience {
  id: string;
  name: string;
  description: string;
  /** lowercase cues used to detect the experience in sanitized content. */
  cues: string[];
  /** design lever the gameplay uses to cultivate this experience. */
  gameplayLever: string;
}

export const HUMAN_EXPERIENCES: HumanExperience[] = [
  { id: 'momentum', name: 'Momentum', description: 'Small wins that compound into steady progress.', cues: ['momentum', 'small win', 'compound', 'progress', 'streak', 'step by step'], gameplayLever: 'incremental quest rewards' },
  { id: 'consistency', name: 'Consistency', description: 'Showing up reliably, even when it is not perfect.', cues: ['consistency', 'reliable', 'routine', 'habit', 'daily', 'show up'], gameplayLever: 'daily streak loops' },
  { id: 'flow', name: 'Flow', description: 'Deep focus where time fades and effort feels effortless.', cues: ['flow', 'focus', 'immersed', 'effortless', 'in the zone', 'concentration'], gameplayLever: 'difficulty-matched pacing' },
  { id: 'clarity', name: 'Clarity', description: 'Understanding what matters and what to do next.', cues: ['clarity', 'clear', 'understand', 'what to do next', 'priorit', 'direction'], gameplayLever: 'clear objective markers' },
  { id: 'purpose', name: 'Purpose', description: 'A sense that what you do has meaning.', cues: ['purpose', 'meaning', 'mission', 'why it matters', 'significance', 'impact'], gameplayLever: 'narrative stakes' },
  { id: 'belonging', name: 'Belonging', description: 'Feeling accepted and connected to people or a community.', cues: ['belonging', 'community', 'accepted', 'connected', 'team', 'together'], gameplayLever: 'allies and factions' },
  { id: 'curiosity', name: 'Curiosity', description: 'Learning with interest rather than judgment.', cues: ['curiosity', 'curious', 'explore', 'wonder', 'discover', 'question'], gameplayLever: 'hidden lore and reveals' },
  { id: 'mastery', name: 'Mastery', description: 'Improving a skill through practice and feedback.', cues: ['mastery', 'master', 'skill', 'practice', 'feedback', 'improve'], gameplayLever: 'skill trees and levels' },
  { id: 'resilience', name: 'Resilience', description: 'Bouncing back and learning after setbacks.', cues: ['resilience', 'bounce back', 'setback', 'recover', 'persevere', 'try again'], gameplayLever: 'retry-with-progress' },
  { id: 'simplicity', name: 'Simplicity', description: 'Cutting noise so your goals feel clear and doable.', cues: ['simplicity', 'simple', 'cut noise', 'declutter', 'doable', 'minimal'], gameplayLever: 'focused single objectives' },
  { id: 'agency', name: 'Agency', description: 'Feeling you can influence outcomes through your choices.', cues: ['agency', 'choice', 'decide', 'influence', 'control', 'your call'], gameplayLever: 'branching decisions' },
  { id: 'playfulness', name: 'Playfulness', description: 'Lightness that refreshes creativity and motivation.', cues: ['playful', 'fun', 'light', 'creative', 'experiment', 'game'], gameplayLever: 'sandbox and surprise' },
  { id: 'growth', name: 'Growth', description: 'Becoming more capable over time.', cues: ['growth', 'grow', 'develop', 'capable', 'level up', 'evolve'], gameplayLever: 'progression systems' },
  { id: 'courage', name: 'Courage', description: 'Acting despite uncertainty or fear.', cues: ['courage', 'brave', 'despite fear', 'bold', 'risk it', 'face'], gameplayLever: 'high-stakes challenges' },
  { id: 'equanimity', name: 'Equanimity', description: 'Staying steady while emotions come and go.', cues: ['equanimity', 'steady', 'composed', 'calm under', 'balanced mind'], gameplayLever: 'pressure-management beats' },
  { id: 'gratitude', name: 'Gratitude', description: 'Noticing what is good, even in small forms.', cues: ['gratitude', 'grateful', 'thankful', 'appreciate', 'notice what is good'], gameplayLever: 'reflection rewards' },
  { id: 'embodiment', name: 'Embodiment', description: 'Feeling present in your body — breath, movement, sensations.', cues: ['embodiment', 'present in your body', 'breath', 'movement', 'sensation'], gameplayLever: 'sensory feedback' },
  { id: 'calm', name: 'Calm', description: 'Lowering mental noise so you can think and rest well.', cues: ['calm', 'rest', 'relax', 'lower noise', 'peace', 'ease'], gameplayLever: 'low-pressure zones' },
  { id: 'connection', name: 'Connection', description: 'Warm, mutual presence with others.', cues: ['connection', 'mutual', 'presence with others', 'relationship', 'bond'], gameplayLever: 'companion dialog' },
  { id: 'renewal', name: 'Renewal', description: 'Recovering energy through rest, reflection, or change.', cues: ['renewal', 'recover energy', 'reflect', 'refresh', 'reset'], gameplayLever: 'restorative checkpoints' },
  { id: 'intentionality', name: 'Intentionality', description: 'Choosing actions aligned with your values.', cues: ['intentional', 'aligned with values', 'deliberate', 'on purpose', 'values'], gameplayLever: 'values-aligned goals' },
  { id: 'integrity', name: 'Integrity', description: 'Being consistent with your principles and promises.', cues: ['integrity', 'principle', 'promise', 'honest', 'consistent with'], gameplayLever: 'reputation systems' },
  { id: 'optimism', name: 'Optimism', description: 'Expecting better is possible without denying reality.', cues: ['optimism', 'optimistic', 'hopeful', 'better is possible', 'bright'], gameplayLever: 'hopeful arcs' },
  { id: 'self-respect', name: 'Self-respect', description: 'Treating yourself with care, boundaries, and honesty.', cues: ['self-respect', 'boundaries', 'self care', 'treat yourself with care'], gameplayLever: 'healthy-choice rewards' },
  { id: 'balance', name: 'Balance', description: 'Spreading effort across work, health, and relationships.', cues: ['balance', 'work-life', 'spread effort', 'health and relationships', 'equilibrium'], gameplayLever: 'resource-allocation loops' },
];

export const HUMAN_EXPERIENCES_BY_ID: Record<string, HumanExperience> = Object.fromEntries(
  HUMAN_EXPERIENCES.map((experience) => [experience.id, experience]),
);
