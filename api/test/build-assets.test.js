'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate object storage before anything reads gatewayConfig().
const TMP_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'optomole-build-assets-'));
process.env.LOCAL_OBJECT_STORE_PATH = TMP_STORE;
// 'memory' is the mode that actually stores bytes locally; anything else hands
// back CDN URLs for a bucket this test has no business writing to.
process.env.OBJECT_STORAGE_MODE = 'memory';
process.env.BUILD_QUEUE_MODE = 'memory';

const { BuildsService } = require('../dist/builds/builds.service');
const { QueueService } = require('../dist/integrations/queue.service');
const { ObjectStorageService } = require('../dist/integrations/object-storage.service');
const { TemplatesService } = require('../dist/templates/templates.service');
const { ExperienceBuildService } = require('../dist/compiler/experience-build.service');
const { SemanticModelService } = require('../dist/compiler/semantic-model.service');
const { ExperienceDirectiveService } = require('../dist/compiler/experience-directive.service');
const { BehaviorCompilerService } = require('../dist/compiler/behavior-compiler.service');
const { GameplayDslService } = require('../dist/compiler/gameplay-dsl.service');
const { ExperienceAssetsService } = require('../dist/assets/experience-assets.service');
const { AssetGenerationService } = require('../dist/assets/asset-generation.service');

/**
 * The join between the content compiler and the asset pipeline.
 *
 * Until this was wired, `api/src/assets` was a complete subsystem no build ever
 * called: every generated experience shipped flat-colour placeholder art no
 * matter how many vendor keys were configured. These guard the two halves of
 * fixing that — the build now asks for assets, and asking never costs it its
 * playability when the answer is "no".
 */

/** A package shaped like one the preprocessing pipeline produces. */
function samplePackage() {
  return {
    id: 'exp-assets',
    experience: { id: 'exp-assets', title: 'Containment Drill' },
    blueprint: {
      proceduralMap: {
        regionName: 'Reactor Deck',
        locations: [
          { id: 'loc-1', name: 'Coolant Bay', type: 'lab', description: 'Coolant Bay description' },
          { id: 'loc-2', name: 'Service Corridor', type: 'field', description: 'Service Corridor description' },
        ],
      },
      quests: [{ id: 'q-1', title: 'Restore coolant flow', summary: 'Bring the loop back online.' }],
    },
    specification: {},
    progression: { domain: 'operations' },
  };
}

/** A provider that always succeeds inline, so no network is touched. */
function stubProvider(kinds) {
  return {
    id: 'stub',
    label: 'Stub',
    kinds,
    configured: () => true,
    async submit(request) {
      return {
        providerId: 'stub',
        requestId: request.id,
        kind: request.kind,
        externalId: null,
        status: 'succeeded',
        output: { bytes: Buffer.from(`bytes-for-${request.id}`), contentType: 'image/png' },
      };
    },
    async poll(job) {
      return job;
    },
  };
}

/** Registry stand-in: routes every kind the stub claims, nothing else. */
function stubRegistry(provider) {
  return {
    all: () => [provider],
    byId: () => provider,
    candidatesFor: (kind) => (provider.kinds.includes(kind) ? [provider] : []),
    resolve: (kind) => (provider.kinds.includes(kind) ? provider : null),
    capabilities: () => ({
      providers: [{ id: provider.id, label: provider.label, kinds: provider.kinds, configured: true }],
      configuredCount: 1,
      byKind: {},
    }),
  };
}

/** One storage instance shared by the build, the pipeline, and the read-back. */
const storage = new ObjectStorageService();

function buildsServiceWith(generation) {
  return new BuildsService(
    new QueueService(),
    storage,
    new TemplatesService(),
    new ExperienceBuildService(),
    new SemanticModelService(),
    new ExperienceDirectiveService(),
    new BehaviorCompilerService(),
    new GameplayDslService(),
    new ExperienceAssetsService(),
    generation,
  );
}

/** The manifest a browser build actually wrote, read back out of storage. */
function storedManifest(build) {
  const key = decodeURIComponent(build.downloadUrl.split('/v1/objects/')[1]);
  const stored = storage.getObject(key);
  assert.ok(stored, `no stored manifest at ${key}`);
  return JSON.parse(stored.body);
}

test('a browser build carries generated art keyed by the runtime role it replaces', async () => {
  const generation = new AssetGenerationService(stubRegistry(stubProvider(['sprite', 'music', 'sfx'])), new ObjectStorageService());
  const builds = buildsServiceWith(generation);

  const previous = process.env.ASSET_GENERATION_ENABLED;
  process.env.ASSET_GENERATION_ENABLED = 'true';
  try {
    const build = await builds.createBuild({ package: samplePackage(), target: 'browser' });
    assert.equal(build.status, 'succeeded');

    const { manifest } = storedManifest(build);
    const generated = manifest.generatedAssets;
    assert.ok(generated, 'the manifest must carry a generatedAssets block');
    assert.ok(generated.summary.succeeded > 0, 'at least one asset should have been generated');

    // Keyed by ROLE, not sprite id: the runtime's procedural pack is addressed
    // by role, so a per-id map would never match anything it draws.
    const roles = Object.keys(generated.sprites);
    assert.ok(roles.length > 0, 'generated sprites must be present');
    for (const role of roles) {
      assert.match(role, /^(player|enemy|npc|item|goal|terrain|prop)$/, `unexpected sprite role "${role}"`);
      assert.match(generated.sprites[role], /\/v1\/objects\//, 'art must be re-hosted, never a vendor URL');
    }
  } finally {
    if (previous === undefined) delete process.env.ASSET_GENERATION_ENABLED;
    else process.env.ASSET_GENERATION_ENABLED = previous;
  }
});

test('with no providers configured the build still succeeds on placeholder art', async () => {
  const generation = new AssetGenerationService(
    { ...stubRegistry(stubProvider([])), capabilities: () => ({ providers: [], configuredCount: 0, byKind: {} }) },
    new ObjectStorageService(),
  );
  const builds = buildsServiceWith(generation);

  const build = await builds.createBuild({ package: samplePackage(), target: 'browser' });

  assert.equal(build.status, 'succeeded');
  assert.ok(build.launchUrl, 'a playable URL is the point of the build; it must survive an empty pipeline');

  const { manifest } = storedManifest(build);
  assert.deepEqual(manifest.generatedAssets.sprites, {});
  assert.equal(manifest.generatedAssets.summary, null);
  assert.ok(
    build.logs.some((line) => line.includes('Asset generation skipped')),
    'a skipped pipeline must be visible in the build log, not silent',
  );
});

test('a browser build exposes its Gameplay DSL bundle for RuntimeCore adapters', async () => {
  const generation = new AssetGenerationService(
    { ...stubRegistry(stubProvider([])), capabilities: () => ({ providers: [], configuredCount: 0, byKind: {} }) },
    new ObjectStorageService(),
  );
  const builds = buildsServiceWith(generation);

  const build = await builds.createBuild({ package: samplePackage(), target: 'browser' });

  assert.ok(build.bundleId, 'the build must name its DSL bundle');
  assert.match(build.bundleUrl, /\/v1\/compiler\/gameplay-dsl\//);
});
