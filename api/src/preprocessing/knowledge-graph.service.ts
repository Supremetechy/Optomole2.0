import { Injectable } from '@nestjs/common';
import { id } from '../shared/ids';

export interface KnowledgeGraphInput {
  semanticExtraction: any;
  gameplayNormalization?: any;
  storyboard?: any;
}

@Injectable()
export class KnowledgeGraphService {
  build(input: { semanticExtraction: any; gameplayNormalization: any; storyboard: any }) {
    const semantic = input.semanticExtraction || {};
    const gameplay = input.gameplayNormalization || {};
    const storyboard = input.storyboard || {};
    const graphNodes = [
      ...this.semanticNodes(semantic),
      ...this.gameplayNodes(gameplay),
      ...this.storyboardNodes(storyboard),
    ];
    const graphEdges = [
      ...this.semanticEdges(semantic),
      ...this.gameplayEdges(gameplay),
      ...this.storyboardEdges(storyboard),
      ...this.crossLayerEdges(semantic, gameplay, storyboard),
    ];

    return {
      '@context': {
        sem: 'https://optomole.local/ontology/',
        kg: 'https://optomole.local/knowledge-graph/',
      },
      schemaVersion: '0.1.0',
      kind: 'optimole.knowledgeGraph',
      id: id('kg'),
      generatedAt: new Date().toISOString(),
      '@graph': graphNodes,
      nodes: graphNodes,
      edges: graphEdges,
      validation: this.validate(graphNodes, graphEdges),
      stats: {
        nodeCount: graphNodes.length,
        edgeCount: graphEdges.length,
        semanticNodeCount: graphNodes.filter((node) => node.layer === 'semantic').length,
        gameplayNodeCount: graphNodes.filter((node) => node.layer === 'gameplay').length,
        storyboardNodeCount: graphNodes.filter((node) => node.layer === 'storyboard').length,
      },
    };
  }

  private semanticNodes(semantic: any) {
    return [
      ...(semantic.learningObjectives || []).map((objective: any) => ({
        '@id': `kg:${objective.id}`,
        '@type': 'sem:LearningObjective',
        id: objective.id,
        type: 'learning_objective',
        layer: 'semantic',
        label: objective.goalStatement,
        properties: objective,
      })),
      ...(semantic.concepts || []).map((concept: any) => ({
        '@id': `kg:${concept.id}`,
        '@type': 'sem:Concept',
        id: concept.id,
        type: 'concept',
        layer: 'semantic',
        label: concept.text,
        properties: concept,
      })),
      ...(semantic.entities || []).map((entity: any) => ({
        '@id': `kg:${entity.id}`,
        '@type': `sem:${this.titleCase(entity.type || 'Entity')}`,
        id: entity.id,
        type: String(entity.type || 'entity').toLowerCase(),
        layer: 'semantic',
        label: entity.text,
        properties: entity,
      })),
      ...(semantic.actions || []).map((action: any) => ({
        '@id': `kg:${action.id}`,
        '@type': action.type === 'MISTAKE_OR_RISK' ? 'sem:CommonMistake' : 'sem:Action',
        id: action.id,
        type: action.type === 'MISTAKE_OR_RISK' ? 'common_mistake' : 'action',
        layer: 'semantic',
        label: action.label || action.verb || action.text,
        properties: action,
      })),
      // Impacts are the "why" of the source — the consequences that make a
      // narrative more than a list of topics. `semanticEdges` has always
      // emitted `produces_impact` edges pointing at these ids, but no node was
      // ever created for them: every such edge dangled, the storyboard reported
      // "references unknown node impact_…" thirteen times on a real document,
      // and pathfinding could not route through a single consequence.
      ...(semantic.impacts || []).map((impact: any) => ({
        '@id': `kg:${impact.id}`,
        '@type': 'sem:Impact',
        id: impact.id,
        type: 'impact',
        layer: 'semantic',
        label: impact.label || impact.statement,
        properties: impact,
      })),
    ];
  }

  private gameplayNodes(gameplay: any) {
    return [
      ...(gameplay.gameplayAtoms || []).map((atom: any) => ({
        '@id': `kg:${atom.id}`,
        '@type': 'sem:GameplayElement',
        id: atom.id,
        type: atom.gameplayType,
        layer: 'gameplay',
        label: atom.label,
        properties: atom,
      })),
      ...(gameplay.missions || []).map((mission: any) => ({
        '@id': `kg:${mission.id}`,
        '@type': 'sem:Mission',
        id: mission.id,
        type: 'mission',
        layer: 'gameplay',
        label: mission.title,
        properties: mission,
      })),
      ...(gameplay.npcs || []).map((npc: any) => ({
        '@id': `kg:${npc.id}`,
        '@type': 'sem:NPC',
        id: npc.id,
        type: 'npc',
        layer: 'gameplay',
        label: npc.name,
        properties: npc,
      })),
      ...(gameplay.bosses || []).map((boss: any) => ({
        '@id': `kg:${boss.id}`,
        '@type': 'sem:BossBattle',
        id: boss.id,
        type: 'boss_battle',
        layer: 'gameplay',
        label: boss.name,
        properties: boss,
      })),
    ];
  }

  private storyboardNodes(storyboard: any) {
    return [
      ...(storyboard.narrativePaths || []).map((path: any) => ({
        '@id': `kg:${path.id}`,
        '@type': 'sem:NarrativePath',
        id: path.id,
        type: 'narrative_path',
        layer: 'storyboard',
        label: path.label,
        properties: path,
      })),
      ...(storyboard.scenes || []).map((scene: any) => ({
        '@id': `kg:${scene.id}`,
        '@type': 'sem:Scene',
        id: scene.id,
        type: scene.sceneType,
        layer: 'storyboard',
        label: scene.title,
        properties: scene,
      })),
    ];
  }

  private semanticEdges(semantic: any) {
    return [
      ...(semantic.relationships || []).map((relationship: any) => this.edge(relationship.from, relationship.to, relationship.relation || relationship.type, 'semantic', relationship.confidence, relationship)),
      ...(semantic.dependencies || []).map((dependency: any) => this.edge(dependency.from, dependency.to, dependency.relation || 'requires', 'dependency', dependency.confidence, dependency)),
      ...(semantic.chronology || []).filter((entry: any) => entry.before).map((entry: any) => this.edge(entry.actionId, entry.before, 'precedes', 'chronology', 0.7, entry)),
    ];
  }

  private gameplayEdges(gameplay: any) {
    return [
      ...(gameplay.gameplayAtoms || []).filter((atom: any) => atom.sourceId).map((atom: any) => this.edge(atom.sourceId, atom.id, 'normalizes_to', 'semantic_to_gameplay', atom.salience || 0.6, atom)),
      ...(gameplay.missions || []).flatMap((mission: any) => (mission.gameplayAtomIds || []).map((atomId: string) => this.edge(mission.id, atomId, 'contains_gameplay_atom', 'gameplay', 0.8, mission))),
      ...(gameplay.npcs || []).filter((npc: any) => npc.missionId).map((npc: any) => this.edge(npc.id, npc.missionId, 'guides', 'gameplay', 0.65, npc)),
      ...(gameplay.bosses || []).filter((boss: any) => boss.sourceActionId).map((boss: any) => this.edge(boss.sourceActionId, boss.id, 'becomes_conflict', 'semantic_to_gameplay', 0.76, boss)),
    ];
  }

  private storyboardEdges(storyboard: any) {
    return [
      ...(storyboard.scenes || []).flatMap((scene: any) => (scene.gameplayAtomIds || []).map((atomId: string) => this.edge(scene.id, atomId, 'covers', 'storyboard', 0.72, scene))),
      ...(storyboard.transitions || []).map((transition: any) => this.edge(transition.from, transition.to, 'transitions_to', 'storyboard', 0.8, transition)),
      ...(storyboard.narrativePaths || []).flatMap((path: any) => (path.nodeIds || []).map((nodeId: string) => this.edge(path.id, nodeId, 'traverses', 'storyboard', 0.68, path))),
    ];
  }

  private crossLayerEdges(semantic: any, gameplay: any, storyboard: any) {
    const edges: any[] = [];
    const firstObjective = semantic.learningObjectives?.[0];
    const firstMission = gameplay.missions?.[0];
    const selectedPath = storyboard.selectedPath;
    if (firstObjective && firstMission) edges.push(this.edge(firstObjective.id, firstMission.id, 'becomes_mission', 'cross_layer', 0.84));
    if (firstMission && selectedPath) edges.push(this.edge(firstMission.id, selectedPath.id, 'anchors_story_path', 'cross_layer', 0.78));
    return edges;
  }

  private edge(from: string, to: string, relation: string, layer: string, confidence = 0.6, properties: Record<string, unknown> = {}) {
    return {
      id: id('edge'),
      from,
      to,
      relation,
      layer,
      confidence,
      properties,
    };
  }

  private validate(nodes: any[], edges: any[]) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const orphanedNodes = nodes.filter((node) => !edges.some((edge) => edge.from === node.id || edge.to === node.id)).map((node) => node.id);
    const danglingEdges = edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to)).map((edge) => edge.id);
    const reciprocal = new Set(edges.map((edge) => `${edge.from}->${edge.to}:${edge.relation}`));
    const contradictions = edges
      .filter((edge) => edge.relation === 'precedes' && reciprocal.has(`${edge.to}->${edge.from}:precedes`))
      .map((edge) => ({ from: edge.from, to: edge.to, issue: 'reciprocal_precedence' }));
    return {
      valid: danglingEdges.length === 0 && contradictions.length === 0,
      orphanedNodes,
      danglingEdges,
      contradictions,
      lowConfidenceEdges: edges.filter((edge) => edge.confidence < 0.55).map((edge) => edge.id),
    };
  }

  private titleCase(value: string) {
    return value.toLowerCase().replace(/(^|_|\s)\w/g, (match) => match.toUpperCase().replace('_', ''));
  }
}
