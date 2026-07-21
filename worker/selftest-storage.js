// End-to-end check for the MinIO artifact upload.
//
// Builds a fake package directory, runs the real uploadArtifacts(), then fetches
// the returned URL back and verifies the bytes are a genuine zip of the right
// size. Proves the whole path, not just that the code executes.
//
//   node --env-file=../.env selftest-storage.js
//
// Exits non-zero on failure so it can gate a deploy to Computer B.
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { workerConfig } from "./config.js";
import { uploadArtifacts } from "./storage.js";

const config = workerConfig();
const jobId = `selftest-${process.pid}`;
const dir = path.join(os.tmpdir(), `optomole-selftest-${process.pid}`);

function log(msg) {
  console.log(`  ${msg}`);
}

async function main() {
  console.log(`\nMinIO artifact upload self-test`);
  console.log(`  endpoint: ${config.storage.endpoint || "(unset)"}`);
  console.log(`  bucket:   ${config.storage.bucket}\n`);

  if (!config.storage.endpoint) {
    throw new Error("MINIO_ENDPOINT is not set — nothing to test against.");
  }

  // Incompressible payload sized past the 16MB part size, so this exercises the
  // real multipart path rather than collapsing into a single small PUT.
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "Content"), { recursive: true });
  await fs.writeFile(path.join(dir, "game.exe"), randomBytes(24 * 1024 * 1024));
  await fs.writeFile(path.join(dir, "Content", "pak.chunk"), randomBytes(12 * 1024 * 1024));
  await fs.writeFile(path.join(dir, "readme.txt"), `self-test package for ${jobId}\n`);

  const job = { jobId, experienceId: "selftest-exp", target: "unreal", _log: ["line one", "line two"] };
  const result = await uploadArtifacts({ job, artifactPath: dir, config, log });

  console.log(`\n  -> uploaded:   ${result.uploaded}`);
  console.log(`  -> storageKey: ${result.storageKey}`);
  console.log(`  -> bytes:      ${result.bytes}`);
  console.log(`  -> url:        ${String(result.downloadUrl).slice(0, 110)}...\n`);

  if (!result.uploaded) throw new Error("uploadArtifacts reported uploaded=false");
  if (!result.downloadUrl) throw new Error("no downloadUrl returned");

  // Fetch it back — the part that proves the object is really retrievable.
  const res = await fetch(result.downloadUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());

  if (body.length !== result.bytes) {
    throw new Error(`size mismatch: reported ${result.bytes}, downloaded ${body.length}`);
  }
  // Local file header magic — confirms we got a zip, not an XML error document.
  if (body.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error(`downloaded object is not a zip (magic=${body.subarray(0, 4).toString("hex")})`);
  }

  console.log(`PASS — round-tripped ${body.length} bytes, valid zip.\n`);
}

main()
  .catch((err) => {
    console.error(`\nFAIL — ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}));
