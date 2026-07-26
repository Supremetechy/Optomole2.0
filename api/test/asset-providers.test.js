'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MeshyProvider } = require('../dist/assets/providers/meshy.provider');
const { LumaProvider } = require('../dist/assets/providers/luma.provider');
const { SketchfabProvider } = require('../dist/assets/providers/sketchfab.provider');
const { FalProvider, DEFAULT_FAL_MODELS } = require('../dist/assets/providers/fal.provider');
const { ReplicateProvider, DEFAULT_REPLICATE_MODELS } = require('../dist/assets/providers/replicate.provider');
const { HuggingFaceProvider } = require('../dist/assets/providers/huggingface.provider');
const { OpenAiAssetProvider } = require('../dist/assets/providers/openai.provider');

/**
 * Provider contracts.
 *
 * Seven vendors, seven different opinions about auth headers, request bodies,
 * status vocabularies, and where the result URL lives. None of that is
 * verifiable by reading our own code, and none of it can be exercised without
 * paid API keys — so these drive each provider against a stubbed transport and
 * assert the exact HTTP it emits, plus how it reads each vendor's replies.
 *
 * A wrong auth scheme (fal uses `Key`, not `Bearer`) or a missed status value
 * fails here rather than at a customer's first build.
 */

/** Replace global fetch with a scripted responder that records every call. */
function stubFetch(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
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

const request = (over = {}) => ({ id: 'player_idle', kind: 'sprite', prompt: 'a hero', ...over });

// ---- Meshy: text-to-3D, two-stage, SUCCEEDED + model_urls ----

test('meshy posts to the v2 text-to-3d endpoint with a bearer key', async () => {
  const stub = stubFetch(() => ({ body: { result: 'task-1' } }));
  try {
    const job = await new MeshyProvider(() => 'msy_key').submit(request({ kind: 'model3d', prompt: 'a crate' }));
    const call = stub.calls[0];
    assert.equal(call.url, 'https://api.meshy.ai/openapi/v2/text-to-3d');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.Authorization, 'Bearer msy_key');
    assert.equal(call.body.mode, 'preview', 'geometry is generated before it is textured');
    assert.equal(call.body.prompt, 'a crate');
    assert.equal(job.externalId, 'task-1');
    assert.equal(job.status, 'queued');
  } finally { stub.restore(); }
});

test('meshy reads SUCCEEDED into a glb url with the other formats as alternates', async () => {
  const stub = stubFetch(() => ({
    body: { status: 'SUCCEEDED', model_urls: { glb: 'https://cdn/x.glb', fbx: 'https://cdn/x.fbx' } },
  }));
  try {
    const provider = new MeshyProvider(() => 'k');
    const done = await provider.poll({ providerId: 'meshy', requestId: 'm', kind: 'model3d', externalId: 't1', status: 'queued' });
    assert.equal(done.status, 'succeeded');
    assert.equal(done.output.url, 'https://cdn/x.glb');
    assert.equal(done.output.contentType, 'model/gltf-binary');
    assert.deepEqual(done.output.alternates, [{ format: 'fbx', url: 'https://cdn/x.fbx' }]);
  } finally { stub.restore(); }
});

test('meshy in progress stays running; a failed task reports why', async () => {
  let reply = { body: { status: 'IN_PROGRESS' } };
  const stub = stubFetch(() => reply);
  try {
    const provider = new MeshyProvider(() => 'k');
    const job = { providerId: 'meshy', requestId: 'm', kind: 'model3d', externalId: 't1', status: 'queued' };
    assert.equal((await provider.poll(job)).status, 'running');

    reply = { body: { status: 'FAILED', task_error: { message: 'prompt rejected' } } };
    const failed = await provider.poll(job);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /prompt rejected/);
  } finally { stub.restore(); }
});

// ---- fal: queue endpoints, `Key` auth, COMPLETED != succeeded ----

test('fal authenticates with Key (not Bearer) and submits to the queue host', async () => {
  const stub = stubFetch(() => ({ body: { request_id: 'r1', status_url: 'https://queue.fal.run/s', response_url: 'https://queue.fal.run/r' } }));
  try {
    const provider = new FalProvider(() => 'fal_key', () => DEFAULT_FAL_MODELS);
    const job = await provider.submit(request());
    const call = stub.calls[0];
    assert.equal(call.headers.Authorization, 'Key fal_key', 'fal rejects Bearer');
    assert.ok(call.url.startsWith('https://queue.fal.run/'), `submitted to ${call.url}`);
    assert.equal(job.externalId, 'r1');
    assert.equal(job.pollUrl, 'https://queue.fal.run/s');
  } finally { stub.restore(); }
});

test('fal only fetches the result once the queue reports COMPLETED', async () => {
  const replies = [
    { body: { status: 'IN_QUEUE' } },
    { body: { status: 'COMPLETED', response_url: 'https://queue.fal.run/r' } },
    { body: { images: [{ url: 'https://cdn/out.png' }] } },
  ];
  let index = 0;
  const stub = stubFetch(() => replies[index++]);
  try {
    const provider = new FalProvider(() => 'k', () => DEFAULT_FAL_MODELS);
    const job = { providerId: 'fal', requestId: 'a', kind: 'sprite', externalId: 'r1', status: 'queued', pollUrl: 'https://queue.fal.run/s' };

    assert.equal((await provider.poll(job)).status, 'running', 'IN_QUEUE is not done');
    assert.equal(stub.calls.length, 1, 'and it did not fetch a result yet');

    const done = await provider.poll(job);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.output.url, 'https://cdn/out.png');
  } finally { stub.restore(); }
});

test('fal result parsing finds the file url whatever the model wrapped it in', async () => {
  const { __test } = require('../dist/assets/providers/fal.provider');
  assert.equal(__test.firstFileUrl({ images: [{ url: 'https://a/x.png' }] }), 'https://a/x.png');
  assert.equal(__test.firstFileUrl({ audio: { url: 'https://a/x.mp3' } }), 'https://a/x.mp3');
  assert.equal(__test.firstFileUrl({ audio_file: { url: 'https://a/x.wav' } }), 'https://a/x.wav');
  assert.equal(__test.firstFileUrl({ nothing: 'here' }), null, 'a payload with no file is not a false positive');
});

// ---- Replicate: official-model route vs community version hash ----

test('replicate uses the model route for a slug and /predictions for a version hash', async () => {
  const stub = stubFetch(() => ({ body: { id: 'p1', status: 'starting', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } } }));
  try {
    const provider = new ReplicateProvider(() => 'r8_key', () => DEFAULT_REPLICATE_MODELS);
    await provider.submit(request());
    assert.equal(stub.calls[0].url, 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions');
    assert.equal(stub.calls[0].headers.Authorization, 'Bearer r8_key');
    assert.equal(stub.calls[0].body.version, undefined, 'official models take no version');

    const hash = 'a'.repeat(40);
    await provider.submit(request({ providerOptions: { model: hash } }));
    assert.equal(stub.calls[1].url, 'https://api.replicate.com/v1/predictions');
    assert.equal(stub.calls[1].body.version, hash, 'a community version goes in the body');
  } finally { stub.restore(); }
});

test('replicate treats canceled as terminal, not as still running', async () => {
  const stub = stubFetch(() => ({ body: { status: 'canceled' } }));
  try {
    const provider = new ReplicateProvider(() => 'k', () => DEFAULT_REPLICATE_MODELS);
    const job = { providerId: 'replicate', requestId: 'a', kind: 'sprite', externalId: 'p1', status: 'queued', pollUrl: 'https://api.replicate.com/v1/predictions/p1' };
    const done = await provider.poll(job);
    assert.equal(done.status, 'failed', 'a canceled prediction would otherwise poll until timeout');
  } finally { stub.restore(); }
});

// ---- Hugging Face: synchronous, raw bytes, JSON-means-error ----

test('hugging face returns bytes inline, so there is nothing to poll', async () => {
  const stub = stubFetch(() => ({ headers: { 'content-type': 'image/png' }, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }));
  try {
    const provider = new HuggingFaceProvider(() => 'hf_key', () => ({ sprite: 'black-forest-labs/FLUX.1-schnell' }));
    const job = await provider.submit(request());
    assert.equal(stub.calls[0].headers.Authorization, 'Bearer hf_key');
    assert.ok(stub.calls[0].url.startsWith('https://router.huggingface.co/hf-inference/models/'));
    assert.equal(stub.calls[0].body.inputs, 'a hero', 'HF takes `inputs`, not `prompt`');
    assert.equal(job.status, 'succeeded');
    assert.ok(Buffer.isBuffer(job.output.bytes));
    assert.equal(await provider.poll(job), job, 'poll is a no-op');
  } finally { stub.restore(); }
});

test('a 200 carrying JSON is an error, not a sprite', async () => {
  // A cold model replies 200 with {"error":"loading"}; storing that as a PNG
  // yields a file that opens nowhere.
  const stub = stubFetch(() => ({ headers: { 'content-type': 'application/json' }, body: { error: 'Model is currently loading' } }));
  try {
    const provider = new HuggingFaceProvider(() => 'k', () => ({ sprite: 'some/model' }));
    await assert.rejects(() => provider.submit(request()), /loading/i);
  } finally { stub.restore(); }
});

// ---- OpenAI: base64 images, speech bytes, code ----

test('openai image generation decodes base64 into bytes', async () => {
  const png = Buffer.from([1, 2, 3, 4]);
  const stub = stubFetch(() => ({ body: { data: [{ b64_json: png.toString('base64') }] } }));
  try {
    const provider = new OpenAiAssetProvider(() => 'sk-x', () => 'gpt-4o-mini-tts', () => 'gpt-4.1-mini');
    const job = await provider.submit(request());
    assert.equal(stub.calls[0].url, 'https://api.openai.com/v1/images/generations');
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(job.output.bytes, png);
  } finally { stub.restore(); }
});

test('openai code generation strips the markdown fence models add anyway', async () => {
  const { __test } = require('../dist/assets/providers/openai.provider');
  assert.equal(__test.stripFences('```ts\nconst a = 1;\n```'), 'const a = 1;');
  assert.equal(__test.stripFences('const a = 1;'), 'const a = 1;');
  assert.equal(__test.imageSize(512, 512), '1024x1024');
  assert.equal(__test.imageSize(1920, 1080), '1536x1024', 'arbitrary sizes are rejected by the API');
});

// ---- Sketchfab: retrieval, licence, expiry ----

test('sketchfab searches downloadable models and carries attribution through', async () => {
  const replies = [
    { body: { results: [{ uid: 'u1', name: 'Crate', user: { displayName: 'Ana' }, license: { label: 'CC-BY' } }] } },
    { body: { glb: { url: 'https://sketchfab/tmp.glb', expires: 3600 } } },
  ];
  let index = 0;
  const stub = stubFetch(() => replies[index++]);
  try {
    const job = await new SketchfabProvider(() => 'sf_token').submit(request({ kind: 'model3d', prompt: 'wooden crate' }));
    assert.equal(stub.calls[0].headers.Authorization, 'Token sf_token', 'Sketchfab uses Token, not Bearer');
    assert.ok(stub.calls[0].url.includes('downloadable=true'), 'searching non-downloadable models is pointless');
    assert.ok(stub.calls[0].url.includes('license=cc0'), 'licence filtering is on by default');
    assert.equal(job.status, 'succeeded');
    assert.equal(job.output.meta.author, 'Ana');
    assert.equal(job.output.meta.license, 'CC-BY', 'attribution must survive — CC-BY requires it');
    assert.equal(job.output.meta.expiresInSeconds, 3600);
  } finally { stub.restore(); }
});

test('an empty sketchfab search skips rather than fails, so routing can fall through', async () => {
  const stub = stubFetch(() => ({ body: { results: [] } }));
  try {
    const job = await new SketchfabProvider(() => 't').submit(request({ kind: 'model3d', prompt: 'nonexistent' }));
    assert.equal(job.status, 'skipped', 'a library miss is not an error');
  } finally { stub.restore(); }
});

// ---- Luma ----

test('luma does not advertise 3D, because its public API cannot do it', () => {
  const provider = new LumaProvider(() => 'luma-key');
  assert.ok(!provider.kinds.includes('model3d'),
    'claiming 3D would route requests here that Meshy could actually serve');
  assert.ok(provider.kinds.includes('sprite'));
});

test('luma polls its generation until state is completed', async () => {
  const replies = [
    { body: { state: 'dreaming' } },
    { body: { state: 'completed', assets: { image: 'https://cdn/luma.png' } } },
  ];
  let index = 0;
  const stub = stubFetch(() => replies[index++]);
  try {
    const provider = new LumaProvider(() => 'k');
    const job = { providerId: 'luma', requestId: 'a', kind: 'sprite', externalId: 'g1', status: 'queued' };
    assert.equal((await provider.poll(job)).status, 'running');
    const done = await provider.poll(job);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.output.url, 'https://cdn/luma.png');
  } finally { stub.restore(); }
});

// ---- every provider, uniformly ----

test('no provider claims to be configured without a key', () => {
  const providers = [
    new MeshyProvider(() => ''),
    new LumaProvider(() => ''),
    new SketchfabProvider(() => ''),
    new FalProvider(() => '', () => DEFAULT_FAL_MODELS),
    new ReplicateProvider(() => '', () => DEFAULT_REPLICATE_MODELS),
    new HuggingFaceProvider(() => '', () => ({})),
    new OpenAiAssetProvider(() => '', () => 'm', () => 'm'),
  ];
  for (const provider of providers) {
    assert.equal(provider.configured(), false, `${provider.id} must not run without a key`);
    assert.ok(provider.kinds.length > 0, `${provider.id} declares what it can make`);
    assert.equal(typeof provider.submit, 'function');
    assert.equal(typeof provider.poll, 'function');
  }
});
