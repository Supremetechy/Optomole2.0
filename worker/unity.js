import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { materializeProject } from "./project-generator.js";

// Unity builder.
//
// Generates a real Unity project from the compiled experience, then runs the
// Unity Editor headless (-batchmode -executeMethod) to build a standalone
// player. The generated project ships an Editor build script
// (Assets/Editor/OptomoleBuild.cs) and a runtime bootstrap
// (Assets/Scripts/OptomoleBootstrap.cs) that reads StreamingAssets/experience.json
// and spawns one primitive per compiled entity — so the built player actually
// contains the generated content.
//
// Real build when UNITY_PATH points at a Unity executable; simulation otherwise
// (still writes the real project + placeholder artifacts).
export async function runUnityBuild({ job, workspace, config, log }) {
  const { projectDir, spec } = await materializeProject({
    command: job,
    engine: "unity",
    workspace,
    log,
  });
  const archiveDir = path.join(workspace, "archive");
  await fs.mkdir(archiveDir, { recursive: true });

  const unityPath = config.unityPath;
  const buildTarget = config.unityBuildTarget; // StandaloneOSX | StandaloneWindows64 | StandaloneLinux64
  const canRunUnity = !!unityPath && !config.simulateUnity && (await exists(unityPath));

  if (!canRunUnity) {
    return simulateBuild({ job, spec, projectDir, archiveDir, unityPath, buildTarget, config, log });
  }

  const buildOutput = path.join(archiveDir, "player");
  await fs.mkdir(buildOutput, { recursive: true });
  const logFile = path.join(workspace, "unity-build.log");
  const args = [
    "-batchmode",
    "-nographics",
    "-quit",
    "-projectPath",
    projectDir,
    "-executeMethod",
    "OptomoleBuild.PerformBuild",
    "-buildTarget",
    buildTarget,
    "-optomoleOutput",
    buildOutput,
    "-logFile",
    logFile,
  ];
  log(`Launching Unity: "${unityPath}" ${args.join(" ")}`);
  await runProcess(unityPath, args, { cwd: workspace, log, logFile });
  log("Unity build finished.");

  return { artifactPath: archiveDir, kind: "engine-build", simulated: false };
}

async function simulateBuild({ job, spec, projectDir, archiveDir, unityPath, buildTarget, config, log }) {
  const why = !unityPath
    ? "UNITY_PATH not set"
    : config.simulateUnity
      ? "SIMULATE_UNITY=1"
      : `Unity executable not found at ${unityPath}`;
  log(`Simulating Unity build (${why}).`);
  log(
    `Would run: Unity -batchmode -nographics -quit -projectPath ${projectDir} ` +
      `-executeMethod OptomoleBuild.PerformBuild -buildTarget ${buildTarget} -optomoleOutput <archive>/player`
  );

  const playerDir = path.join(archiveDir, "player");
  await fs.mkdir(playerDir, { recursive: true });
  await fs.writeFile(
    path.join(playerDir, "OptomoleGame.app.txt"),
    `Simulated Unity ${buildTarget} player for "${spec.title}" (job ${job.jobId})\n` +
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
        engine: "unity",
        buildTarget,
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

function runProcess(cmd, args, { cwd, log, logFile }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    child.stdout.on("data", (d) => log(`[unity] ${d.toString().trimEnd()}`));
    child.stderr.on("data", (d) => log(`[unity:err] ${d.toString().trimEnd()}`));
    child.on("error", reject);
    child.on("close", async (code) => {
      // Unity writes most output to -logFile; surface its tail on failure.
      if (code !== 0 && logFile) {
        const tail = await fs.readFile(logFile, "utf8").then((t) => t.split("\n").slice(-40).join("\n")).catch(() => "");
        if (tail) log(`[unity:log-tail]\n${tail}`);
      }
      code === 0 ? resolve() : reject(new Error(`Unity exited with code ${code}`));
    });
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
