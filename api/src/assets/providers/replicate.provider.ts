import { AssetKind, AssetProvider, AssetRequest, ProviderJob } from '../asset.types';
import { getJson, postJson } from '../provider-http';

/**
 * Replicate — runs arbitrary hosted models, so it can cover several kinds.
 *
 *   POST https://api.replicate.com/v1/models/{owner}/{name}/predictions   (official models)
 *   POST https://api.replicate.com/v1/predictions  { version, input }     (community versions)
 *        Authorization: Bearer <token>
 *        -> { id, status, urls: { get } }
 *   GET  urls.get -> status: starting | processing | succeeded | failed | canceled
 *                    output: url | url[]
 *
 * Which model serves which kind is configuration, not code: the defaults below
 * are overridable per environment, because model availability on Replicate
 * changes far more often than this integration should.
 */

const BASE = 'https://api.replicate.com/v1';

export interface ReplicateModelMap {
  sprite: string;
  texture: string;
  music: string;
  sfx: string;
}

export const DEFAULT_REPLICATE_MODELS: ReplicateModelMap = {
  sprite: 'black-forest-labs/flux-schnell',
  texture: 'black-forest-labs/flux-schnell',
  music: 'meta/musicgen',
  sfx: 'meta/musicgen',
};

const TERMINAL_BAD = new Set(['failed', 'canceled']);

export class ReplicateProvider implements AssetProvider {
  readonly id = 'replicate';
  readonly label = 'Replicate (hosted models)';
  readonly kinds: AssetKind[] = ['sprite', 'texture', 'music', 'sfx'];

  constructor(
    private readonly apiKey: () => string,
    private readonly models: () => ReplicateModelMap,
  ) {}

  configured(): boolean {
    return Boolean(this.apiKey());
  }

  private headers() {
    return { Authorization: `Bearer ${this.apiKey()}` };
  }

  async submit(request: AssetRequest): Promise<ProviderJob> {
    const model = String(
      (request.providerOptions?.model as string) || this.models()[request.kind as keyof ReplicateModelMap] || '',
    );
    if (!model) {
      return {
        providerId: this.id, requestId: request.id, kind: request.kind, externalId: null,
        status: 'skipped', error: `no Replicate model configured for ${request.kind}`,
      };
    }

    const audio = request.kind === 'music' || request.kind === 'sfx';
    const input: Record<string, unknown> = audio
      ? {
        prompt: request.prompt,
        duration: Math.max(1, Math.round(request.durationSeconds ?? (request.kind === 'sfx' ? 3 : 20))),
      }
      : {
        prompt: request.prompt,
        ...(request.width ? { width: request.width } : {}),
        ...(request.height ? { height: request.height } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

    // A slug (owner/name) is an official model and uses the model-scoped route;
    // a bare 64-char hash is a community version and goes to /predictions.
    const isVersionHash = /^[0-9a-f]{40,}$/i.test(model);
    const url = isVersionHash ? `${BASE}/predictions` : `${BASE}/models/${model}/predictions`;
    const body = isVersionHash ? { version: model, input } : { input };

    const created = await postJson<any>({ provider: this.id, url, headers: this.headers(), body });
    return {
      providerId: this.id,
      requestId: request.id,
      kind: request.kind,
      externalId: String(created?.id || ''),
      pollUrl: created?.urls?.get,
      status: 'queued',
      raw: created,
    };
  }

  async poll(job: ProviderJob): Promise<ProviderJob> {
    const url = job.pollUrl || (job.externalId ? `${BASE}/predictions/${job.externalId}` : '');
    if (!url) return { ...job, status: 'failed', error: 'no replicate prediction url' };

    const prediction = await getJson<any>({ provider: this.id, url, headers: this.headers() });
    const status = String(prediction?.status || '').toLowerCase();
    if (TERMINAL_BAD.has(status)) {
      return { ...job, status: 'failed', error: prediction?.error || `replicate prediction ${status}`, raw: prediction };
    }
    if (status !== 'succeeded') return { ...job, status: 'running', raw: prediction };

    // Output is a url, or an array of them; image models usually return a list.
    const output = prediction?.output;
    const primary = Array.isArray(output) ? output[0] : typeof output === 'string' ? output : output?.audio || output?.image;
    if (typeof primary !== 'string') {
      return { ...job, status: 'failed', error: 'replicate succeeded but returned no file url', raw: prediction };
    }
    return {
      ...job,
      status: 'succeeded',
      output: { url: primary, contentType: contentTypeFor(job.kind, primary) },
      raw: prediction,
    };
  }
}

function contentTypeFor(kind: AssetKind, url: string): string {
  if (/\.mp3(\?|$)/i.test(url)) return 'audio/mpeg';
  if (/\.wav(\?|$)/i.test(url)) return 'audio/wav';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  if (/\.jpe?g(\?|$)/i.test(url)) return 'image/jpeg';
  if (kind === 'music' || kind === 'sfx') return 'audio/mpeg';
  return 'image/png';
}
