import { Injectable } from '@nestjs/common';
import { id } from '../shared/ids';

export interface StoryboardInput {
  /** Output of KnowledgeGraphService.build() */
  knowledgeGraph: any;
  /** Output of SemanticExtractionService.extract() - used for rhetorical enrichment (quotes/examples/anecdotes) */
  semanticExtraction?: any;
  /** Output of EmotionalIntelligenceService.extract() - emotion arc + stakeholder sentiment for scene beats */
  emotionalIntelligence?: any;
  /** Explicit goal node id. If omitted, the highest-salience LearningObjective node is used. */
  goalNodeId?: string;
  /** Free-text audience profile, carried through to the output for the rendering stage. */
  audience?: string;
  maxHops?: number;
  maxConflictPaths?: number;
  maxBranches?: number;
}

interface GraphNode {
  id: string;
  type: string;
  layer: string;
  label: string;
  properties: any;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  layer: string;
  confidence: number;
}

/**
 * Implements the Storyboard Engine pipeline from the algorithm doc
 * (docs/Storyboard_Engine.md):
 *   Phase 1: Narrative Pathfinding (anchor nodes -> dependency DAG -> path discovery -> scoring/ranking -> selection)
 *   Phase 2: Scene Construction (decomposition, rhetorical assembly, tension mapping, transitions)
 *   Phase 3: Narrative Rendering (structured scene payloads; actual prose generation is left to the
 *            consuming LLM - see OptomoleSkills.md - since that step needs a language model, not this
 *            deterministic graph-traversal engine).
 *
 * Consumes the knowledge graph produced by KnowledgeGraphService.build() (nodes/edges), so the
 * pipeline builds a base graph BEFORE the storyboard and then re-runs the graph builder with the
 * completed storyboard folded back in.
 *
 * Output shape stays compatible with KnowledgeGraphService.storyboardNodes/storyboardEdges
 * (narrativePaths, scenes, transitions, selectedPath) and with the legacy `coverage` block consumed
 * by BuildsService metadata.
 */
@Injectable()
export class StoryboardService {
  build(input: StoryboardInput) {
    const nodes: GraphNode[] = input.knowledgeGraph?.nodes || [];
    const edges: GraphEdge[] = input.knowledgeGraph?.edges || [];
    const semantic = input.semanticExtraction || {};
    const maxHops = input.maxHops ?? 3;
    const maxConflictPaths = input.maxConflictPaths ?? 3;
    const maxBranches = input.maxBranches ?? 3;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const adjacency = this.buildUndirectedAdjacency(nodes, edges);

    const goal = this.selectGoalNode(nodes, adjacency, input.goalNodeId);
    if (!goal) {
      return this.empty(input, 'No goal node (LearningObjective) found in knowledge graph.');
    }

    // Phase 1 -----------------------------------------------------------
    const anchorNodes = this.identifyAnchorNodes(goal, nodeById, adjacency, maxHops);
    const dependencyEdges = this.dependencyEdges(edges);
    const dag = this.buildDependencyDag(nodes, dependencyEdges);

    const rawPaths = anchorNodes
      .map((anchor) => this.shortestPath(anchor.id, goal.id, adjacency))
      .filter((path): path is string[] => !!path && path.length > 1);

    const enrichedPaths = this.dedupePaths(rawPaths).map((path) =>
      this.enrichPath(path, nodeById, edges, semantic),
    );

    const scoredPaths = enrichedPaths
      .map((path) => this.scorePath(path, nodeById, edges))
      .sort((a, b) => b.score - a.score);

    const conflictPaths = this.findConflictPaths(nodeById, adjacency, goal, maxConflictPaths);
    const characterPaths = this.characterPaths(nodeById, edges, semantic);

    const primary = scoredPaths[0] ?? null;
    const secondary = scoredPaths.slice(1);
    const woven = primary ? this.weavePaths(primary, secondary, adjacency, maxBranches) : null;

    // Phase 2 -------------------------------------------------------------
    const scenes = woven ? this.decomposeToScenes(woven, nodeById, edges, semantic) : [];
    const transitions = this.buildTransitions(scenes);

    const narrativePaths = [
      ...(primary ? [this.toNarrativePathRecord(primary, 'primary')] : []),
      ...secondary.map((path) => this.toNarrativePathRecord(path, 'secondary')),
      ...conflictPaths.map((path) => this.toNarrativePathRecord(path, 'conflict')),
      ...characterPaths.map((path) => this.toNarrativePathRecord(path, 'character')),
    ];

    const selectedPath = primary
      ? { id: id('path'), label: 'Selected Narrative Trajectory', nodeIds: woven?.nodeIds ?? primary.nodeIds, score: primary.score }
      : null;

    return {
      schemaVersion: '0.1.0',
      kind: 'optimole.storyboard',
      id: id('story'),
      generatedAt: new Date().toISOString(),
      goalNodeId: goal.id,
      audience: input.audience || null,
      anchorNodes: anchorNodes.map((anchor) => ({ id: anchor.id, hops: anchor.hops, weight: anchor.weight })),
      dependencyDag: dag,
      narrativePaths,
      selectedPath,
      scenes,
      transitions,
      validation: this.validate(narrativePaths, scenes, nodeById),
      coverage: this.coverage(scenes, narrativePaths),
      stats: {
        anchorNodeCount: anchorNodes.length,
        pathCount: narrativePaths.length,
        sceneCount: scenes.length,
        conflictPathCount: conflictPaths.length,
        characterPathCount: characterPaths.length,
      },
    };
  }

  private empty(input: StoryboardInput, reason: string) {
    return {
      schemaVersion: '0.1.0',
      kind: 'optimole.storyboard',
      id: id('story'),
      generatedAt: new Date().toISOString(),
      goalNodeId: null,
      audience: input.audience || null,
      anchorNodes: [],
      dependencyDag: { order: [], cycles: [] },
      narrativePaths: [],
      selectedPath: null,
      scenes: [],
      transitions: [],
      validation: { valid: false, issues: [reason] },
      coverage: { sceneCount: 0, pathCount: 0, coveredGameplayAtoms: [] as string[] },
      stats: { anchorNodeCount: 0, pathCount: 0, sceneCount: 0, conflictPathCount: 0, characterPathCount: 0 },
    };
  }

  // ---- Phase 1: Narrative Pathfinding -----------------------------------

  private selectGoalNode(
    nodes: GraphNode[],
    adjacency: Map<string, Array<{ to: string; edge: GraphEdge }>>,
    goalNodeId?: string,
  ): GraphNode | null {
    if (goalNodeId) return nodes.find((node) => node.id === goalNodeId) ?? null;
    const connected = (node: GraphNode) => (adjacency.get(node.id)?.length ?? 0) > 0;
    const objectives = nodes.filter((node) => node.type === 'learning_objective' && connected(node));
    if (objectives.length) {
      return [...objectives].sort((a, b) => this.salience(b) - this.salience(a))[0];
    }
    const connectedPool = nodes.filter(connected);
    const pool = connectedPool.length ? connectedPool : nodes;
    if (!pool.length) return null;
    return [...pool].sort((a, b) => this.salience(b) - this.salience(a))[0];
  }

  private buildUndirectedAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Array<{ to: string; edge: GraphEdge }>> {
    const adjacency = new Map<string, Array<{ to: string; edge: GraphEdge }>>();
    nodes.forEach((node) => adjacency.set(node.id, []));
    edges.forEach((edge) => {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from)!.push({ to: edge.to, edge });
      adjacency.get(edge.to)!.push({ to: edge.from, edge });
    });

    // KnowledgeGraphService (upstream, unchanged) doesn't emit edges from
    // LearningObjective nodes to their relatedConceptIds/requiredActionIds,
    // which leaves goal nodes orphaned (see the graph's own validation.orphanedNodes).
    // Synthesize those connections here, locally, purely so the storyboard engine
    // has something to anchor and pathfind from - this does not mutate the
    // knowledge graph itself.
    nodes
      .filter((node) => node.type === 'learning_objective')
      .forEach((node) => {
        const relatedIds: string[] = [
          ...(node.properties?.relatedConceptIds || []),
          ...(node.properties?.requiredActionIds || []),
        ];
        relatedIds.forEach((targetId) => {
          if (!adjacency.has(targetId)) return;
          const syntheticEdge: GraphEdge = {
            id: id('synthetic-edge'),
            from: node.id,
            to: targetId,
            relation: 'relates_to_objective',
            layer: 'synthetic',
            confidence: 0.5,
          };
          adjacency.get(node.id)!.push({ to: targetId, edge: syntheticEdge });
          adjacency.get(targetId)!.push({ to: node.id, edge: syntheticEdge });
        });
      });

    return adjacency;
  }

  private identifyAnchorNodes(
    goal: GraphNode,
    nodeById: Map<string, GraphNode>,
    adjacency: Map<string, Array<{ to: string; edge: GraphEdge }>>,
    maxHops: number,
  ) {
    const hops = new Map<string, number>([[goal.id, 0]]);
    const queue: string[] = [goal.id];
    while (queue.length) {
      const current = queue.shift()!;
      const currentHops = hops.get(current)!;
      if (currentHops >= maxHops) continue;
      for (const neighbor of adjacency.get(current) || []) {
        if (!hops.has(neighbor.to)) {
          hops.set(neighbor.to, currentHops + 1);
          queue.push(neighbor.to);
        }
      }
    }
    return [...hops.entries()]
      .filter(([nodeId]) => nodeId !== goal.id)
      .map(([nodeId, hopCount]) => {
        const node = nodeById.get(nodeId);
        const weight = (node ? this.salience(node) : 0) + 1 / (hopCount + 1);
        return { id: nodeId, hops: hopCount, weight };
      })
      .sort((a, b) => b.weight - a.weight);
  }

  private dependencyEdges(edges: GraphEdge[]): GraphEdge[] {
    const dependencyRelations = new Set(['requires', 'follows', 'precedes', 'depends_on']);
    return edges.filter((edge) => edge.layer === 'dependency' || edge.layer === 'chronology' || dependencyRelations.has(edge.relation));
  }

  private buildDependencyDag(nodes: GraphNode[], dependencyEdges: GraphEdge[]) {
    let edges = [...dependencyEdges];
    const cycles: string[][] = [];

    const findCycle = (): GraphEdge[] | null => {
      const graph = new Map<string, GraphEdge[]>();
      edges.forEach((edge) => {
        if (!graph.has(edge.from)) graph.set(edge.from, []);
        graph.get(edge.from)!.push(edge);
      });
      const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited,1=in progress,2=done
      const stack: string[] = [];
      let found: GraphEdge[] | null = null;

      const visit = (nodeId: string) => {
        if (found) return;
        state.set(nodeId, 1);
        stack.push(nodeId);
        for (const edge of graph.get(nodeId) || []) {
          if (found) return;
          const next = edge.to;
          if (state.get(next) === 1) {
            const cycleStart = stack.indexOf(next);
            cycles.push(stack.slice(cycleStart));
            found = (graph.get(nodeId) || []).filter((candidate) => candidate.to === next);
            return;
          }
          if (!state.get(next)) visit(next);
        }
        stack.pop();
        state.set(nodeId, 2);
      };

      for (const node of nodes) {
        if (found) break;
        if (!state.get(node.id)) visit(node.id);
      }
      return found;
    };

    // Break cycles by dropping the weakest (lowest-confidence) edge involved, up to a safety bound.
    for (let guard = 0; guard < 50; guard += 1) {
      const cycleEdges = findCycle();
      if (!cycleEdges || !cycleEdges.length) break;
      const weakest = [...cycleEdges].sort((a, b) => a.confidence - b.confidence)[0];
      edges = edges.filter((edge) => edge.id !== weakest.id);
    }

    const order = this.topologicalSort(nodes, edges);
    return { order, cycles, edgeCount: edges.length };
  }

  private topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): string[] {
    const inDegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
    const outgoing = new Map<string, string[]>();
    edges.forEach((edge) => {
      if (!inDegree.has(edge.to)) inDegree.set(edge.to, 0);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from)!.push(edge.to);
    });
    const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([nodeId]) => nodeId);
    const order: string[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      order.push(current);
      for (const next of outgoing.get(current) || []) {
        inDegree.set(next, (inDegree.get(next) || 0) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }
    return order;
  }

  private shortestPath(fromId: string, toId: string, adjacency: Map<string, Array<{ to: string; edge: GraphEdge }>>): string[] | null {
    if (fromId === toId) return [fromId];
    const visited = new Set([fromId]);
    const queue: string[][] = [[fromId]];
    while (queue.length) {
      const path = queue.shift()!;
      const last = path[path.length - 1];
      for (const neighbor of adjacency.get(last) || []) {
        if (visited.has(neighbor.to)) continue;
        const nextPath = [...path, neighbor.to];
        if (neighbor.to === toId) return nextPath;
        visited.add(neighbor.to);
        queue.push(nextPath);
      }
    }
    return null;
  }

  private dedupePaths(paths: string[][]): string[][] {
    const seen = new Set<string>();
    return paths.filter((path) => {
      const key = path.join('>');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private enrichPath(path: string[], nodeById: Map<string, GraphNode>, edges: GraphEdge[], semantic: any) {
    const rhetoric = path.map((nodeId) => this.rhetoricForNode(nodeId, nodeById, semantic));
    return { nodeIds: path, rhetoric };
  }

  private rhetoricForNode(nodeId: string, nodeById: Map<string, GraphNode>, semantic: any) {
    const node = nodeById.get(nodeId);
    const sourceId = node?.properties?.sourceId;
    const within = (list: any[] = []) => (sourceId ? list.filter((entry) => entry.sourceId === sourceId) : []);
    return {
      nodeId,
      examples: within(semantic.examples).slice(0, 2),
      anecdotes: within(semantic.anecdotes).slice(0, 2),
      quotes: within(semantic.importantQuotes).slice(0, 2),
    };
  }

  private scorePath(path: { nodeIds: string[]; rhetoric: any[] }, nodeById: Map<string, GraphNode>, edges: GraphEdge[]) {
    const alpha = 0.4; // rhetorical richness weight
    const beta = 0.3; // conflict density weight
    const gamma = 0.3; // dependency completeness weight

    const nodeSalience = path.nodeIds.reduce((sum, nodeId) => {
      const node = nodeById.get(nodeId);
      return sum + (node ? this.salience(node) : 0);
    }, 0);

    const pathEdges = this.edgesAlongPath(path.nodeIds, edges);
    const edgeStrength = pathEdges.reduce((sum, edge) => sum + edge.confidence, 0);

    const rhetoricalRichness = path.rhetoric.reduce(
      (sum, entry) => sum + entry.examples.length + entry.anecdotes.length + entry.quotes.length,
      0,
    );

    const mistakes = path.nodeIds.filter((nodeId) => nodeById.get(nodeId)?.type === 'common_mistake').length;
    const conflictDensity = mistakes;

    const dependencyEdgeCount = pathEdges.filter((edge) => edge.layer === 'dependency').length;
    const dependencyCompleteness = path.nodeIds.length ? dependencyEdgeCount / path.nodeIds.length : 0;

    const score = nodeSalience + edgeStrength + rhetoricalRichness * alpha + conflictDensity * beta + dependencyCompleteness * gamma;

    return { ...path, score: Number(score.toFixed(3)) };
  }

  private edgesAlongPath(nodeIds: string[], edges: GraphEdge[]): GraphEdge[] {
    const pairs = new Set<string>();
    for (let i = 0; i < nodeIds.length - 1; i += 1) {
      pairs.add(`${nodeIds[i]}|${nodeIds[i + 1]}`);
      pairs.add(`${nodeIds[i + 1]}|${nodeIds[i]}`);
    }
    return edges.filter((edge) => pairs.has(`${edge.from}|${edge.to}`));
  }

  private findConflictPaths(
    nodeById: Map<string, GraphNode>,
    adjacency: Map<string, Array<{ to: string; edge: GraphEdge }>>,
    goal: GraphNode,
    k: number,
  ) {
    const mistakeNodes = [...nodeById.values()].filter((node) => node.type === 'common_mistake');
    const storyStart = this.pickStoryStart(nodeById);

    const candidates: Array<{ nodeIds: string[]; rhetoric: any[]; score: number; mistakeNodeId: string }> = [];
    for (const mistake of mistakeNodes) {
      const fallArc = storyStart ? this.shortestPath(storyStart.id, mistake.id, adjacency) : null;
      const redemptionArc = this.shortestPath(mistake.id, goal.id, adjacency);
      if (!redemptionArc) continue;
      const nodeIds = [...(fallArc?.slice(0, -1) ?? []), ...redemptionArc];
      const conflictScore = this.conflictScore(nodeIds, nodeById, goal);
      candidates.push({ nodeIds, rhetoric: [], score: conflictScore, mistakeNodeId: mistake.id });
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, k);
  }

  private conflictScore(nodeIds: string[], nodeById: Map<string, GraphNode>, goal: GraphNode): number {
    const mistakes = nodeIds.filter((nodeId) => nodeById.get(nodeId)?.type === 'common_mistake').length;
    const obstacles = 0; // requires validation.danglingEdges context, not available at this scope - conservative default
    const stakes = this.salience(goal);
    return Number((mistakes * 2 + obstacles + stakes * 1.5).toFixed(3));
  }

  private pickStoryStart(nodeById: Map<string, GraphNode>): GraphNode | null {
    const actions = [...nodeById.values()].filter((node) => node.type === 'action');
    if (!actions.length) return null;
    return actions.sort((a, b) => (a.properties?.order ?? 0) - (b.properties?.order ?? 0))[0];
  }

  private characterPaths(nodeById: Map<string, GraphNode>, edges: GraphEdge[], semantic: any) {
    const actions = [...nodeById.values()]
      .filter((node) => node.type === 'action')
      .sort((a, b) => (a.properties?.order ?? 0) - (b.properties?.order ?? 0));
    if (!actions.length) return [];

    const beats = this.bucketize(actions, 5); // Setup, Inciting Incident, Rising Action, Climax, Resolution
    const beatLabels = ['Setup', 'Inciting Incident', 'Rising Action', 'Climax', 'Resolution'];
    const nodeIds = beats.flatMap((bucket) => bucket.map((node) => node.id));
    const rhetoric = nodeIds.map((nodeId) => this.rhetoricForNode(nodeId, nodeById, semantic));

    return [
      {
        nodeIds,
        rhetoric,
        score: nodeIds.reduce((sum, nodeId) => sum + this.salience(nodeById.get(nodeId)!), 0),
        beats: beats.map((bucket, index) => ({ label: beatLabels[index], nodeIds: bucket.map((node) => node.id) })),
      },
    ];
  }

  private bucketize<T>(items: T[], bucketCount: number): T[][] {
    const buckets: T[][] = Array.from({ length: bucketCount }, () => []);
    items.forEach((item, index) => {
      const bucketIndex = Math.min(bucketCount - 1, Math.floor((index / items.length) * bucketCount));
      buckets[bucketIndex].push(item);
    });
    return buckets;
  }

  private weavePaths(
    primary: { nodeIds: string[]; rhetoric: any[]; score: number },
    secondary: Array<{ nodeIds: string[]; rhetoric: any[]; score: number }>,
    adjacency: Map<string, Array<{ to: string; edge: GraphEdge }>>,
    maxBranches: number,
  ) {
    const degree = (nodeId: string) => (adjacency.get(nodeId) || []).length;
    const branchPoints = [...primary.nodeIds]
      .filter((nodeId) => degree(nodeId) > 1)
      .sort((a, b) => degree(b) - degree(a))
      .slice(0, maxBranches);

    const branches: Array<{ atNodeId: string; secondaryNodeIds: string[] }> = [];
    for (const branchPoint of branchPoints) {
      const match = secondary.find((path) => path.nodeIds.includes(branchPoint));
      if (match) branches.push({ atNodeId: branchPoint, secondaryNodeIds: match.nodeIds });
      if (branches.length >= maxBranches) break;
    }

    // Insert branch node sequences immediately after their attach point, deduped.
    const nodeIds: string[] = [];
    for (const nodeId of primary.nodeIds) {
      nodeIds.push(nodeId);
      const branch = branches.find((entry) => entry.atNodeId === nodeId);
      if (branch) {
        branch.secondaryNodeIds.filter((branchNodeId) => !nodeIds.includes(branchNodeId)).forEach((branchNodeId) => nodeIds.push(branchNodeId));
      }
    }

    return { nodeIds: [...new Set(nodeIds)], branches, primaryRhetoric: primary.rhetoric };
  }

  // ---- Phase 2: Scene Construction --------------------------------------

  private decomposeToScenes(
    woven: { nodeIds: string[]; branches: Array<{ atNodeId: string; secondaryNodeIds: string[] }> },
    nodeById: Map<string, GraphNode>,
    edges: GraphEdge[],
    semantic: any,
  ) {
    const segmentSize = 5; // within the 3-7 node range from the algorithm doc
    const segments: string[][] = [];
    for (let i = 0; i < woven.nodeIds.length; i += segmentSize) {
      segments.push(woven.nodeIds.slice(i, i + segmentSize));
    }

    return segments.map((segment, index) => {
      const nodesInScene = segment.map((nodeId) => nodeById.get(nodeId)).filter(Boolean) as GraphNode[];
      const sceneType = this.inferSceneType(nodesInScene, index, segments.length);
      const rhetoric = segment.map((nodeId) => this.rhetoricForNode(nodeId, nodeById, semantic));
      const isBranch = segment.some((nodeId) => woven.branches.some((branch) => branch.secondaryNodeIds.includes(nodeId)));
      // Gameplay-layer nodes that land in this scene are the atoms it "covers" -
      // this keeps KnowledgeGraphService's scene->atom `covers` edges and the
      // legacy coverage.coveredGameplayAtoms populated.
      const gameplayAtomIds = nodesInScene.filter((node) => node.layer === 'gameplay').map((node) => node.id);

      return {
        id: id('scene'),
        order: index,
        title: nodesInScene[0]?.label || `Scene ${index + 1}`,
        sceneType,
        nodeIds: segment,
        gameplayAtomIds,
        tension: this.tensionForScene(nodesInScene),
        isSidebar: isBranch,
        rhetoric,
      };
    });
  }

  private inferSceneType(nodes: GraphNode[], index: number, total: number): string {
    if (index === 0) return 'briefing';
    if (index === total - 1) return 'resolution';
    if (nodes.some((node) => node.type === 'common_mistake')) return 'conflict';
    if (nodes.some((node) => node.type === 'action')) return 'challenge';
    return 'exploration';
  }

  private tensionForScene(nodes: GraphNode[]): 'rising' | 'peak' | 'falling' | 'neutral' {
    const mistakeCount = nodes.filter((node) => node.type === 'common_mistake').length;
    if (mistakeCount > 1) return 'peak';
    if (mistakeCount === 1) return 'rising';
    return 'neutral';
  }

  private buildTransitions(scenes: Array<{ id: string; order: number }>) {
    const transitions: Array<{ from: string; to: string; style: string }> = [];
    for (let i = 0; i < scenes.length - 1; i += 1) {
      transitions.push({ from: scenes[i].id, to: scenes[i + 1].id, style: 'cut' });
    }
    return transitions;
  }

  // ---- shared helpers -----------------------------------------------------

  private toNarrativePathRecord(path: { nodeIds: string[]; score: number }, kind: string) {
    return {
      id: id('path'),
      kind,
      label: `${this.titleCase(kind)} path (${path.nodeIds.length} nodes)`,
      nodeIds: path.nodeIds,
      score: path.score,
    };
  }

  private validate(narrativePaths: any[], scenes: any[], nodeById: Map<string, GraphNode>) {
    const issues: string[] = [];
    narrativePaths.forEach((path) => {
      path.nodeIds.forEach((nodeId: string) => {
        if (!nodeById.has(nodeId)) issues.push(`Path ${path.id} references unknown node ${nodeId}`);
      });
    });
    if (!scenes.length) issues.push('No scenes were generated - check that the knowledge graph has a reachable goal node.');
    return { valid: issues.length === 0, issues };
  }

  private coverage(scenes: Array<{ gameplayAtomIds?: string[] }>, narrativePaths: any[]) {
    return {
      sceneCount: scenes.length,
      pathCount: narrativePaths.length,
      coveredGameplayAtoms: [...new Set(scenes.flatMap((scene) => scene.gameplayAtomIds || []))],
    };
  }

  private salience(node: GraphNode): number {
    const props = node.properties || {};
    return Number(props.salience ?? props.confidence ?? 0.5);
  }

  private titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
