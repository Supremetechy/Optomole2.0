import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Spec -> engine project generator.
//
// Turns a BuildCommand (the same payload the gateway queues for browser builds)
// into a concrete, engine-native project on disk by:
//   1. extracting an engine-neutral GameSpec from the package + mappingManifest,
//   2. copying the matching scaffold from templates/<engine>,
//   3. injecting the GameSpec as data the engine reads at cook/build time.
//
// The engine builders (unreal.js / unity.js / blender.js) then invoke the real
// CLI over the generated project. This is the piece that closes the
// "queued builds are stubs" gap: the project the engine cooks now actually
// contains the compiled experience.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the engine scaffolds live. Override with TEMPLATES_ROOT.
export function templatesRoot() {
  return process.env.TEMPLATES_ROOT || path.resolve(__dirname, "..", "templates");
}

/**
 * Collapse the queued package + mapping manifest into a flat, engine-neutral
 * spec. Works for both the AI-compiler package (specification.experienceManifest)
 * and the offline package (blueprint.*), and folds in the mapping bindings that
 * carry the "this work item becomes this game entity" decisions.
 */
export function extractGameSpec(command) {
  const pkg = command.package || {};
  const experience = pkg.experience || {};
  const blueprint = pkg.blueprint || {};
  const progression = pkg.progression || {};
  const mapping = command.mappingManifest || {};
  const bindings = Array.isArray(mapping.bindings) ? mapping.bindings : [];
  // The gateway's projection (ExperienceBuildService) is authoritative when
  // present: it is the same component set the browser runtime plays, so a
  // pipeline layer wired once reaches the native engines too. Older queued
  // commands have no components block, so the local derivation stays as the
  // fallback rather than failing the build.
  const components = command.experienceBuild?.components || null;

  const quests = components?.quests?.quests?.length
    ? components.quests.quests.map((quest, index) => ({
      id: str(quest.id || `quest-${index + 1}`),
      title: str(quest.title || `Quest ${index + 1}`),
      summary: str(quest.summary || ""),
      // Component quests reference bindings by id; resolve to labels so the
      // engine templates keep receiving displayable strings.
      objectives: arr(quest.objectiveIds).map((id) => labelForBinding(bindings, id)).filter(Boolean),
      evidence: arr(quest.evidenceIds).map((id) => ({ text: labelForBinding(bindings, id), correct: true })).filter((e) => e.text),
      objectiveIds: arr(quest.objectiveIds).map(str),
      evidenceIds: arr(quest.evidenceIds).map(str),
      completion: quest.completion || null,
      xp: num(quest.reward?.xp, 100 + index * 25),
    }))
    : arr(blueprint.quests).map((quest, index) => ({
      id: str(quest.id || `quest-${index + 1}`),
      title: str(quest.title || `Quest ${index + 1}`),
      summary: str(quest.summary || ""),
      objectives: arr(quest.objectives).map((o) => str(o.title || o.prompt || o)),
      evidence: arr(quest.evidence).map((e) => ({ text: str(e.text || e), correct: e.correct !== false })),
      objectiveIds: [],
      evidenceIds: [],
      completion: null,
      xp: num(quest.reward?.xp, 100 + index * 25),
    }));

  // Bindings -> spawnable entities with a deterministic grid layout so every
  // engine places them identically without an RNG.
  const entities = bindings.map((binding, index) => {
    const src = binding.sourceElement || {};
    const gb = binding.gameBinding || {};
    const cols = Math.max(1, Math.ceil(Math.sqrt(bindings.length || 1)));
    const entityType = str(gb.gameEntityType || "quest-objective");
    const hazard = gb.gameEntityType === "hazard" || src.correct === false;
    return {
      id: str(binding.id || `entity-${index + 1}`),
      index,
      entityType,
      // Canonical cross-genre role every engine can build from, regardless of
      // which genre vocabulary the mapping used (key-item vs loot, enemy vs
      // hazard, region-gate vs lock, ...).
      role: roleFor(entityType, hazard),
      interaction: str(gb.interactionType || "inspect"),
      mechanic: str(gb.mechanic || gb.gameEntityType || "objective"),
      label: str(src.label || src.title || `Objective ${index + 1}`),
      description: str(src.description || src.evidence || src.text || ""),
      sourceType: str(src.type || binding.workElementType || "content"),
      priority: num(gb.spawnRules?.priority, 50),
      slot: str(gb.templateSlot || ""),
      hazard: gb.gameEntityType === "hazard" || src.correct === false,
      reward: gb.reward || {},
      // Grid cell -> world position (units are engine-agnostic; builders scale).
      grid: { col: index % cols, row: Math.floor(index / cols) },
    };
  });

  return {
    schemaVersion: "1.0.0",
    generatedBy: "optomole-project-generator",
    experienceId: str(experience.id || pkg.id || command.experienceId || "experience"),
    title: str(experience.title || "Optomole Experience"),
    genre: experience.genre || { id: "unknown", title: "Unknown" },
    world: experience.world || { planet: "Knowledge Frontier" },
    target: str(command.target || "unknown"),
    templateId: str(mapping.templateId || command.template?.id || ""),
    domain: str(progression.domain || ""),
    genreFamily: str(command.template?.genreFamily || ""),
    xpReward: num(progression.xpReward, entities.reduce((s, e) => s + num(e.reward?.xp, 0), 0)),
    requiredSystems: arr(mapping.requiredRuntimeSystems).map(String),
    assetSlots: arr(mapping.assetSlots),
    quests,
    entities,
    characters: components?.cast?.characters?.length ? components.cast.characters : arr(blueprint.characters),
    achievements: components?.progression?.achievements?.length ? components.progression.achievements : arr(blueprint.achievements),
    goals: arr(blueprint.goals).map(String),
    skillTree: components?.progression?.branches?.length ? components.progression.branches : arr(blueprint.skillTree),
    proceduralMap: blueprint.proceduralMap || null,
    // Layers the native path previously never received at all.
    world: components?.world || null,
    narrative: components?.narrative || null,
    knowledge: components?.knowledge || null,
    inventory: components?.inventory || null,
    challenges: components?.challenges || null,
    componentCoverage: command.experienceBuild?.validation?.componentCoverage || null,
    counts: { quests: quests.length, entities: entities.length },
  };
}

/** Resolve a binding id to its display label. Components reference; they don't copy. */
function labelForBinding(bindings, bindingId) {
  const binding = bindings.find((candidate) => String(candidate.id) === String(bindingId));
  if (!binding) return "";
  return str(binding.label || binding.sourceElement?.label || "");
}

/**
 * Copy templates/<engine> into <workspace>/project and inject the GameSpec at
 * the engine's data path. Returns the generated project layout.
 */
export async function materializeProject({ command, engine, workspace, log }) {
  const spec = extractGameSpec(command);
  const scaffold = await selectScaffold(engine, spec.genreFamily, log);
  const projectDir = path.join(workspace, "project");

  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.cp(scaffold, projectDir, { recursive: true });
  log(`Generated ${engine} project from ${path.relative(templatesRoot(), scaffold)} -> ${projectDir}`);

  // Engine-specific data drop the runtime/cook reads.
  const dataPaths = {
    unity: "Assets/StreamingAssets/experience.json",
    unreal: "Content/Data/Experience.json",
    blender: "experience.json",
  };
  const specRel = dataPaths[engine] || "experience.json";
  const specPath = path.join(projectDir, specRel);
  await fs.mkdir(path.dirname(specPath), { recursive: true });
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
  log(`Injected game spec (${spec.counts.entities} entities, ${spec.counts.quests} quests) -> ${specRel}`);

  return { projectDir, specPath, spec };
}

// Map a genre-specific entity type to a canonical adventure role.
function roleFor(entityType, hazard) {
  const t = String(entityType).toLowerCase();
  if (hazard || /hazard|enemy|threat|trap|distractor|obstacle/.test(t)) return "hazard";
  if (/lock|gate|door|barrier/.test(t)) return "gate";
  if (/npc|dialogue|character|guide|giver/.test(t)) return "npc";
  if (/key|loot|collectible|evidence|resource|item|pickup|token|card/.test(t)) return "key";
  return "objective";
}

/**
 * Genre selection hook. Prefer a genre-specific scaffold
 * `templates/<engine>-<genreFamily>` (e.g. templates/unity-board-sim) when it
 * exists; otherwise fall back to the universal `templates/<engine>` game (which
 * plays any content via canonical entity roles). Add a `<engine>-<family>`
 * folder to override a single genre without touching the base.
 */
async function selectScaffold(engine, genreFamily, log) {
  const root = templatesRoot();
  const base = path.join(root, engine);
  const family = String(genreFamily || "").trim().toLowerCase();

  if (family) {
    const familyDir = path.join(root, `${engine}-${family}`);
    if (await exists(familyDir)) {
      log(`Scaffold: ${engine}-${family} (genre-specific override)`);
      return familyDir;
    }
    log(`Scaffold: ${engine} (no ${engine}-${family} override; using base)`);
  }

  if (!(await exists(base))) {
    throw new Error(`No project scaffold at ${base} for engine "${engine}"`);
  }
  return base;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}
function str(v) {
  return v == null ? "" : String(v);
}
function num(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
