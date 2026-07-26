'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate object storage before anything reads gatewayConfig().
const TMP_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'optomole-assets-'));
process.env.LOCAL_OBJECT_STORE_PATH = TMP_STORE;

const { AssetProviderRegistry, __test: registryTest } = require('../dist/assets/asset-provider.registry');
const { AssetGenerationService } = require('../dist/assets/asset-generation.service');
const { ExperienceAssetsService } = require('../dist/assets/experience-assets.service');
const { ObjectStorageService } = require('../dist/integrations/object-storage.service');

/**
 * Routing and orchestration.
 *
 * The claim this layer makes is that seven vendors behave as one pipeline: the
 * compiler asks for "a sprite", something sensible answers, and a missing key
 * downgrades the result instead of failing the build. These check that, plus
 * the two properties that cost real money or real correctness — results are
 * cached, and provider bytes are copied into our own storage rather than linked.
 */

/**
 * Provider keys are read per call, so each test controls its own environment.
 *
 * The restore MUST wait for an async body. A plain try/finally around
 * `return run()` restores the environment at the first `await` inside it, which
 * silently un-configured the provider midway through a test — the second call
 * in the caching test then routed to nothing.
 */
function withEnv(vars, run) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  let result;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

const ALL_KEYS_OFF = {
  MESHY_API_KEY: undefined, LUMA_API_KEY: undefined, SKETCHFAB_API_TOKEN: undefined,
  FAL_KEY: undefined, REPLICATE_API_TOKEN: undefined, HF_TOKEN: undefined,
  HUGGINGFACE_API_KEY: undefined, OPENAI_API_KEY: undefined,
  ASSET_PROVIDER_ORDER: undefined, ASSET_GENERATION_ENABLED: undefined,
};

function stubFetch(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const reply = await handler(call);
    return {
      ok: reply.ok !== false,
      status: reply.status || 200,
      headers: { get: (name) => (reply.headers || {})[String(name).toLowerCase()] || null },
      text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? null)),
      // Buffer.buffer is the shared 8KB pool for small buffers, so it must be
      // sliced to the view's own range or the "response" is 8192 bytes long.
      arrayBuffer: async () => {
        const buf = reply.bytes || Buffer.alloc(0);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
    };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

// ---- routing ----

test('3D generation is preferred over 3D retrieval', () => {
  withEnv({ ...ALL_KEYS_OFF, MESHY_API_KEY: 'm', SKETCHFAB_API_TOKEN: 's' }, () => {
    const registry = new AssetProviderRegistry();
    assert.equal(registry.resolve('model3d').id, 'meshy',
      'a synthesized model always matches the prompt; the library only approximates');
    const order = registry.candidatesFor('model3d').map(p => p.id);
    assert.deepEqual(order, ['meshy', 'sketchfab']);
  });
});

test('a configured provider outranks a preferred one with no key', () => {
  withEnv({ ...ALL_KEYS_OFF, SKETCHFAB_API_TOKEN: 's' }, () => {
    const registry = new AssetProviderRegistry();
    assert.equal(registry.resolve('model3d').id, 'sketchfab',
      'Meshy is preferred but unusable, so routing must not stall on it');
  });
});

test('nothing configured means nothing resolves — and that is reported, not thrown', () => {
  withEnv(ALL_KEYS_OFF, () => {
    const registry = new AssetProviderRegistry();
    for (const kind of ['sprite', 'model3d', 'music', 'sfx', 'voice', 'code']) {
      assert.equal(registry.resolve(kind), null, `${kind} has no provider`);
    }
    const capabilities = registry.capabilities();
    assert.equal(capabilities.configuredCount, 0);
    assert.equal(capabilities.byKind.sprite.fallback, 'procedural-placeholder',
      'the honest answer is that placeholder art will be used');
    assert.equal(capabilities.providers.length, 7, 'all seven are still listed, so a key can be added knowingly');
  });
});

test('an explicit provider is honoured only when it can actually serve the kind', () => {
  withEnv({ ...ALL_KEYS_OFF, FAL_KEY: 'f', MESHY_API_KEY: 'm' }, () => {
    const registry = new AssetProviderRegistry();
    assert.equal(registry.resolve('sprite', 'fal').id, 'fal');
    // fal makes images, not 3D: asking for it by name must fall through to a
    // provider that can, rather than failing at request time.
    assert.equal(registry.resolve('model3d', 'fal').id, 'meshy');
    // An unconfigured explicit choice falls through too.
    assert.equal(registry.resolve('sprite', 'luma').id, 'fal');
  });
});

test('kind ordering is per kind, since the best 3D vendor is not the best music vendor', () => {
  assert.ok(registryTest.DEFAULT_ORDER.model3d.includes('meshy'));
  assert.ok(!registryTest.DEFAULT_ORDER.music.includes('meshy'), 'Meshy cannot make music');
  assert.deepEqual(registryTest.DEFAULT_ORDER.voice, ['openai']);
});

test('an operator can re-rank vendors and swap models without a deploy', () => {
  assert.deepEqual(registryTest.parseOrder('sprite:huggingface,fal;model3d:sketchfab'),
    { sprite: ['huggingface', 'fal'], model3d: ['sketchfab'] });
  assert.deepEqual(registryTest.parseOrder('nonsense:x'), {}, 'an unknown kind is ignored, not crashed on');
  assert.deepEqual(registryTest.parseModelMap('sprite=owner/a,music=owner/b'),
    { sprite: 'owner/a', music: 'owner/b' });

  withEnv({ ...ALL_KEYS_OFF, FAL_KEY: 'f', HF_TOKEN: 'h', ASSET_PROVIDER_ORDER: 'sprite:huggingface,fal' }, () => {
    assert.equal(new AssetProviderRegistry().resolve('sprite').id, 'huggingface');
  });
});

// ---- orchestration ----

function service() {
  return new AssetGenerationService(new AssetProviderRegistry(), new ObjectStorageService());
}

test('generation is opt-in: keys alone do not start spending', async () => {
  await withEnv({ ...ALL_KEYS_OFF, HF_TOKEN: 'h' }, async () => {
    const asset = await service().generate({ id: 'player_idle', kind: 'sprite', prompt: 'a hero' });
    assert.equal(asset.status, 'skipped');
    assert.match(asset.error, /ASSET_GENERATION_ENABLED/);
  });
});

test('enabled with no key skips with a reason instead of failing the build', async () => {
  await withEnv({ ...ALL_KEYS_OFF, ASSET_GENERATION_ENABLED: 'true' }, async () => {
    const asset = await service().generate({ id: 'player_idle', kind: 'sprite', prompt: 'a hero' });
    assert.equal(asset.status, 'skipped');
    assert.match(asset.error, /no configured provider/);
  });
});

test('a generated asset is stored by us and addressed by our own url', async () => {
  await withEnv({ ...ALL_KEYS_OFF, ASSET_GENERATION_ENABLED: 'true', HF_TOKEN: 'hf' }, async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const stub = stubFetch(() => ({ headers: { 'content-type': 'image/png' }, bytes: png }));
    try {
      const asset = await service().generate({ id: 'player_idle', kind: 'sprite', prompt: 'a hero' });
      assert.equal(asset.status, 'succeeded');
      assert.equal(asset.providerId, 'huggingface');
      assert.equal(asset.bytes, png.length);
      assert.match(asset.storageKey, /^assets\/sprite\/player_idle-[0-9a-f]+\.png$/);
      assert.ok(asset.url.includes('/v1/objects/'), `expected an Optomole url, got ${asset.url}`);
      assert.ok(!asset.url.includes('huggingface.co'), 'a provider url would expire and 404 later');
    } finally { stub.restore(); }
  });
});

test('a provider url is downloaded, not linked — vendor links expire in minutes', async () => {
  await withEnv({ ...ALL_KEYS_OFF, ASSET_GENERATION_ENABLED: 'true', SKETCHFAB_API_TOKEN: 'sf' }, async () => {
    const glb = Buffer.from('glTF-bytes');
    const stub = stubFetch((call) => {
      if (call.url.includes('/v3/search')) {
        return { body: { results: [{ uid: 'u1', name: 'Crate', user: {}, license: {} }] } };
      }
      if (call.url.includes('/download')) {
        return { body: { glb: { url: 'https://sketchfab.example/expiring.glb', expires: 60 } } };
      }
      return { headers: { 'content-type': 'model/gltf-binary' }, bytes: glb };
    });
    try {
      const asset = await service().generate({ id: 'model-crate', kind: 'model3d', prompt: 'wooden crate' });
      assert.equal(asset.status, 'succeeded');
      assert.ok(stub.calls.some(call => call.url === 'https://sketchfab.example/expiring.glb'),
        'the expiring archive must be fetched while it is still valid');
      assert.equal(asset.bytes, glb.length);
      assert.match(asset.storageKey, /\.glb$/);
    } finally { stub.restore(); }
  });
});

test('an identical request is served from cache, not billed twice', async () => {
  await withEnv({ ...ALL_KEYS_OFF, ASSET_GENERATION_ENABLED: 'true', HF_TOKEN: 'hf' }, async () => {
    const stub = stubFetch(() => ({ headers: { 'content-type': 'image/png' }, bytes: Buffer.from([1, 2, 3]) }));
    try {
      const assets = service();
      const request = { id: 'npc', kind: 'sprite', prompt: 'a guide' };
      const first = await assets.generate(request);
      const second = await assets.generate(request);
      assert.equal(first.cached, undefined);
      assert.equal(second.cached, true);
      assert.equal(second.url, first.url);
      assert.equal(stub.calls.length, 1, 'recompiling an 18-asset bundle must not be 18 fresh calls');
    } finally { stub.restore(); }
  });
});

test('one failing asset does not fail the batch', async () => {
  await withEnv({ ...ALL_KEYS_OFF, ASSET_GENERATION_ENABLED: 'true', HF_TOKEN: 'hf' }, async () => {
    let call = 0;
    const stub = stubFetch(() => {
      call += 1;
      if (call === 2) return { ok: false, status: 503, body: { error: 'model overloaded' } };
      return { headers: { 'content-type': 'image/png' }, bytes: Buffer.from([call]) };
    });
    try {
      const { assets, summary } = await service().generateAll([
        { id: 'a', kind: 'sprite', prompt: 'one' },
        { id: 'b', kind: 'sprite', prompt: 'two' },
        { id: 'c', kind: 'sprite', prompt: 'three' },
      ]);
      assert.equal(assets.length, 3, 'one entry per request, in order');
      assert.equal(summary.requested, 3);
      assert.equal(summary.failed, 1);
      assert.equal(summary.succeeded, 2, 'the rest still generated');
      const failed = assets.find(a => a.status === 'failed');
      assert.match(failed.error, /overloaded/, 'and the reason is reported');
    } finally { stub.restore(); }
  });
});

// ---- the plan derived from compiled content ----

const BUNDLE = {
  game: { title: 'Incident Review', scenes: ['scene-1'] },
  scenes: [
    { id: 'scene-1', name: 'Server Vault', palette: ['#fff', '#2b1216', '#ff4d4d'], ambientIntensity: 0.9 },
    { id: 'scene-2', name: 'Loading Bay', palette: ['#fff', '#2b1216', '#ff4d4d'], ambientIntensity: 0.2 },
  ],
  entities: [
    { id: 'scene-1-player', archetype: 'hero', tags: ['player'] },
    { id: 'scene-1-npc-1', archetype: 'npc', tags: ['npc'], label: 'Dana Reyes' },
    { id: 'scene-1-enemy-1', archetype: 'enemy', tags: ['enemy'] },
  ],
  assets: [
    { spriteId: 'player_idle', role: 'player', shape: 'capsule', width: 0.8, height: 1.8, tint: '#ff5c5c', palette: ['#fff'], tone: 'urgency' },
    { spriteId: 'enemy_idle', role: 'enemy', shape: 'capsule', width: 0.9, height: 1.7, tint: '#e63946', palette: ['#fff'], tone: 'urgency' },
  ],
  validation: { contributions: { enemies: 2 } },
};

test('prompts are derived from the palette and tone the compiler already produced', () => {
  const plan = new ExperienceAssetsService().plan({ bundle: BUNDLE, kinds: ['sprite'] });
  assert.equal(plan.requests.length, 2, 'one request per declared sprite');

  const player = plan.requests.find(r => r.id === 'player_idle');
  assert.match(player.prompt, /player character/, 'the role decides the subject');
  assert.match(player.prompt, /Incident Review/, 'the experience title themes it');
  assert.match(player.prompt, /urgency/, 'the emotional tone carries into the art');
  assert.match(player.prompt, /#ff5c5c/, 'so does the derived colour');
  assert.match(player.prompt, /transparent background/, 'or it will not composite into a scene');
  assert.deepEqual(player.style.palette, BUNDLE.scenes[0].palette);

  const enemy = plan.requests.find(r => r.id === 'enemy_idle');
  assert.notEqual(player.prompt, enemy.prompt, 'different roles must not get the same art');
  assert.notEqual(player.seed, enemy.seed);
});

test('a plan built from REAL compiler output carries tone and a usable colour', () => {
  // This is the test that matters. The hand-written fixture above supplied
  // `tone` on its assets, so it passed while the real pipeline dropped the
  // field entirely — AssetSpec had no `tone`, and every generated sprite lost
  // the emotional direction that makes two documents look different. A fixture
  // cannot catch that; only compiling for real can.
  const { SemanticModelService } = require('../dist/compiler/semantic-model.service');
  const { ExperienceDirectiveService } = require('../dist/compiler/experience-directive.service');
  const { BehaviorCompilerService } = require('../dist/compiler/behavior-compiler.service');
  const { ExperienceBuildService } = require('../dist/compiler/experience-build.service');
  const { GameplayDslService } = require('../dist/compiler/gameplay-dsl.service');

  const pkg = {
    id: 'exp-1',
    experience: { id: 'exp-1', title: 'Incident Review' },
    blueprint: {
      proceduralMap: { locations: [{ id: 'l1', name: 'Server Vault', type: 'lab', description: 'd', hazards: [] }] },
      characters: [{ id: 'c1', name: 'Dana Reyes', role: 'analyst', lines: ['Start with the logs.'] }],
    },
    specification: {
      preprocessing: {
        contentSanitization: { items: [{ id: 's1', title: 'Report', text: 'x'.repeat(300), sourceType: 'text', origin: 'u' }] },
        semanticExtraction: { people: [], places: [], actions: [], learningObjectives: [], relationships: [] },
        emotionalIntelligence: {
          emotions: [{ id: 'e1', emotion: 'fear', score: 9 }],
          emotionArc: { beginning: 'fear', middle: 'urgency', end: 'relief', stages: [] },
        },
        gameplayNormalization: {
          npcs: [{ id: 'n1', name: 'Dana Reyes', role: 'Mentor', trust: 50 }],
          gameplayAtoms: [{ id: 'a1', sourceId: 's1', sourceKind: 'hazard', label: 'Stale keys', gameplayType: 'challenge', salience: 0.8 }],
        },
        storyboard: { scenes: [{ id: 'sc1', order: 0, title: 'The alert', sceneType: 'setup', gameplayAtomIds: [] }] },
        knowledgeGraph: { edges: [] },
      },
    },
  };

  const model = new SemanticModelService().project({ package: pkg, mappingManifest: { bindings: [] } });
  const directives = new ExperienceDirectiveService().resolve({ model, package: pkg });
  const behaviors = new BehaviorCompilerService().compile({ directives, model });
  const build = new ExperienceBuildService().project({ package: pkg, mappingManifest: { bindings: [] } });
  const bundle = new GameplayDslService().compile({ build, behaviors });

  assert.ok(bundle.assets.length > 0, 'the compiler declared a sprite vocabulary');
  assert.ok(bundle.assets.some(asset => asset.tone), 'AssetSpec must carry the tone it was themed with');

  const plan = new ExperienceAssetsService().plan({ bundle, kinds: ['sprite'] });
  const player = plan.requests.find(request => request.id === 'player_idle');
  assert.ok(player, 'the player sprite is planned');
  assert.match(player.prompt, /mood: /, 'the emotional tone reaches the prompt');
  assert.ok(
    !/dominant colour #f{6}/i.test(player.prompt),
    `a white subject on a transparent background is invisible: ${player.prompt}`
  );
  assert.match(player.prompt, /palette #/, 'and the scene palette travels with it');
});

test('near-white and near-black tints are replaced, vivid ones are kept', () => {
  const { __test } = require('../dist/assets/experience-assets.service');
  assert.equal(__test.isVivid('#ffffff'), false);
  assert.equal(__test.isVivid('#000000'), false);
  assert.equal(__test.isVivid('#ff5c5c'), true);
  assert.match(__test.colourGuidance('#ffffff', ['#ffffff', '#3a1720', '#ff5c5c']), /dominant colour #3a1720|#ff5c5c/);
  assert.match(__test.colourGuidance('#ff5c5c', ['#ffffff']), /dominant colour #ff5c5c/);
  assert.equal(__test.colourGuidance('#ffffff', []), '', 'no usable colour means no misleading instruction');
});

test('a sprite keeps its seed across runs, so regenerating one does not reshuffle the rest', () => {
  const first = new ExperienceAssetsService().plan({ bundle: BUNDLE, kinds: ['sprite'] });
  const second = new ExperienceAssetsService().plan({ bundle: BUNDLE, kinds: ['sprite'] });
  assert.deepEqual(first.requests.map(r => r.seed), second.requests.map(r => r.seed));
});

test('music follows each region, sfx follow the events the runtime emits', () => {
  const plan = new ExperienceAssetsService().plan({ bundle: BUNDLE, kinds: ['music', 'sfx'] });
  const music = plan.requests.filter(r => r.kind === 'music');
  assert.equal(music.length, 2, 'one track per region');
  assert.match(music[0].prompt, /urgent and driving/, 'the tense region gets tense music');
  assert.match(music[1].prompt, /calm and sparse/, 'the calm one does not');

  const sfx = plan.requests.filter(r => r.kind === 'sfx').map(r => r.id);
  assert.ok(sfx.includes('sfx-collect') && sfx.includes('sfx-goal'));
  assert.ok(sfx.includes('sfx-attack'), 'a build with enemies needs a strike sound');
});

test('3D and voice are opt-in, because they are the expensive ones', () => {
  const base = new ExperienceAssetsService().plan({ bundle: BUNDLE });
  assert.equal(base.requests.filter(r => r.kind === 'model3d').length, 0);
  assert.equal(base.requests.filter(r => r.kind === 'voice').length, 0);

  const full = new ExperienceAssetsService().plan({ bundle: BUNDLE, kinds: ['model3d'], includeVoice: true });
  assert.ok(full.requests.some(r => r.kind === 'model3d'));
  const voice = full.requests.find(r => r.kind === 'voice');
  assert.match(voice.prompt, /Dana Reyes/, 'the NPC speaks its own name');
});

test('every planned request explains why it exists', () => {
  const plan = new ExperienceAssetsService().plan({ bundle: BUNDLE, kinds: ['sprite', 'music', 'sfx'] });
  for (const request of plan.requests) {
    assert.ok(plan.rationale[request.id], `${request.id} has a stated reason, so a bill is never a surprise`);
  }
});

// ---- folding results back in ----

test('a partial batch upgrades what it can and leaves the rest playable', () => {
  const applied = new ExperienceAssetsService().apply(BUNDLE, [
    { requestId: 'player_idle', kind: 'sprite', providerId: 'fal', status: 'succeeded', url: 'https://opt/a.png', contentType: 'image/png' },
    { requestId: 'enemy_idle', kind: 'sprite', providerId: 'fal', status: 'failed', error: 'nope' },
    { requestId: 'music-scene-1', kind: 'music', providerId: 'fal', status: 'succeeded', url: 'https://opt/m.mp3', contentType: 'audio/mpeg' },
  ]);

  const player = applied.assets.find(a => a.spriteId === 'player_idle');
  const enemy = applied.assets.find(a => a.spriteId === 'enemy_idle');
  assert.equal(player.url, 'https://opt/a.png');
  assert.equal(player.source, 'fal');
  assert.equal(enemy.url, undefined, 'the failed one stays on placeholder art rather than breaking');
  assert.equal(enemy.tint, '#e63946', 'and keeps everything the compiler gave it');

  assert.equal(applied.audio.length, 1, 'audio is added, not substituted');
  assert.equal(applied.validation.contributions.generatedAssets, 2, 'the count is visible like every other contribution');
  assert.equal(applied.validation.contributions.enemies, 2, 'existing contributions survive');
});

test('applying nothing returns the bundle untouched', () => {
  const applied = new ExperienceAssetsService().apply(BUNDLE, [
    { requestId: 'player_idle', kind: 'sprite', providerId: 'fal', status: 'failed', error: 'x' },
  ]);
  assert.equal(applied, BUNDLE, 'no successful asset means no rewrite at all');
});
