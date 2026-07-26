import { AssetKind, AssetProvider, AssetRequest, ProviderJob } from '../asset.types';
import { getJson, postJson } from '../provider-http';

/**
 * fal.ai — queue-based model endpoints.
 *
 *   POST https://queue.fal.run/{model-id}      Authorization: Key <FAL_KEY>
 *        -> { request_id, status_url, response_url }
 *   GET  {status_url}   -> status: IN_QUEUE | IN_PROGRESS | COMPLETED
 *   GET  {response_url} -> model-specific result payload
 *
 * Two details that bite: the auth scheme is `Key`, not `Bearer`, and COMPLETED
 * means "finished", not "succeeded" — the result body still has to be fetched
 * and inspected. Both are handled here so the orchestrator sees the same job
 * vocabulary it gets from every other provider.
 */

const QUEUE = 'https://queue.fal.run';

export interface FalModelMap {
  sprite: string;
  texture: string;
  music: string;
  sfx: string;
}

export const DEFAULT_FAL_MODELS: FalModelMap = {
  sprite: 'fal-ai/flux/schnell',
  texture: 'fal-ai/flux/schnell',
  music: 'fal-ai/stable-audio',
  sfx: 'fal-ai/stable-audio',
};

export class FalProvider implements AssetProvider {
  readonly id = 'fal';
  readonly label = 'fal.ai (queue endpoints)';
  readonly kinds: AssetKind[] = ['sprite', 'texture', 'music', 'sfx'];

  constructor(
    private readonly apiKey: () => string,
    private readonly models: () => FalModelMap,
  ) {}

  configured(): boolean {
    return Boolean(this.apiKey());
  }

  private headers() {
    return { Authorization: `Key ${this.apiKey()}` };
  }

  async submit(request: AssetRequest): Promise<ProviderJob> {
    const model = String(
      (request.providerOptions?.model as string) || this.models()[request.kind as keyof FalModelMap] || '',
    );
    if (!model) {
      return {
        providerId: this.id, requestId: request.id, kind: request.kind, externalId: null,
        status: 'skipped', error: `no fal model configured for ${request.kind}`,
      };
    }

    const audio = request.kind === 'music' || request.kind === 'sfx';
    const body: Record<string, unknown> = audio
      ? {
        prompt: request.prompt,
        seconds_total: Math.max(1, Math.round(request.durationSeconds ?? (request.kind === 'sfx' ? 3 : 20))),
      }
      : {
        prompt: request.prompt,
        ...(request.width && request.height ? { image_size: { width: request.width, height: request.height } } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

    const created = await postJson<any>({
      provider: this.id,
      url: `${QUEUE}/${model}`,
      headers: this.headers(),
      body: { ...body, ...(request.providerOptions || {}) },
    });
    return {
      providerId: this.id,
      requestId: request.id,
      kind: request.kind,
      externalId: String(created?.request_id || ''),
      // fal hands back its own urls; using them avoids re-deriving the model path.
      pollUrl: created?.status_url,
      status: 'queued',
      raw: { ...created, model },
    };
  }

  async poll(job: ProviderJob): Promise<ProviderJob> {
    const statusUrl = job.pollUrl;
    if (!statusUrl) return { ...job, status: 'failed', error: 'no fal status url' };

    const state = await getJson<any>({ provider: this.id, url: statusUrl, headers: this.headers() });
    const status = String(state?.status || '').toUpperCase();
    if (status !== 'COMPLETED') return { ...job, status: 'running', raw: state };

    const responseUrl = state?.response_url || (job.raw as any)?.response_url;
    if (!responseUrl) return { ...job, status: 'failed', error: 'fal completed without a response url', raw: state };

    const result = await getJson<any>({ provider: this.id, url: responseUrl, headers: this.headers() });
    const url = firstFileUrl(result);
    if (!url) {
      return { ...job, status: 'failed', error: result?.error || 'fal completed but returned no file url', raw: result };
    }
    return {
      ...job,
      status: 'succeeded',
      output: { url, contentType: contentTypeFor(job.kind, url) },
      raw: result,
    };
  }
}

/**
 * fal result payloads are model-specific — `{images:[{url}]}`, `{audio:{url}}`,
 * `{audio_file:{url}}`. Rather than a per-model parser, walk the object for the
 * first plausible file url; a new model then works without a code change.
 */
function firstFileUrl(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstFileUrl(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Prefer an explicit url before descending into siblings.
    if (typeof record.url === 'string' && /^https?:\/\//.test(record.url)) return record.url;
    for (const key of ['images', 'image', 'audio', 'audio_file', 'video', 'output', 'file']) {
      const found = firstFileUrl(record[key], depth + 1);
      if (found) return found;
    }
    for (const entry of Object.values(record)) {
      const found = firstFileUrl(entry, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function contentTypeFor(kind: AssetKind, url: string): string {
  if (/\.mp3(\?|$)/i.test(url)) return 'audio/mpeg';
  if (/\.wav(\?|$)/i.test(url)) return 'audio/wav';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  if (/\.jpe?g(\?|$)/i.test(url)) return 'image/jpeg';
  if (kind === 'music' || kind === 'sfx') return 'audio/mpeg';
  return 'image/png';
}

export const __test = { firstFileUrl };
