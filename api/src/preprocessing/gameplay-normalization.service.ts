import { Injectable } from '@nestjs/common';
import { id } from '../shared/ids';

@Injectable()
export class GameplayNormalizationService {
  normalize(input: { semanticExtraction: any; preferredGenre?: unknown; target?: unknown }) {
    const semantic = input.semanticExtraction || {};
    const concepts = Array.isArray(semantic.concepts) ? semantic.concepts : [];
    const actions = Array.isArray(semantic.actions) ? semantic.actions : [];
    const objectives = Array.isArray(semantic.learningObjectives) ? semantic.learningObjectives : [];
    const hazards = actions.filter((action: any) => action.type === 'MISTAKE_OR_RISK' || /\b(risk|avoid|warning|mistake|threat|fail)\b/i.test(action.text));
    const cleanActions = actions.filter((action: any) => !hazards.includes(action));

    const gameplayAtoms = [
      ...concepts.slice(0, 10).map((concept: any, index: number) => this.atom('concept', concept, index)),
      ...cleanActions.slice(0, 10).map((action: any, index: number) => this.atom('action', action, index)),
      ...hazards.slice(0, 8).map((hazard: any, index: number) => this.atom('hazard', hazard, index)),
    ];

    const missions = objectives.length
      ? objectives.map((objective: any, index: number) => this.missionFromObjective(objective, gameplayAtoms, index))
      : [this.missionFromObjective({ goalStatement: semantic.title || 'Master the source content' }, gameplayAtoms, 0)];

    const npcs = this.buildNpcs(semantic, missions);
    const dialogue = npcs.map((npc: any, index: number) => ({
      id: id('dialogue'),
      npcId: npc.id,
      prompt: index === 0 ? 'Brief the player on the knowledge goal.' : 'Offer a hint tied to source evidence.',
      lines: [
        `${npc.name}: ${npc.role} online.`,
        missions[index]?.summary || missions[0]?.summary || 'Follow the evidence and resolve the mission.',
      ],
    }));

    return {
      schemaVersion: '0.1.0',
      kind: 'optimole.gameplayNormalization',
      id: id('gameplay'),
      generatedAt: new Date().toISOString(),
      preferredGenre: input.preferredGenre || 'action-adventure-key-lock.v1',
      target: input.target || 'browser',
      gameplayAtoms,
      missions,
      puzzles: gameplayAtoms.filter((atom) => atom.gameplayType === 'puzzle'),
      quizzes: gameplayAtoms.filter((atom) => atom.gameplayType === 'quiz'),
      simulations: gameplayAtoms.filter((atom) => atom.gameplayType === 'simulation'),
      branches: gameplayAtoms.filter((atom) => atom.gameplayType === 'branch'),
      challenges: gameplayAtoms.filter((atom) => atom.gameplayType === 'challenge'),
      inventoryItems: gameplayAtoms.filter((atom) => atom.gameplayType === 'inventory_item'),
      bosses: hazards.slice(0, 3).map((hazard: any, index: number) => ({
        id: id('boss'),
        name: this.titleCase(hazard.verb || 'Knowledge Hazard'),
        sourceActionId: hazard.id,
        challenge: hazard.text,
        defeatCondition: 'Select the corrective evidence or action.',
        xp: 150 + index * 25,
      })),
      npcs,
      npcDialogue: dialogue,
      mappingRules: {
        concept: ['quiz', 'inventory_item', 'puzzle'],
        action: ['mission', 'simulation', 'challenge'],
        hazard: ['boss_battle', 'avoidance_challenge', 'branch'],
      },
    };
  }

  private atom(kind: 'concept' | 'action' | 'hazard', item: any, index: number) {
    const gameplayType = kind === 'concept'
      ? (index % 2 === 0 ? 'quiz' : 'inventory_item')
      : kind === 'hazard'
        ? (index % 2 === 0 ? 'challenge' : 'branch')
        : (index % 2 === 0 ? 'mission' : 'simulation');
    return {
      id: id('atom'),
      sourceId: item.id,
      sourceKind: kind,
      label: item.text || item.goalStatement || `${kind} ${index + 1}`,
      gameplayType,
      interactionType: this.interactionFor(gameplayType),
      salience: item.salience || item.confidence || 0.6,
      successCondition: kind === 'hazard' ? 'avoid or correct the misconception' : 'demonstrate recall with source evidence',
      reward: {
        xp: kind === 'hazard' ? 125 : kind === 'action' ? 100 : 75,
        item: kind === 'concept' ? `${this.titleCase(String(item.text || 'Concept')).slice(0, 32)} Token` : undefined,
      },
    };
  }

  private missionFromObjective(objective: any, atoms: any[], index: number) {
    const missionAtoms = atoms.slice(index, index + 5);
    return {
      id: id('mission'),
      title: objective.goalStatement || objective.label || `Mission ${index + 1}`,
      summary: objective.successMetric || 'Complete the source-backed gameplay objective.',
      objectiveId: objective.id || null,
      gameplayAtomIds: missionAtoms.map((atom) => atom.id),
      objectives: missionAtoms.map((atom) => ({
        id: id('objective'),
        title: atom.label,
        prompt: atom.successCondition,
        gameplayType: atom.gameplayType,
      })),
      reward: {
        xp: 150 + missionAtoms.length * 25,
      },
    };
  }

  private buildNpcs(semantic: any, missions: any[]) {
    const people = Array.isArray(semantic.people) ? semantic.people : [];
    const fallback = people.length ? people : [{ text: 'Optomole Guide', type: 'PERSON' }];
    return fallback.slice(0, 4).map((person: any, index: number) => ({
      id: id('npc'),
      name: person.text || `Guide ${index + 1}`,
      role: index === 0 ? 'Knowledge Mentor' : 'Evidence Specialist',
      sourceEntityId: person.id || null,
      missionId: missions[index]?.id || missions[0]?.id || null,
      trust: 50,
    }));
  }

  private interactionFor(gameplayType: string) {
    return {
      puzzle: 'solve',
      quiz: 'answer',
      dialogue: 'talk',
      simulation: 'simulate',
      branch: 'choose',
      mission: 'complete',
      inventory_item: 'collect',
      challenge: 'resolve',
    }[gameplayType] || 'inspect';
  }

  private titleCase(value: string) {
    return value.replace(/[_-]+/g, ' ').replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  }
}
