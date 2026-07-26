import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ObjectStorageService } from '../integrations/object-storage.service';
import { gatewayConfig } from '../shared/config';
import { AssetProviderRegistry } from './asset-provider.registry';
import { AssetKind, AssetRequest, GeneratedAsset, ProviderJob } from './asset.types';
import { fetchBytes } from './provider-http';

/**
 * AssetGenerationService — the one pipeline.
 *
 * Takes requests for art, audio, 3D, and code, routes each to whichever vendor
 * can serve it, waits out the async ones, and returns assets addressed by
 * Optomole URLs. Three properties matter more than the plumbing:
 *
 *  1. NOTHING BLOCKS A BUILD. Generation is opt-in, every provider is optional,
 *     and any failure resolves to a `failed`/`skipped` entry rather than an
 *     exception. A compile with no keys still produces a playable experience
 *     with the procedural placeholder art it has always used.
 *  2. BYTES ARE COPIED, NOT LINKED. Provider URLs expire — Sketchfab's in
 *     minutes, fal's and Meshy's within hours. A bundle that referenced them
 *     would play today and 404 next week, so every result is downloaded and
 *     re-hosted before it is handed back.
 *  3. IDENTICAL REQUESTS ARE NOT BILLED TWICE. Results are cached by a hash of
 *     the request, so recompiling the same experience reuses assets. Without
 *     this, every recompile of an eighteen-item bundle is eighteen fresh calls.
 */

/** How long to wait for an async job before giving up on it. */
const POLL_INTERVAL_MS = 2_000;

/** Concurrency across a batch — enough to be quick, low enough to respect rate limits. */
const MAX_PARALLEL = 4;

@Injectable()
export class AssetGenerationService {
  private readonly logger = new Logger(AssetGenerationService.name);

  /**
   * requestHash -> finished asset. In-memory because a generated asset is
   * always re-derivable; the bytes themselves live in object storage.
   */
  private readonly cache = new Map<string, GeneratedAsset>();

  constructor(
    private readonly registry: AssetProviderRegistry,
    private readonly storage: ObjectStorageService,
  ) {}

  /** Whether generation will actually run, and why not when it won't. */
  status() {
    const config = gatewayConfig();
    const capabilities = this.registry.capabilities();
    return {
      enabled: config.assetGenerationEnabled,
      reason: !config.assetGenerationEnabled
        ? 'ASSET_GENERATION_ENABLED is not true — the pipeline uses procedural placeholder art.'
        : capabilities.configuredCount === 0
          ? 'No provider API keys are configured — the pipeline uses procedural placeholder art.'
          : null,
      ...capabilities,
      cachedAssets: this.cache.size,
    };
  }

  /**
   * Generate one asset. Never throws for provider-side problems: the returned
   * asset carries `status: 'failed'` with the reason, because one missing
   * sprite must not fail a build of eighteen.
   */
  async generate(request: AssetRequest, options: { publicBaseUrl?: string } = {}): Promise<GeneratedAsset> {
    const config = gatewayConfig();
    const startedAt = Date.now();

    if (!config.assetGenerationEnabled) {
      return this.skipped(request, 'asset generation is disabled (ASSET_GENERATION_ENABLED)');
    }

    const cacheKey = this.cacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, cached: true, elapsedMs: 0 };

    const provider = this.registry.resolve(request.kind, request.provider);
    if (!provider) {
      return this.skipped(request, `no configured provider can produce ${request.kind}`);
    }

    try {
      let job = await provider.submit(request);
      job = await this.waitFor(provider.id, job, config.assetJobTimeoutMs);

      if (job.status !== 'succeeded' || !job.output) {
        return {
          requestId: request.id,
          kind: request.kind,
          providerId: provider.id,
          status: job.status === 'skipped' ? 'skipped' : 'failed',
          error: job.error || 'provider returned no output',
          elapsedMs: Date.now() - startedAt,
        };
      }

      // Copy the payload into our own storage before the provider's link dies.
      const bytes = job.output.bytes
        ?? (await fetchBytes({ provider: provider.id, url: job.output.url! })).bytes;
      const stored = await this.storage.putBinaryObject({
        body: bytes,
        contentType: job.output.contentType,
        key: this.storageKey(request, job.output.contentType),
        publicBaseUrl: options.publicBaseUrl,
      });

      const asset: GeneratedAsset = {
        requestId: request.id,
        kind: request.kind,
        providerId: provider.id,
        status: 'succeeded',
        url: stored.url,
        storageKey: stored.key,
        contentType: job.output.contentType,
        bytes: bytes.length,
        alternates: job.output.alternates,
        elapsedMs: Date.now() - startedAt,
      };
      this.cache.set(cacheKey, asset);
      return asset;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`asset ${request.id} (${request.kind}) via ${provider.id} failed: ${message}`);
      return {
        requestId: request.id,
        kind: request.kind,
        providerId: provider.id,
        status: 'failed',
        error: message,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Generate a batch with bounded concurrency, returning one entry per request
   * in the order asked. A batch never rejects — inspect each entry's status.
   */
  async generateAll(
    requests: AssetRequest[],
    options: { publicBaseUrl?: string } = {},
  ): Promise<{ assets: GeneratedAsset[]; summary: Record<string, number> }> {
    const assets: GeneratedAsset[] = new Array(requests.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < requests.length) {
        const index = cursor++;
        assets[index] = await this.generate(requests[index], options);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, requests.length) }, worker));

    const summary: Record<string, number> = { requested: requests.length, succeeded: 0, failed: 0, skipped: 0, cached: 0 };
    for (const asset of assets) {
      summary[asset.status] = (summary[asset.status] || 0) + 1;
      if (asset.cached) summary.cached += 1;
    }
    return { assets, summary };
  }

  // ---- internals ----

  /**
   * Poll an async job to a terminal state. Synchronous providers arrive here
   * already finished and return immediately without a single extra request.
   */
  private async waitFor(providerId: string, job: ProviderJob, timeoutMs: number): Promise<ProviderJob> {
    const provider = this.registry.byId(providerId);
    if (!provider) return { ...job, status: 'failed', error: `unknown provider ${providerId}` };

    const deadline = Date.now() + Math.max(1_000, timeoutMs);
    let current = job;
    while (current.status === 'queued' || current.status === 'running') {
      if (Date.now() > deadline) {
        return { ...current, status: 'failed', error: `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${providerId}` };
      }
      await delay(POLL_INTERVAL_MS);
      current = await provider.poll(current);
    }
    return current;
  }

  private skipped(request: AssetRequest, reason: string): GeneratedAsset {
    return {
      requestId: request.id,
      kind: request.kind,
      providerId: request.provider || 'none',
      status: 'skipped',
      error: reason,
      elapsedMs: 0,
    };
  }

  /**
   * Everything that changes the output goes into the key — including the
   * provider, so switching vendors does not serve the previous one's art.
   */
  private cacheKey(request: AssetRequest): string {
    const resolved = this.registry.resolve(request.kind, request.provider);
    return createHash('sha256')
      .update(JSON.stringify({
        provider: resolved?.id || 'none',
        kind: request.kind,
        prompt: request.prompt,
        style: request.style || null,
        format: request.format || null,
        width: request.width || null,
        height: request.height || null,
        durationSeconds: request.durationSeconds || null,
        seed: request.seed ?? null,
        providerOptions: request.providerOptions || null,
      }))
      .digest('hex')
      .slice(0, 32);
  }

  private storageKey(request: AssetRequest, contentType: string): string {
    const safeId = request.id.replace(/[^a-zA-Z0-9._-]/g, '-');
    return `assets/${request.kind}/${safeId}-${this.cacheKey(request).slice(0, 10)}.${extensionFor(contentType)}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extensionFor(contentType: string): string {
  const type = contentType.split(';')[0].trim();
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/flac': 'flac',
    'model/gltf-binary': 'glb',
    'model/gltf+json': 'gltf',
    'application/zip': 'zip',
    'text/plain': 'txt',
  } as Record<string, string>)[type] || 'bin';
}

export const __test = { extensionFor };
