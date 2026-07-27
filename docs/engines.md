> **STATUS: PROPOSAL — NOT IMPLEMENTED. Do not treat this as a description of
> the codebase.** Audited 2026-07-26 against `api/src/` and `Phaser/`.
>
> None of this file's *infrastructure* exists: there is no `GeneratorAgent`, no
> `WorldContext` in this sense (`browser-engine/engines/WorldContext.js` is an
> unrelated manifest projection), no `runLLMAgent` repair loop, no
> `HybridAgentSpec`, no `platformBudget`, and no optimization checkpoint. Every
> symbol defined below returns zero matches in the codebase.
>
> What *does* exist is the five-stage content compiler
> (see [gameplaycompiler.md](gameplaycompiler.md)), which covers some of the same
> ground by a different route — deterministic derivation from content semantics
> rather than nine LLM-backed agents over a shared registry:
>
> | # | Agent | Status today |
> |---|---|---|
> | 1 | Scene | **partial** — one scene per region, linear chain. No anchors, no connection graph, no branching |
> | 2 | NPC | **partial** — cast becomes NPC entities; hostiles get combat directives + squads. No anchors, no vendor/quest_giver roles |
> | 3 | Dialogue | **minimal** — one `ShowMessage` line per NPC. No trees, conditions, responses or flags |
> | 4 | Quest | **partial** — missions/objectives exist upstream and narrative beats gate on relationships. No `QuestDefinition`, flags or reward archetypes |
> | 5 | Inventory | **partial** — items placed per region with xp. No statBlock, rarity, vendors or quest-reward resolution |
> | 6 | Puzzle | **none** |
> | 7 | Lighting | **partial** — per-region palette + `ambientIntensity` from mood. No rigs, point lights or triggered changes |
> | 8 | Sound | **partial** — `musicIntensity` drives `MusicBus`, which is exactly the binding §8 proposes. No ambient loops, event triggers or `SoundProfile` |
> | 9 | Optimization | **none** — no budget model, no checkpoints, no audit log |
>
> Read this as a design direction with open questions, not as work that is done.
> The two questions at the end of the original draft were answered in the
> conversation it came from (incremental optimization; LLM-backed agents) but
> nothing was built from either answer.

Nine phases means nine agents, but they can't be nine unrelated black boxes — they need a shared contract (same input/output shape convention) and a shared WorldContext they all read from and write into, or the pipeline turns into hand-wired glue code. Let's set that up first, then define each agent.

The shared agent contract
ts
interface GeneratorAgent<TInput, TOutput> {
  id: string;
  phase: string;
  dependencies: string[];        // phase ids this agent needs already resolved
  generate(input: TInput, world: WorldContext): Promise<TOutput>;
  validate(output: TOutput, world: WorldContext): ValidationResult;
}

interface WorldContext {
  seed: string;
  globalDirectives: ExperienceDirective[];   // pacing, mood, difficulty — from Stage 2 upstream
  registry: Record<string, unknown>;         // phase id -> accumulated output
  flags: Record<string, boolean>;            // shared world-state vocabulary (quest/puzzle gates)
  constraints: {
    platformBudget: { maxDrawCalls: number; maxActiveLights: number; maxConcurrentAudio: number };
    contentRating: string;
  };
}

Every agent reads what it needs out of world.registry[dependencyId], writes its own output back in, and never talks to another agent directly. This keeps them swappable — you can replace the NPC generator with a smarter one without touching Dialogue's code, as long as the output shape holds.

Orchestration order (with one necessary loop)
Scene → NPC → Dialogue(pass 1: ambient) → Quest → Dialogue(pass 2: bound) → Inventory → Puzzle → Lighting → Sound → Optimization

The one wrinkle: Dialogue and Quest are mutually dependent. Quests need quest-givers to have dialogue hooks; dialogue needs quest flags to gate quest-specific lines. Solved with two passes rather than a real cycle — pass 1 generates ambient/personality dialogue and placeholder hook stubs, Quest Generator consumes those stubs and produces flags/objectives, pass 2 binds quest-specific lines into the stubs. This is called out explicitly below rather than papered over.

1. Scene Generator

Depends on: [] (root — consumes upstream narrative/pacing directives only)

ts
interface SceneNode {
  id: string;
  tags: string[];                    // e.g. ["rooftop", "vertical", "tense"]
  connections: { toSceneId: string; type: "door" | "ledge" | "corridor"; traversalTags?: string[] }[];
  anchors: { id: string; type: "npc_spawn" | "item_spawn" | "puzzle_socket" | "light_socket" | "sound_zone"; position: Vec3 }[];
  boundsHint: { width: number; height: number; verticality: number };
}
interface SceneGraph { id: string; nodes: SceneNode[]; entryNodeId: string }

Logic sketch: reads PacingExperience (tensionCurve, encounterDensity) and narrative SemanticNodes (location/mood) to decide node count, connectivity branching factor, and anchor density. High encounterDensity → more npc_spawn anchors per node; high verticality mood tags → taller boundsHint.

2. NPC Generator

Depends on: ["scene"]

ts
interface NPCDefinition {
  id: string;
  archetype: string;
  sceneId: string;
  anchorId: string;
  role: "hostile" | "neutral" | "ally" | "quest_giver" | "vendor";
  combatExperienceId?: string;   // links to a CombatExperience directive if hostile
  squadId?: string;
  traits: Record<string, number | string>;   // personality knobs, consumed by Dialogue
}

Logic sketch: walks every npc_spawn anchor in SceneGraph, assigns a role weighted by scene tags ("tense" scenes bias toward hostile), and for hostile NPCs generates a CombatExperience (from the earlier registry) plus groups adjacent hostiles into a SquadExperience when density crosses a threshold.

3. Dialogue Generator (two-pass)

Depends on: ["npc"] for pass 1, ["npc", "quest"] for pass 2

ts
interface DialogueNode {
  id: string;
  npcId: string;
  textRef: string;                // points to a string table, not raw text — keeps this localizable
  tone: string;
  conditions?: { flag: string; equals: boolean }[];
  responses?: { id: string; textRef: string; nextNodeId?: string; setsFlags?: string[] }[];
}
interface DialogueTree { id: string; npcId: string; rootNodeId: string; nodes: DialogueNode[] }

Pass 1 (ambient): generates greeting/idle lines from NPCDefinition.traits, plus hook stubs — empty DialogueNodes tagged awaitingQuestBinding: true for any quest_giver NPC.
Pass 2 (bound): re-invoked after Quest Generator runs; fills stub nodes with objective-specific text and setsFlags matching QuestDefinition.flagsWritten.

This is the one agent that appears twice in the pipeline — worth flagging so it's not mistaken for a bug in the ordering.

4. Quest Generator

Depends on: ["npc", "dialogue"] (pass 1 only)

ts
interface QuestObjective {
  id: string;
  type: "kill" | "collect" | "reach" | "talk" | "puzzle_solve" | "escort";
  targetRef: string;      // npcId, sceneNodeId, item archetype tag, or puzzleId
  count?: number;
}
interface QuestDefinition {
  id: string;
  giverNpcId: string;
  objectives: QuestObjective[];
  objectiveOrder: "linear" | "parallel" | "branching";
  rewardArchetypes: string[];    // e.g. ["weapon.dash_blade", "currency.100"] — resolved later by Inventory
  flagsRead: string[];
  flagsWritten: string[];
  dialogueHookIds: string[];     // stub node ids from Dialogue pass 1
}

Logic sketch: for every quest_giver NPC with an awaitingQuestBinding stub, builds an objective chain sized by beatDensity from the NarrativeExperience directive, and declares rewardArchetypes as tags — not concrete items, since Inventory hasn't run yet.

5. Inventory Generator

Depends on: ["quest", "scene"]

ts
interface ItemDefinition {
  id: string;
  archetype: string;
  statBlock: Record<string, number>;
  rarity: "common" | "uncommon" | "rare" | "unique";
  placement: { sceneAnchorId?: string; vendorNpcId?: string; questRewardOf?: string };
}

Logic sketch: resolves every rewardArchetype string from all QuestDefinitions into a concrete ItemDefinition, scaling statBlock using the same difficulty/theme curve pattern as generateMovementExperience. Also fills leftover item_spawn anchors with ambient loot so scenes don't feel empty around quest content.

6. Puzzle Generator

Depends on: ["scene", "quest", "inventory"]

ts
interface PuzzleDefinition {
  id: string;
  sceneAnchorId: string;
  type: "lock_key" | "sequence" | "physics" | "logic_gate" | "timed";
  requiredItemIds?: string[];
  solutionGraph: StateMachine;     // reuses the same StateMachine shape as movement/combat
  failureBehavior: "reset" | "lockout" | "penalty";
  rewardsOnSolve: string[];        // flags or questObjective ids it satisfies
}

Logic sketch: for each puzzle_socket anchor tied to a puzzle_solve objective, picks a puzzle type from scene mood tags ("heavy" → physics, "precision" → sequence), and — critically — reuses the StateMachine compiler shape from Stage 3, so the same adapter executor that runs combat/movement states can run a puzzle's solution graph with zero new code.

7. Lighting Generator

Depends on: ["scene", "quest", "puzzle"]

ts
interface LightRig {
  id: string;
  sceneNodeId: string;
  ambient: { color: string; intensity: number };
  pointLights: { anchorId: string; color: string; intensity: number; radius: number; flicker?: number }[];
  triggeredChanges: { onEvent: string; setAmbient?: { color: string; intensity: number }; fadeSeconds: number }[];
}

Logic sketch: base ambient derived from scene mood tags ("desperate" → low warm intensity with flicker); triggeredChanges wired to flags written by Puzzle/Quest (onEvent: "puzzle_solved:${id}" brightens the room). This is where mood tags first become literal visual parameters rather than descriptive text.

8. Sound Generator

Depends on: ["scene", "lighting", "quest", "combat/squad directives"]

ts
interface SoundProfile {
  id: string;
  sceneNodeId: string;
  ambientLoopId: string;
  musicLayerId: string;     // maps to PacingExperience.musicIntensity via layered stems
  eventTriggers: { onEvent: string; soundId: string; priority: number }[];
}

Logic sketch: musicLayerId binds directly to the PacingExperience.musicIntensity value the Pacing Director already computes per tick — no new mood interpretation needed here, just a lookup. eventTriggers subscribes to combat events ("AttackGranted" from the squad coordinator → stinger) and puzzle/quest flags (solve chime, quest-complete fanfare).

9. Optimization Generator

Depends on: all prior phases — this is a whole-world pass, not a content generator

ts
interface OptimizationPass {
  id: string;
  cullingGroups: { sceneNodeId: string; group: string }[];
  lodAssignments: { assetId: string; lodLevels: number }[];
  pooledEntityTypes: string[];
  tickBudgetWarnings: { directorProgramId: string; issue: string; suggestion: string }[];
  assetDeduplication: { duplicateOf: string; assetIds: string[] }[];
}

Important structural difference: this agent doesn't emit ExperienceDirectives or runtime actions like the other eight — it's a static analysis pass over the compiled world, run once everything else exists. It reads world.constraints.platformBudget, counts how many DirectorPrograms (Pacing, Squad Coordinators, Lighting triggers) are ticking concurrently per scene, and flags anything over budget — e.g. too many 0.2s-tick squad coordinators active in one SceneNode at once. It emits build-time patches, not runtime behaviors, so it needs its own executor path in the pipeline rather than plugging into the adapter's action switch.

Orchestrator wiring
ts
async function runPipeline(world: WorldContext): Promise<WorldContext> {
  const scene = await sceneAgent.generate(world.globalDirectives, world);
  world.registry.scene = scene;

  const npcs = await npcAgent.generate(scene, world);
  world.registry.npc = npcs;

  const dialogueDraft = await dialogueAgent.generate({ npcs, pass: 1 }, world);
  world.registry.dialogue = dialogueDraft;

  const quests = await questAgent.generate({ npcs, dialogueDraft }, world);
  world.registry.quest = quests;

  const dialogueFinal = await dialogueAgent.generate({ npcs, quests, pass: 2 }, world);
  world.registry.dialogue = dialogueFinal;   // overwrite draft

  const inventory = await inventoryAgent.generate({ quests, scene }, world);
  world.registry.inventory = inventory;

  const puzzles = await puzzleAgent.generate({ scene, quests, inventory }, world);
  world.registry.puzzle = puzzles;

  const lighting = await lightingAgent.generate({ scene, quests, puzzles }, world);
  world.registry.lighting = lighting;

  const sound = await soundAgent.generate({ scene, lighting, quests }, world);
  world.registry.sound = sound;

  world.registry.optimization = await optimizationAgent.generate(world.registry, world);
  return world;
}

Every agent's validate() should run immediately after its generate() — e.g. Quest Generator's validator should reject a QuestDefinition whose dialogueHookIds don't exist in the draft dialogue tree, catching broken cross-references before they propagate three phases downstream into Lighting/Sound triggers that reference dead flags.

A few open decisions that'll shape how much of this you build first:

Should Optimization run once at the end, or incrementally after each phase (so a scene that's already over-budget stops NPC Generator from over-spawning)?
Do you want agent implementations to be deterministic functions (like the ones above) or LLM-backed for the more "creative" phases (Scene, Dialogue, Quest) while keeping Lighting/Sound/Optimization deterministic?

Either changes the generate() internals but not the contract, so it's safe to pick per-agent rather than all-or-nothing.

Optimization should happen incrementally after each phase, and yes i want agent implementations to be llm backed function

Architected incremental optimization pipeline with LLM-backed agent implementations
Architected incremental optimization pipeline with LLM-backed agent implementations

Two structural changes ripple through everything: optimization becomes a budget gate between every phase instead of a final pass, and every generate() becomes an LLM call wrapped in strict JSON-schema validation with a repair loop — since LLM output can't be trusted to match the interface on the first try.

1. Incremental Optimization — the bigger change

Optimization can no longer be "one pass at the end reading everything." It needs to become a lightweight checkpoint agent invoked after every phase, plus it needs to feed constraints forward, not just report problems backward.

ts
interface OptimizationCheckpoint {
  afterPhase: string;
  passed: boolean;
  budgetSnapshot: { drawCalls: number; activeLights: number; concurrentAudio: number; activeDirectorPrograms: number };
  violations: { severity: "warn" | "block"; message: string; suggestedConstraintPatch?: Partial<WorldContext["constraints"]> }[];
}

async function checkpointOptimization(
  phase: string,
  world: WorldContext
): Promise<OptimizationCheckpoint> {
  const snapshot = computeBudgetSnapshot(world.registry); // deterministic, no LLM needed here
  const remaining = {
    drawCalls: world.constraints.platformBudget.maxDrawCalls - snapshot.drawCalls,
    lights: world.constraints.platformBudget.maxActiveLights - snapshot.activeLights,
    audio: world.constraints.platformBudget.maxConcurrentAudio - snapshot.concurrentAudio,
  };

  const violations = [];
  if (remaining.drawCalls < 0) {
    violations.push({
      severity: "block" as const,
      message: `Draw call budget exceeded by ${-remaining.drawCalls} after ${phase}`,
      suggestedConstraintPatch: { platformBudget: { ...world.constraints.platformBudget, maxDrawCalls: snapshot.drawCalls } }
    });
  }
  // same pattern for lights, audio, activeDirectorPrograms (squad coordinators, pacing directors ticking concurrently)

  return { afterPhase: phase, passed: violations.every(v => v.severity !== "block"), budgetSnapshot: snapshot, violations };
}

The key design decision: a block violation doesn't just get logged — it shrinks the constraint budget passed to the next agent, so e.g. if NPC Generator overspawns and blows the light budget, Lighting Generator (three phases later) receives a tighter maxActiveLights before it ever runs, rather than generating too much and getting rejected after the fact.

ts
async function runPipeline(world: WorldContext): Promise<WorldContext> {
  const phases: { id: string; run: (w: WorldContext) => Promise<unknown> }[] = [
    { id: "scene", run: (w) => sceneAgent.generate(w.globalDirectives, w) },
    { id: "npc", run: (w) => npcAgent.generate(w.registry.scene, w) },
    { id: "dialogue_pass1", run: (w) => dialogueAgent.generate({ npcs: w.registry.npc, pass: 1 }, w) },
    { id: "quest", run: (w) => questAgent.generate({ npcs: w.registry.npc, dialogueDraft: w.registry.dialogue }, w) },
    { id: "dialogue_pass2", run: (w) => dialogueAgent.generate({ npcs: w.registry.npc, quests: w.registry.quest, pass: 2 }, w) },
    { id: "inventory", run: (w) => inventoryAgent.generate({ quests: w.registry.quest, scene: w.registry.scene }, w) },
    { id: "puzzle", run: (w) => puzzleAgent.generate({ scene: w.registry.scene, quests: w.registry.quest, inventory: w.registry.inventory }, w) },
    { id: "lighting", run: (w) => lightingAgent.generate({ scene: w.registry.scene, quests: w.registry.quest, puzzles: w.registry.puzzle }, w) },
    { id: "sound", run: (w) => soundAgent.generate({ scene: w.registry.scene, lighting: w.registry.lighting, quests: w.registry.quest }, w) },
  ];

  const checkpoints: OptimizationCheckpoint[] = [];

  for (const phase of phases) {
    world.registry[phase.id] = await phase.run(world);

    const checkpoint = await checkpointOptimization(phase.id, world);
    checkpoints.push(checkpoint);

    if (!checkpoint.passed) {
      // tighten constraints for every subsequent agent
      for (const v of checkpoint.violations) {
        if (v.suggestedConstraintPatch) {
          world.constraints = { ...world.constraints, ...v.suggestedConstraintPatch };
        }
      }
      // if the violation is severe, regenerate the offending phase under the new budget
      if (checkpoint.violations.some(v => v.severity === "block")) {
        world.registry[phase.id] = await phase.run(world); // re-run with tightened world.constraints
      }
    }
  }

  world.registry.optimizationLog = checkpoints; // full audit trail, not just a final report
  return world;
}

This keeps the "static analysis pass" nature of Optimization but turns it into a gate that runs nine times, each time cheap (it's deterministic budget math, not an LLM call), only escalating to a regenerate when a block occurs.

2. LLM-backed generate() — the pattern every agent shares

Every creative agent needs the same three-part shape: schema-constrained prompt → parse → validate → repair-retry. Building this once as a shared helper means each agent file is just a prompt template plus a schema.

ts
interface LLMAgentSpec<TInput, TOutput> {
  systemPrompt: string;
  buildUserPrompt: (input: TInput, world: WorldContext) => string;
  outputSchema: JSONSchema;         // JSON schema describing TOutput
  maxRepairAttempts?: number;
}

async function runLLMAgent<TInput, TOutput>(
  spec: LLMAgentSpec<TInput, TOutput>,
  input: TInput,
  world: WorldContext
): Promise<TOutput> {
  const basePrompt = spec.buildUserPrompt(input, world);
  let attempt = 0;
  let lastError: string | null = null;

  while (attempt <= (spec.maxRepairAttempts ?? 2)) {
    const prompt = lastError
      ? `${basePrompt}\n\nYour previous response failed validation with this error:\n${lastError}\nReturn ONLY corrected JSON matching the schema. No prose, no markdown fences.`
      : `${basePrompt}\n\nReturn ONLY JSON matching this schema, no prose, no markdown fences:\n${JSON.stringify(spec.outputSchema)}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: spec.systemPrompt,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const cleaned = text.replace(/```json|```/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned) as TOutput;
      const check = validateAgainstSchema(parsed, spec.outputSchema);
      if (check.valid) return parsed;
      lastError = check.errors.join("; ");
    } catch (e) {
      lastError = `Invalid JSON: ${(e as Error).message}`;
    }
    attempt++;
  }

  throw new Error(`Agent failed to produce valid output after ${attempt} attempts: ${lastError}`);
}

validateAgainstSchema should be a real JSON-schema validator (e.g. ajv), not hand-rolled checks — worth using a library here since every one of the nine agents leans on it.

3. One agent fully worked: NPC Generator
ts
const npcAgentSpec: LLMAgentSpec<SceneGraph, NPCDefinition[]> = {
  systemPrompt: `You are the NPC Generator in a game-content compiler pipeline.
You receive a SceneGraph and must populate every "npc_spawn" anchor with an NPCDefinition.
Rules:
- Every anchor id used must exist in the input scene's anchors.
- Hostile NPCs in scenes tagged "tense" or "dangerous" should outnumber neutral/ally roles.
- Assign a squadId (shared string) to hostile NPCs sharing a sceneNodeId when there are 3+ of them.
- traits values must be numbers between 0 and 1, except archetype-defining strings.
- Never invent anchor ids or scene ids not present in the input.`,

  buildUserPrompt: (scene, world) => `
SceneGraph:
${JSON.stringify(scene, null, 2)}

Global directives (mood/difficulty/pacing context):
${JSON.stringify(world.globalDirectives, null, 2)}

Current platform constraints (respect these — avoid overpopulating combat-heavy nodes):
${JSON.stringify(world.constraints.platformBudget, null, 2)}
`,

  outputSchema: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "archetype", "sceneId", "anchorId", "role", "traits"],
      properties: {
        id: { type: "string" },
        archetype: { type: "string" },
        sceneId: { type: "string" },
        anchorId: { type: "string" },
        role: { enum: ["hostile", "neutral", "ally", "quest_giver", "vendor"] },
        combatExperienceId: { type: "string" },
        squadId: { type: "string" },
        traits: { type: "object" }
      }
    }
  },
  maxRepairAttempts: 2
};

const npcAgent: GeneratorAgent<SceneGraph, NPCDefinition[]> = {
  id: "npc",
  phase: "npc",
  dependencies: ["scene"],
  generate: (scene, world) => runLLMAgent(npcAgentSpec, scene, world),
  validate: (npcs, world) => {
    const scene = world.registry.scene as SceneGraph;
    const validAnchorIds = new Set(scene.nodes.flatMap(n => n.anchors.map(a => a.id)));
    const errors = npcs
      .filter(n => !validAnchorIds.has(n.anchorId))
      .map(n => `NPC ${n.id} references nonexistent anchor ${n.anchorId}`);
    return { valid: errors.length === 0, errors };
  }
};

Two things worth noticing here that generalize to every other agent:

validate() is deliberately separate from the LLM's own schema check. Schema validation catches shape errors (wrong types, missing fields). validate() catches semantic errors against the rest of WorldContext (dangling references to anchors/flags/npcs that don't exist) — the LLM can produce perfectly well-typed JSON that still references a hallucinated anchorId. This is exactly the failure mode you'd hit constantly with LLM-backed generation, so it's not optional.
The prompt explicitly injects current platformBudget, which is how the incremental-optimization feedback loop actually reaches the LLM — not just as a post-hoc filter, but as context the model sees before generating, so a tightened budget from a Scene Generator overshoot actually changes NPC density on the next call rather than just getting rejected after.
4. Repair-on-validate() failure, not just schema failure

The runLLMAgent retry loop above only re-prompts on JSON/schema errors. Semantic validation failures need the same treatment, so the orchestrator should wrap each phase like this:

ts
async function runPhaseWithValidation(agent: GeneratorAgent<any, any>, input: unknown, world: WorldContext) {
  let output = await agent.generate(input, world);
  let check = agent.validate(output, world);
  let attempts = 0;

  while (!check.valid && attempts < 2) {
    const repairInput = { original: input, priorOutput: output, errors: check.errors };
    output = await agent.generate(repairInput, world);   // agent's generate() should detect repairInput shape and re-prompt with errors
    check = agent.validate(output, world);
    attempts++;
  }
  if (!check.valid) throw new Error(`${agent.id} failed semantic validation: ${check.errors.join("; ")}`);
  return output;
}
What this changes about the earlier deterministic agents

Scene, Quest, and Dialogue are the ones where LLM generation earns its keep (they need creative variation). Puzzle's solutionGraph, Lighting's numeric rigs, and Sound's trigger wiring are more mechanical — you could still LLM-back them for variety, but they're higher-risk for hallucinated references (a StateMachine with a nonexistent transition target is a harder bug to catch than a bad string). Worth deciding per-agent rather than blanket-applying LLM generation everywhere:

Good — this splits the nine agents into two distinct patterns, and the important part is making the hybrid pattern (deterministic core + LLM flavor overlay) a shared shape too, same as we did for the pure-LLM agents. Otherwise Puzzle/Lighting/Sound/Inventory turn into four bespoke one-offs.

The hybrid agent contract
ts
interface HybridAgentSpec<TInput, TCore, TOutput> {
  generateCore: (input: TInput, world: WorldContext) => TCore;          // pure function, no LLM
  flavorSpec: {
    systemPrompt: string;
    buildUserPrompt: (core: TCore, input: TInput, world: WorldContext) => string;
    outputSchema: JSONSchema;    // schema for JUST the flavor fields, keyed by core element id
  };
  mergeFlavor: (core: TCore, flavor: Record<string, Record<string, string>>) => TOutput;
  maxRepairAttempts: 2;   // fixed per your spec, not agent-configurable
}

async function runHybridAgent<TInput, TCore, TOutput>(
  spec: HybridAgentSpec<TInput, TCore, TOutput>,
  input: TInput,
  world: WorldContext
): Promise<TOutput> {
  const core = spec.generateCore(input, world);   // deterministic, always succeeds or throws structurally

  const flavor = await runLLMAgent(
    {
      systemPrompt: spec.flavorSpec.systemPrompt,
      buildUserPrompt: (c: TCore) => spec.flavorSpec.buildUserPrompt(c, input, world),
      outputSchema: spec.flavorSpec.outputSchema,
      maxRepairAttempts: 2
    },
    core,
    world
  );

  return spec.mergeFlavor(core, flavor);
}

The key design principle: the LLM never touches statBlock, solutionGraph, pointLights intensities, or any field that other agents or the adapter depend on structurally. It only ever fills in a parallel Record<coreElementId, { name, description, flavorText }> map that gets merged in after validation of the core is already guaranteed. This means the repair-retry budget for these four agents only ever applies to flavor text — the mechanical skeleton can't fail schema validation because it was never LLM-generated in the first place.

That also answers your earlier open question implicitly: for these four, a failed flavor-generation retry can safely fall back to templated flavor text (no LLM at all) rather than blocking the phase, since flavor is cosmetic. I'll build that fallback in.

Inventory Generator (hybrid)
ts
function generateInventoryCore(
  input: { quests: QuestDefinition[]; scene: SceneGraph },
  world: WorldContext
): ItemDefinition[] {
  const items: ItemDefinition[] = [];

  for (const quest of input.quests) {
    for (const archetype of quest.rewardArchetypes) {
      items.push({
        id: `item_${quest.id}_${archetype.replace(/\./g, "_")}`,
        archetype,
        statBlock: resolveStatBlock(archetype, world.globalDirectives), // same difficulty-scale pattern as generateMovementExperience
        rarity: rarityFromDifficulty(world.globalDirectives),
        placement: { questRewardOf: quest.id }
      });
    }
  }

  // fill leftover item_spawn anchors with ambient loot
  for (const node of input.scene.nodes) {
    for (const anchor of node.anchors.filter(a => a.type === "item_spawn")) {
      if (items.some(i => i.placement.sceneAnchorId === anchor.id)) continue;
      items.push({
        id: `item_ambient_${anchor.id}`,
        archetype: pickAmbientArchetype(node.tags),
        statBlock: resolveStatBlock("ambient", world.globalDirectives),
        rarity: "common",
        placement: { sceneAnchorId: anchor.id }
      });
    }
  }
  return items;
}

const inventoryAgentSpec: HybridAgentSpec<{ quests: QuestDefinition[]; scene: SceneGraph }, ItemDefinition[], InventoryOutput> = {
  generateCore: generateInventoryCore,
  flavorSpec: {
    systemPrompt: `You write short item flavor text for a game. You receive a list of items with
mechanical stats already fixed — do not reference specific numbers, since balance may change.
For each item id, return a display name and 1-2 sentence lore description matching its archetype
and rarity. Never invent new items or ids not given to you.`,
    buildUserPrompt: (core) => `Items:\n${JSON.stringify(core.map(i => ({ id: i.id, archetype: i.archetype, rarity: i.rarity })), null, 2)}`,
    outputSchema: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["name", "description"],
        properties: { name: { type: "string" }, description: { type: "string" } }
      }
    }
  },
  mergeFlavor: (core, flavor) => ({
    items: core.map(item => ({
      ...item,
      name: flavor[item.id]?.name ?? templatedItemName(item.archetype, item.rarity),
      description: flavor[item.id]?.description ?? templatedItemDescription(item.archetype)
    }))
  }),
  maxRepairAttempts: 2
};

templatedItemName/templatedItemDescription are the deterministic fallback — e.g. "${rarity} ${archetype.split('.').pop()}" and a generic sentence — used only if both LLM attempts fail validation (missing ids, extra hallucinated ids, wrong shape).

Puzzle Generator (hybrid)

The mechanical skeleton (solutionGraph) reuses the StateMachine compiler shape already established — this must stay 100% deterministic since the adapter executes it directly.

ts
function generatePuzzleCore(
  input: { scene: SceneGraph; quests: QuestDefinition[]; inventory: ItemDefinition[] },
  world: WorldContext
): PuzzleDefinition[] {
  const puzzles: PuzzleDefinition[] = [];
  const puzzleObjectives = input.quests.flatMap(q => q.objectives.filter(o => o.type === "puzzle_solve"));

  for (const node of input.scene.nodes) {
    for (const anchor of node.anchors.filter(a => a.type === "puzzle_socket")) {
      const type = pickPuzzleType(node.tags);      // deterministic rule table, e.g. "heavy" -> physics
      const linkedObjective = puzzleObjectives.find(o => o.targetRef === anchor.id);
      puzzles.push({
        id: `puzzle_${anchor.id}`,
        sceneAnchorId: anchor.id,
        type,
        requiredItemIds: type === "lock_key" ? [pickKeyItem(input.inventory, anchor.id)] : undefined,
        solutionGraph: buildPuzzleStateMachine(type, anchor.id),  // deterministic template, same family as buildPlatformerMovementStateMachine
        failureBehavior: type === "timed" ? "penalty" : "reset",
        rewardsOnSolve: linkedObjective ? [linkedObjective.id] : []
      });
    }
  }
  return puzzles;
}

Flavor overlay adds only name/hintText/solveDescription per puzzle id — never touches solutionGraph, type, or requiredItemIds.

Lighting Generator (hybrid)

Numeric rig stays deterministic (already established this reads scene mood tags → ambient/point light values). LLM flavor here isn't text at all in the usual sense — it's better used for naming light cues / describing triggered transitions for designer-facing tooling, plus optionally generating flicker "personality" descriptions. Small but consistent with the pattern:

ts
function generateLightingCore(
  input: { scene: SceneGraph; quests: QuestDefinition[]; puzzles: PuzzleDefinition[] },
  world: WorldContext
): LightRig[] {
  // unchanged from before — mood tags -> ambient/point values, puzzle/quest flags -> triggeredChanges
  return input.scene.nodes.map(node => buildLightRigForNode(node, input.quests, input.puzzles));
}

const lightingAgentSpec: HybridAgentSpec<..., LightRig[], LightingOutput> = {
  generateCore: generateLightingCore,
  flavorSpec: {
    systemPrompt: `You name lighting cues for level designers. Given a LightRig's numeric values and
the scene's mood tags, return a short human-readable cue name and 1-sentence designer note
per rig id. Do not suggest changing any numeric value.`,
    buildUserPrompt: (core) => JSON.stringify(core.map(r => ({ id: r.id, ambient: r.ambient, hasFlicker: r.pointLights.some(p => p.flicker) }))),
    outputSchema: { /* { [rigId]: { cueName, designerNote } } */ } as JSONSchema
  },
  mergeFlavor: (core, flavor) => ({
    rigs: core.map(r => ({ ...r, cueName: flavor[r.id]?.cueName ?? `${r.id}_cue`, designerNote: flavor[r.id]?.designerNote ?? "" }))
  }),
  maxRepairAttempts: 2
};
Sound Generator (hybrid)

Same shape — trigger wiring to PacingExperience.musicIntensity and event hooks stays deterministic; flavor fills in ambient loop descriptions (useful if you're generating a brief for an audio team or a temp-audio placeholder search query) rather than actual audio synthesis:

ts
function generateSoundCore(
  input: { scene: SceneGraph; lighting: LightingOutput; quests: QuestDefinition[] },
  world: WorldContext
): SoundProfile[] {
  return input.scene.nodes.map(node => buildSoundProfileForNode(node, input.lighting, input.quests, world.globalDirectives));
}
// flavor overlay: { [profileId]: { ambientMood: string, searchQueryHint: string } }

searchQueryHint is worth calling out — it's a genuinely useful flavor output, since it's a short phrase (e.g. "tense rooftop wind ambience loop") that could later feed a sound-asset search step, not just cosmetic text.

Registry, with the split made explicit
ts
const compilerAgents = {
  scene:      { kind: "llm" as const, agent: sceneAgent },
  npc:        { kind: "llm" as const, agent: npcAgent },
  dialogue:   { kind: "llm" as const, agent: dialogueAgent },
  quest:      { kind: "llm" as const, agent: questAgent },
  inventory:  { kind: "hybrid" as const, spec: inventoryAgentSpec },
  puzzle:     { kind: "hybrid" as const, spec: puzzleAgentSpec },
  lighting:   { kind: "hybrid" as const, spec: lightingAgentSpec },
  sound:      { kind: "hybrid" as const, spec: soundAgentSpec },
  optimization: { kind: "deterministic" as const, fn: checkpointOptimization },
};
Orchestrator update — repair budget applied uniformly

Per your instruction, 2 retries per phase now applies at two different layers depending on kind:

LLM agents (scene/npc/dialogue/quest): 2 retries cover both schema failure and semantic validate() failure combined — i.e. total attempts across runLLMAgent's internal loop and runPhaseWithValidation's outer loop should sum to 2, not stack to 4. Worth tightening runLLMAgent's maxRepairAttempts down when called from inside runPhaseWithValidation so you don't accidentally get 2×2.
Hybrid agents: the deterministic core never needs retries (it's a pure function — if it throws, that's a real bug, not a retry-able generation failure). The 2-retry budget applies only to the flavor overlay, and on exhaustion it falls back to templated flavor rather than blocking the phase or the optimization checkpoint.
ts
async function runPhase(phaseId: string, input: unknown, world: WorldContext) {
  const spec = compilerAgents[phaseId];

  if (spec.kind === "llm") {
    return runPhaseWithValidation(spec.agent, input, world); // internal budget: 2 total, not 2+2
  }
  if (spec.kind === "hybrid") {
    return runHybridAgent(spec.spec, input, world);          // core never fails; flavor gets 2 attempts, then template fallback
  }
  return spec.fn(phaseId, world); // optimization checkpoint, no retries, pure math
}

One thing worth deciding now rather than later: for the hybrid agents, should a flavor-generation failure (both retries exhausted, falling back to templates) get logged into the same optimizationLog audit trail, or does it need its own flavorFallbackLog? Templated flavor text degrades content quality silently otherwise — if you want visibility into how often the LLM is failing on Puzzle/Lighting/Sound/Inventory naming, that's worth surfacing somewhere rather than swallowing it.