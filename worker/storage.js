import { PassThrough } from "node:stream";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import archiver from "archiver";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Artifact upload -> object storage (MinIO on Computer A, real S3 later).
//
// A packaged Unreal build is a directory tree that runs to gigabytes, so the
// zip is streamed straight into a multipart upload rather than staged on disk —
// the builder's disk is already under pressure during a cook.
//
// Layout written per job:
//   jobs/<jobId>/game.zip       the packaged build
//   jobs/<jobId>/logs.txt       build log (small; readable without pulling the zip)
//   jobs/<jobId>/metadata.json  job + artifact provenance
//
// The gateway persists `storageKey`, which is the durable handle. `downloadUrl`
// is a convenience for the immediate response and, in presigned mode, expires —
// see resolveUrl() below.
export async function uploadArtifacts({ job, artifactPath, config, log }) {
  const storage = config.storage;
  const prefix = `jobs/${job.jobId}`;
  const storageKey = `${prefix}/game.zip`;

  if (!storage.endpoint) {
    const viaGateway = await uploadToGateway({ job, artifactPath, config, log });
    if (viaGateway) return viaGateway;
    log(`[storage] MINIO_ENDPOINT not set and no gateway fallback — skipping upload (artifacts remain at ${artifactPath}).`);
    return { uploaded: false, storageKey, downloadUrl: undefined, launchUrl: undefined };
  }

  const client = new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    forcePathStyle: storage.forcePathStyle,
    credentials: { accessKeyId: storage.accessKey, secretAccessKey: storage.secretKey },
  });

  try {
    await ensureBucket({ client, storage, log });

    // --- game.zip (streamed) ---
    log(`[storage] zipping ${artifactPath} -> s3://${storage.bucket}/${storageKey}`);
    const { bytes } = await uploadZipStream({
      client,
      bucket: storage.bucket,
      key: storageKey,
      sourceDir: artifactPath,
      log,
    });
    log(`[storage] uploaded game.zip (${formatBytes(bytes)})`);

    const previewAsset = await findPreviewAsset(artifactPath);
    let preview = null;
    if (previewAsset) {
      const previewPath = path.relative(artifactPath, previewAsset).replace(/\\/g, "/");
      const previewKey = `${prefix}/preview/${previewPath}`;
      log(`[storage] uploading glTF preview ${path.relative(artifactPath, previewAsset)} -> s3://${storage.bucket}/${previewKey}`);
      await uploadFile({
        client,
        bucket: storage.bucket,
        key: previewKey,
        filePath: previewAsset,
        contentType: contentTypeForPreview(previewAsset),
      });
      if (/\.gltf$/i.test(previewAsset)) {
        await uploadGltfSiblings({ client, bucket: storage.bucket, sourceDir: path.dirname(previewAsset), keyPrefix: path.dirname(previewKey), log });
      }
      preview = {
        path: previewPath,
        storageKey: previewKey,
        url: await resolveUrl({ client, storage, key: previewKey }),
      };
    }

    // --- logs.txt + metadata.json (small, best-effort) ---
    const logsKey = `${prefix}/logs.txt`;
    const metadataKey = `${prefix}/metadata.json`;
    const metadata = {
      jobId: job.jobId,
      experienceId: job.experienceId,
      target: job.target,
      workerId: config.workerId,
      archiveBytes: bytes,
      uploadedAt: new Date().toISOString(),
    };

    // Best-effort: a failed sidecar must not fail a build whose zip is already up.
    await Promise.all([
      putText({
        client,
        bucket: storage.bucket,
        key: logsKey,
        body: (job._log || []).join("\n") + "\n",
        contentType: "text/plain; charset=utf-8",
      }).catch((e) => log(`[storage] warn: logs.txt upload failed: ${e.message}`)),
      putText({
        client,
        bucket: storage.bucket,
        key: metadataKey,
        body: JSON.stringify(metadata, null, 2),
        contentType: "application/json",
      }).catch((e) => log(`[storage] warn: metadata.json upload failed: ${e.message}`)),
    ]);

    const downloadUrl = await resolveUrl({ client, storage, key: storageKey });

    return {
      uploaded: true,
      storageKey,
      downloadUrl,
      launchUrl: undefined, // engine builds are downloads, not launchable URLs
      bytes,
      logsKey,
      metadataKey,
      preview,
    };
  } catch (err) {
    // Storage failed. Rather than fail an otherwise-successful build, try the
    // gateway object store as a fallback (covers unreachable AND flaky/timing-out
    // MinIO, e.g. a stale LAN endpoint that hangs the socket). If that works, the
    // build is still downloadable. Only when the fallback also fails do we either
    // degrade to skip-upload (plain connection error) or surface a genuine error.
    log(`[storage] MinIO upload failed (${err.code || err.name || err.message}) — trying gateway fallback.`);
    const viaGateway = await uploadToGateway({ job, artifactPath, config, log });
    if (viaGateway) return viaGateway;
    if (isConnectionError(err)) {
      log(`[storage] MinIO unreachable and no gateway fallback — skipping upload; artifacts remain at ${artifactPath}.`);
      return { uploaded: false, storageKey, downloadUrl: undefined, launchUrl: undefined };
    }
    throw err;
  } finally {
    client.destroy();
  }
}

/** Zip a directory tree into an in-memory Buffer (archiver, max compression). */
function zipDirToBuffer(sourceDir) {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks = [];
    archive.on("data", (c) => chunks.push(c));
    archive.on("warning", (w) => { if (w.code !== "ENOENT") reject(w); });
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * No-MinIO fallback: zip the build and push it to the gateway object store
 * (POST /v1/workers/artifacts/<jobId>), returning a durable /v1/objects download
 * URL. Returns null (caller degrades to skip-upload) when no gateway is
 * configured or the upload fails, so a storage hiccup never fails a good build.
 */
async function uploadToGateway({ job, artifactPath, config, log }) {
  const base = (config.gatewayUrl || "").replace(/\/$/, "");
  if (!base) return null;
  try {
    const zip = await zipDirToBuffer(artifactPath);
    const url = `${base}/v1/workers/artifacts/${encodeURIComponent(job.jobId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.callbackToken}`, "Content-Type": "application/zip" },
      body: zip,
    });
    if (!res.ok) {
      log(`[storage] gateway artifact upload failed (${res.status}) — leaving artifacts on local disk.`);
      return null;
    }
    const data = await res.json().catch(() => ({}));
    log(`[storage] uploaded game.zip to gateway (${formatBytes(zip.length)}) -> ${data.url}`);
    return { uploaded: true, storageKey: data.key || `jobs/${job.jobId}/game.zip`, downloadUrl: data.url, launchUrl: undefined, bytes: zip.length };
  } catch (e) {
    log(`[storage] gateway artifact upload error (${e.message}) — leaving artifacts on local disk.`);
    return null;
  }
}

/** True for network-level failures where the store never answered (vs. a real 4xx/5xx). */
function isConnectionError(err) {
  const code = err?.code || err?.cause?.code || '';
  const name = err?.name || '';
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE'].includes(code)) return true;
  if (name === 'TimeoutError') return true;
  return /socket hang up|timed? ?out|network|ECONNRESET/i.test(String(err?.message || ''));
}

// HeadBucket is the cheap existence check; only fall through to CreateBucket on
// a genuine 404 so a permissions problem surfaces as itself rather than as a
// confusing "bucket already owned by you".
async function ensureBucket({ client, storage, log }) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
    return;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status !== 404 && err?.name !== "NotFound" && err?.name !== "NoSuchBucket") throw err;
  }

  if (!storage.autoCreateBucket) {
    throw new Error(`bucket "${storage.bucket}" does not exist and MINIO_AUTO_CREATE_BUCKET=0`);
  }
  log(`[storage] creating bucket "${storage.bucket}"`);
  try {
    await client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
  } catch (err) {
    // Harmless race when several workers finish at once.
    if (err?.name !== "BucketAlreadyOwnedByYou" && err?.name !== "BucketAlreadyExists") throw err;
  }
}

// Pipes archiver -> PassThrough -> multipart Upload. Nothing large touches disk.
function uploadZipStream({ client, bucket, key, sourceDir, log }) {
  return new Promise((resolve, reject) => {
    const pass = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 6 } });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      pass.destroy();
      reject(err);
    };

    archive.on("warning", (err) => {
      // ENOENT here means a file vanished mid-archive — treat as fatal, since a
      // silently truncated game.zip is worse than a failed build.
      if (err.code === "ENOENT") fail(err);
      else log(`[storage] archive warning: ${err.message}`);
    });
    archive.on("error", fail);

    const upload = new Upload({
      client,
      params: { Bucket: bucket, Key: key, Body: pass, ContentType: "application/zip" },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
    });

    // Log every 100MB rather than every part — UE packages produce a lot of parts.
    let lastMark = -1;
    upload.on("httpUploadProgress", (p) => {
      if (!p.loaded) return;
      const mark = Math.floor(p.loaded / (100 * 1024 * 1024));
      if (mark > lastMark) {
        lastMark = mark;
        log(`[storage] uploaded ${formatBytes(p.loaded)}...`);
      }
    });

    archive.pipe(pass);
    archive.directory(sourceDir, false);
    archive.finalize().catch(fail);

    upload
      .done()
      .then(() => {
        if (settled) return;
        settled = true;
        resolve({ bytes: archive.pointer() });
      })
      .catch(fail);
  });
}

async function putText({ client, bucket, key, body, contentType }) {
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
  });
  await upload.done();
}

async function uploadFile({ client, bucket, key, filePath, contentType }) {
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: createReadStream(filePath), ContentType: contentType },
  });
  await upload.done();
}

async function findPreviewAsset(root) {
  const files = await walk(root);
  const candidates = files.filter((file) => /\.(glb|gltf)$/i.test(file));
  if (!candidates.length) return null;
  const scored = candidates.map((file) => {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    let score = 0;
    if (/^Assets\/StreamingAssets\//i.test(rel)) score += 100;
    if (/(^|\/)StreamingAssets\//i.test(rel)) score += 80;
    if (/^experience\.glb$/i.test(rel) || /^experience\.gltf$/i.test(rel)) score += 70;
    if (/\.glb$/i.test(rel)) score += 10;
    return { file, score };
  });
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return scored[0].file;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(fullPath));
    else out.push(fullPath);
  }
  return out;
}

function contentTypeForPreview(filePath) {
  return /\.glb$/i.test(filePath) ? "model/gltf-binary" : "model/gltf+json";
}

async function uploadGltfSiblings({ client, bucket, sourceDir, keyPrefix, log }) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  const siblingFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(sourceDir, entry.name))
    .filter((file) => /\.(bin|png|jpg|jpeg|webp|ktx2)$/i.test(file));

  await Promise.all(siblingFiles.map((file) => uploadFile({
    client,
    bucket,
    key: `${keyPrefix}/${path.basename(file)}`,
    filePath: file,
    contentType: contentTypeForDependency(file),
  }).catch((error) => log(`[storage] warn: glTF dependency upload failed for ${path.basename(file)}: ${error.message}`))));
}

function contentTypeForDependency(filePath) {
  if (/\.bin$/i.test(filePath)) return "application/octet-stream";
  if (/\.png$/i.test(filePath)) return "image/png";
  if (/\.jpe?g$/i.test(filePath)) return "image/jpeg";
  if (/\.webp$/i.test(filePath)) return "image/webp";
  if (/\.ktx2$/i.test(filePath)) return "image/ktx2";
  return "application/octet-stream";
}

// Public mode returns a stable URL; presigned mode returns an expiring one.
// Either way `storageKey` is what the gateway should persist — for a permanent
// link it can re-sign from the key on demand.
async function resolveUrl({ client, storage, key }) {
  if (storage.publicBaseUrl) {
    return `${storage.publicBaseUrl.replace(/\/$/, "")}/${storage.bucket}/${key}`;
  }
  return getSignedUrl(client, new GetObjectCommand({ Bucket: storage.bucket, Key: key }), {
    expiresIn: Math.min(storage.presignExpirySeconds, 7 * 24 * 60 * 60),
  });
}

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
