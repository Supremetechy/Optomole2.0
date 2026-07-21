import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { materializeProject } from "./project-generator.js";

// Unreal builder.
//
// Generates a real UE C++ project from the compiled experience (via
// project-generator), then runs UE's command-line cook + package
// (RunUAT BuildCookRun). On the Windows builder with UE_PATH set it performs a
// genuine cook; on any other host (or when UE is unavailable) it falls back to a
// simulated package — but the generated project on disk is real either way, so
// the spec->project step is always exercised.
export async function runUnrealBuild({ job, workspace, config, log }) {
  const { projectDir, spec } = await materializeProject({
    command: job,
    engine: "unreal",
    workspace,
    log,
  });
  const uproject = path.join(projectDir, "OptomoleGame.uproject");
  const archiveDir = path.join(workspace, "archive");
  await fs.mkdir(archiveDir, { recursive: true });

  const runUat = config.uePath
    ? path.join(config.uePath, "Engine", "Build", "BatchFiles", "RunUAT.bat")
    : "";
  const canRunUnreal =
    process.platform === "win32" && !!runUat && !config.simulate && (await exists(runUat));

  if (!canRunUnreal) {
    return simulateBuild({ job, spec, projectDir, archiveDir, runUat, config, log });
  }

  const args = [
    "BuildCookRun",
    `-project=${uproject}`,
    "-noP4",
    "-platform=Win64",
    "-clientconfig=Development",
    "-build",
    "-cook",
    "-stage",
    "-pak",
    "-archive",
    `-archivedirectory=${archiveDir}`,
  ];
  log(`Launching Unreal: "${runUat}" ${args.join(" ")}`);
  await runProcess(runUat, args, { cwd: workspace, log });
  log("Unreal BuildCookRun finished.");

  return { artifactPath: archiveDir, kind: "engine-build", simulated: false };
}

async function simulateBuild({ job, spec, projectDir, archiveDir, runUat, config, log }) {
  const why =
    process.platform !== "win32"
      ? `host is ${process.platform} — Unreal requires Windows`
      : config.simulate
        ? "SIMULATE_UNREAL=1"
        : !config.uePath
          ? "UE_PATH not set"
          : `RunUAT.bat not found at ${runUat}`;
  log(`Simulating Unreal build (${why}).`);
  const shownUat = runUat || "<UE_PATH>\\Engine\\Build\\BatchFiles\\RunUAT.bat";
  log(
    `Would run: "${shownUat}" BuildCookRun -project=${path.join(projectDir, "OptomoleGame.uproject")} ` +
      `-build -cook -stage -pak -archive -archivedirectory=${archiveDir}`
  );

  // Placeholder package outputs, plus a copy of the generated project source so
  // the artifact is inspectable (proves the spec->project step ran).
  await fs.writeFile(
    path.join(archiveDir, "OptomoleGame.exe.txt"),
    `Simulated Unreal package for "${spec.title}" (job ${job.jobId})\n` +
      `Entities: ${spec.counts.entities}, Quests: ${spec.counts.quests}, Genre: ${spec.genre?.title}\n`
  );
  await fs.writeFile(path.join(archiveDir, "logs.txt"), (job._log || []).join("\n") + "\n");
  await fs.cp(projectDir, path.join(archiveDir, "project-source"), { recursive: true });
  await fs.writeFile(
    path.join(archiveDir, "metadata.json"),
    JSON.stringify(
      {
        jobId: job.jobId,
        target: job.target,
        engine: "unreal",
        experienceId: spec.experienceId,
        title: spec.title,
        entities: spec.counts.entities,
        quests: spec.counts.quests,
        simulated: true,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  return { artifactPath: archiveDir, kind: "engine-build", simulated: true };
}

function runProcess(cmd, args, { cwd, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true });
    child.stdout.on("data", (d) => log(`[unreal] ${d.toString().trimEnd()}`));
    child.stderr.on("data", (d) => log(`[unreal:err] ${d.toString().trimEnd()}`));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`RunUAT exited with code ${code}`))
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
