import os from "node:os";
import path from "node:path";

// Central runtime config for the Optomole build worker.
// Everything is env-driven so the same binary runs on the Windows builder
// (Computer B, real Unreal) and on a dev machine (simulation mode).
export function workerConfig() {
  const env = process.env;
  return {
    // --- Queue (must match the gateway's BUILD_QUEUE_NAME) ---
    rabbitmqUrl: env.RABBITMQ_URL || "amqp://localhost:5672",
    queueName: env.BUILD_QUEUE_NAME || "optomole.build.jobs",
    prefetch: Number(env.WORKER_PREFETCH || "1"),

    // --- Identity + callback auth (must match gateway WORKER_CALLBACK_TOKEN) ---
    workerId: env.WORKER_ID || `builder-${os.hostname()}`,
    callbackToken: env.WORKER_CALLBACK_TOKEN || "dev-worker-token",
    // Only used to synthesize a callback URL if a job arrives without one.
    apiUrl: env.API_URL || "",

    // --- Unreal ---
    // Root of the UE install, e.g. C:\Program Files\Epic Games\UE_5.4
    uePath: env.UE_PATH || "",
    // Optional pre-built .uproject to package; if unset the generated project is used.
    ueProject: env.UE_PROJECT || "",
    // Force simulation even on a Windows host with UE present (dry run).
    simulate: env.SIMULATE_UNREAL === "1",

    // --- Unity ---
    // Path to the Unity executable, e.g.
    //   macOS:   /Applications/Unity/Hub/Editor/6000.0.30f1/Unity.app/Contents/MacOS/Unity
    //   Windows: C:\Program Files\Unity\Hub\Editor\6000.0.30f1\Editor\Unity.exe
    unityPath: env.UNITY_PATH || "",
    // Player platform: StandaloneOSX | StandaloneWindows64 | StandaloneLinux64.
    unityBuildTarget: env.UNITY_BUILD_TARGET || defaultUnityTarget(),
    simulateUnity: env.SIMULATE_UNITY === "1",

    // --- Blender ---
    // Path to the Blender executable, e.g.
    //   macOS: /Applications/Blender.app/Contents/MacOS/Blender
    blenderPath: env.BLENDER_PATH || "",
    simulateBlender: env.SIMULATE_BLENDER === "1",

    // Root of the engine project scaffolds (templates/<engine>).
    templatesRoot: env.TEMPLATES_ROOT || "",

    // --- Workspace ---
    workspaceRoot: env.WORKSPACE_ROOT || path.join(os.tmpdir(), "optomole-builds"),
    keepWorkspace: env.KEEP_WORKSPACE === "1",

    // --- Object storage (MinIO on Computer A, or real S3 later) ---
    storage: storageConfig(env),
  };
}

// Pick a sane default Unity player platform for the host OS.
function defaultUnityTarget() {
  if (process.platform === "win32") return "StandaloneWindows64";
  if (process.platform === "linux") return "StandaloneLinux64";
  return "StandaloneOSX";
}

function storageConfig(env) {
  // MINIO_ENDPOINT is a bare host in .env (e.g. 192.168.0.69); accept a full
  // URL too so swapping in real S3 later is a one-line env change.
  const raw = env.MINIO_ENDPOINT || "";
  const endpoint = raw
    ? /^https?:\/\//.test(raw)
      ? raw
      : `http://${raw}:${env.MINIO_PORT || "9000"}`
    : "";

  return {
    // Empty endpoint => storage disabled, uploadArtifacts degrades to a no-op
    // so simulation runs on a dev box still complete the callback loop.
    endpoint,
    region: env.MINIO_REGION || env.AWS_REGION || "us-east-1",
    bucket: env.MINIO_BUCKET || "optomole-artifacts",
    accessKey: env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER || "optomole",
    secretKey: env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD || "optomole-dev-password",
    // MinIO needs path-style (bucket in path, not subdomain). Real S3 does not.
    forcePathStyle: env.MINIO_FORCE_PATH_STYLE !== "0",
    // If set, artifacts are addressed by a plain public URL under this base
    // instead of a presigned one (bucket must allow anonymous reads).
    publicBaseUrl: env.MINIO_PUBLIC_BASE_URL || "",
    // Presigned link lifetime. S3 SigV4 caps this at 7 days.
    presignExpirySeconds: Number(env.ARTIFACT_URL_TTL_SECONDS || 7 * 24 * 60 * 60),
    // Skip creating the bucket if the credentials lack CreateBucket rights.
    autoCreateBucket: env.MINIO_AUTO_CREATE_BUCKET !== "0",
  };
}
