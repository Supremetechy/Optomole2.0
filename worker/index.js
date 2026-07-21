import amqp from "amqplib";
import { promises as fs } from "node:fs";
import path from "node:path";
import { workerConfig } from "./config.js";
import { runUnrealBuild } from "./unreal.js";
import { runUnityBuild } from "./unity.js";
import { runBlenderExport } from "./blender.js";
import { uploadArtifacts } from "./storage.js";
import { reportSucceeded, reportFailed } from "./callback.js";

// Target -> builder dispatch. Each builder generates a real engine project from
// the compiled experience and invokes the engine's CLI (or simulates when the
// engine isn't installed). Browser/mobile/pixijs never reach the worker — the
// gateway serves those inline.
const BUILDERS = {
  unreal: runUnrealBuild,
  unity: runUnityBuild,
  blender: runBlenderExport,
};

// Optomole Build Worker (Computer B).
// Consumes BuildCommand jobs from RabbitMQ, invokes the engine's CLI build
// tools, uploads artifacts, and reports terminal status back to the gateway.

const config = workerConfig();

async function processJob(command, { ack, nack }) {
  const jobId = command.jobId;
  const logs = [];
  const log = (msg) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(`(${jobId ?? "?"}) ${msg}`);
  };

  const callbackUrl = command.callbackUrl || fallbackCallbackUrl(command);
  const workspace = path.join(config.workspaceRoot, jobId || "unknown");

  try {
    if (!jobId) throw new Error("job is missing jobId");
    const target = String(command.target || "").toLowerCase();
    const builder = BUILDERS[target];
    if (!builder) {
      throw new Error(
        `No builder for target "${command.target}". Supported: ${Object.keys(BUILDERS).join(", ")}.`
      );
    }
    log(`Picked up ${target} build for experience ${command.experienceId}`);
    await fs.mkdir(workspace, { recursive: true });

    // --- Build: generate a real engine project from the spec, then cook/export
    // (simulates when the engine binary is absent) ---
    const job = { ...command, _log: logs };
    const build = await builder({ job, workspace, config, log });
    log(`${target} build ${build.simulated ? "simulated" : "completed"} -> ${build.artifactPath}`);

    // --- Upload artifacts (stubbed for now) ---
    const stored = await uploadArtifacts({ job, artifactPath: build.artifactPath, config, log });

    // --- Report success ---
    await reportSucceeded(callbackUrl, config.callbackToken, {
      jobId,
      workerId: config.workerId,
      artifactUrl: stored.downloadUrl,
      launchUrl: stored.launchUrl,
      storageKey: stored.storageKey,
      metadata: {
        simulated: build.simulated,
        uploaded: stored.uploaded,
        kind: build.kind,
        target: command.target,
        experienceId: command.experienceId,
        templateId: command.mappingManifest?.templateId || command.template?.id || null,
        domain: command.package?.progression?.domain || null,
        xpReward: command.package?.progression?.xpReward || null,
        previewUrl: stored.preview?.url || null,
        previewStorageKey: stored.preview?.storageKey || null,
        previewAssetPath: stored.preview?.path || null,
        mechanics: command.package?.runtimeContract?.template?.mechanics || [],
        skillCount: command.package?.progression?.skillTree?.length || command.package?.blueprint?.skillTree?.length || 0,
        mapLocationCount: command.package?.blueprint?.proceduralMap?.locations?.length || command.package?.runtimeContract?.map?.locations?.length || 0,
        logTail: logs.slice(-20),
      },
    });
    log("Reported success to gateway.");
    ack();
  } catch (err) {
    console.error(`(${jobId ?? "?"}) build failed:`, err);
    try {
      await reportFailed(callbackUrl, config.callbackToken, {
        jobId,
        workerId: config.workerId,
        error: err?.stack || String(err),
      });
    } catch (cbErr) {
      console.error(`(${jobId ?? "?"}) also failed to report failure:`, cbErr);
    }
    // Failure already reported — do not requeue (avoids poison-message loops).
    nack(false);
  } finally {
    if (!config.keepWorkspace) {
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function fallbackCallbackUrl(command) {
  if (!config.apiUrl) return "";
  const base = config.apiUrl.replace(/\/$/, "");
  return `${base}/v1/workers/${encodeURIComponent(command.target || "unreal")}/callback`;
}

async function main() {
  console.log(`Optomole build worker "${config.workerId}" starting`);
  console.log(`  queue:     ${config.queueName} @ ${config.rabbitmqUrl}`);
  console.log(`  workspace: ${config.workspaceRoot}`);
  const realUnreal = process.platform === "win32" && config.uePath && !config.simulate;
  console.log(`  unreal:    ${realUnreal ? config.uePath : "SIMULATION MODE"}`);
  console.log(`  unity:     ${config.unityPath && !config.simulateUnity ? `${config.unityPath} (${config.unityBuildTarget})` : "SIMULATION MODE"}`);
  console.log(`  blender:   ${config.blenderPath && !config.simulateBlender ? config.blenderPath : "SIMULATION MODE"}`);

  const conn = await amqp.connect(config.rabbitmqUrl);
  const ch = await conn.createChannel();
  await ch.assertQueue(config.queueName, { durable: true });
  ch.prefetch(config.prefetch);
  console.log(`Waiting for build jobs on "${config.queueName}"...`);

  ch.consume(
    config.queueName,
    (msg) => {
      if (!msg) return;
      let command;
      try {
        command = JSON.parse(msg.content.toString("utf8"));
      } catch (e) {
        console.error("Dropping unparseable message:", e.message);
        ch.nack(msg, false, false);
        return;
      }
      processJob(command, {
        ack: () => ch.ack(msg),
        nack: (requeue) => ch.nack(msg, false, requeue),
      });
    },
    { noAck: false }
  );

  const shutdown = async (sig) => {
    console.log(`\n${sig} received — shutting down...`);
    try {
      await ch.close();
      await conn.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Worker fatal:", err);
  process.exit(1);
});
