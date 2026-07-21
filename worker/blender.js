import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { materializeProject } from "./project-generator.js";

// Blender export path.
//
// Generates a scene-generation project from the compiled experience, then runs
// Blender headless (--background --python) over templates/blender/optomole_export.py.
// The script reads experience.json, builds one object per compiled entity on a
// grid (hazards flagged red, quest gates as gates), and exports a glTF (.glb)
// the game/engine or a web viewer can load.
//
// Real export when BLENDER_PATH points at a Blender executable; simulation
// otherwise (still writes the real project + the .py that would run).
export async function runBlenderExport({ job, workspace, config, log }) {
  const { projectDir, specPath, spec } = await materializeProject({
    command: job,
    engine: "blender",
    workspace,
    log,
  });
  const archiveDir = path.join(workspace, "archive");
  await fs.mkdir(archiveDir, { recursive: true });

  const script = path.join(projectDir, "optomole_export.py");
  const outputGlb = path.join(archiveDir, "experience.glb");
  const blenderPath = config.blenderPath;
  const canRunBlender = !!blenderPath && !config.simulateBlender && (await exists(blenderPath));

  if (!canRunBlender) {
    return simulateBuild({ job, spec, projectDir, script, specPath, outputGlb, archiveDir, blenderPath, config, log });
  }

  // `--` separates Blender args from script args; the script reads sys.argv after it.
  const args = ["--background", "--python", script, "--", specPath, outputGlb];
  log(`Launching Blender: "${blenderPath}" ${args.join(" ")}`);
  await runProcess(blenderPath, args, { cwd: workspace, log });
  log(`Blender export finished -> ${outputGlb}`);

  await fs.writeFile(path.join(archiveDir, "logs.txt"), (job._log || []).join("\n") + "\n");
  await fs.writeFile(path.join(archiveDir, "metadata.json"), metadata(job, spec, false));
  return { artifactPath: archiveDir, kind: "asset-export", simulated: false };
}

async function simulateBuild({ job, spec, projectDir, script, specPath, outputGlb, archiveDir, blenderPath, config, log }) {
  const why = !blenderPath
    ? "BLENDER_PATH not set"
    : config?.simulateBlender
      ? "SIMULATE_BLENDER=1"
      : `Blender executable not found at ${blenderPath}`;
  log(`Simulating Blender export (${why}).`);
  log(`Would run: blender --background --python ${script} -- ${specPath} ${outputGlb}`);

  await fs.writeFile(
    path.join(archiveDir, "experience.glb.txt"),
    `Simulated Blender glTF export for "${spec.title}" (job ${job.jobId})\n` +
      `Objects: ${spec.counts.entities} (one per compiled entity), Quests: ${spec.counts.quests}\n`
  );
  await fs.writeFile(path.join(archiveDir, "logs.txt"), (job._log || []).join("\n") + "\n");
  await fs.cp(projectDir, path.join(archiveDir, "project-source"), { recursive: true });
  await fs.writeFile(path.join(archiveDir, "metadata.json"), metadata(job, spec, true));
  return { artifactPath: archiveDir, kind: "asset-export", simulated: true };
}

function metadata(job, spec, simulated) {
  return JSON.stringify(
    {
      jobId: job.jobId,
      target: job.target,
      engine: "blender",
      experienceId: spec.experienceId,
      title: spec.title,
      objects: spec.counts.entities,
      quests: spec.counts.quests,
      simulated,
      builtAt: new Date().toISOString(),
    },
    null,
    2
  );
}

function runProcess(cmd, args, { cwd, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    child.stdout.on("data", (d) => log(`[blender] ${d.toString().trimEnd()}`));
    child.stderr.on("data", (d) => log(`[blender:err] ${d.toString().trimEnd()}`));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Blender exited with code ${code}`))
    );
  });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
