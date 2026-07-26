import { AssetKind, AssetProvider, AssetRequest, ProviderJob } from '../asset.types';
import { postForBytes } from '../provider-http';

/**
 * Hugging Face Inference Providers — one token, many upstream vendors.
 *
 *   POST https://router.huggingface.co/hf-inference/models/{modelId}
 *        Authorization: Bearer hf_***
 *        { inputs: "<prompt>", parameters: { width, height, ... } }
 *        -> RAW IMAGE/AUDIO BYTES (not JSON, not a url)
 *
 * The odd one out in two ways, both handled here:
 *
 *  1. IT ANSWERS SYNCHRONOUSLY WITH BYTES. There is no task to poll, so
 *     `submit` returns an already-succeeded job carrying the payload inline and
 *     `poll` is a no-op. The orchestrator does not care which mode it got.
 *  2. A 200 CAN STILL BE A FAILURE. When a model is cold, HF replies 200 with a
 *     JSON body ("model is loading") where bytes were promised. `postForBytes`
 *     treats a JSON content-type as an error for exactly this reason — silently
 *     storing that JSON as a PNG is how you get an unopenable sprite.
 */

const ROUTER = 'https://router.huggingface.co/hf-inference/models';

export interface HuggingFaceModelMap {
  sprite: string;
  texture: string;
  music: string;
  sfx: string;
}

export const DEFAULT_HF_MODELS: HuggingFaceModelMap = {
  sprite: 'black-forest-labs/FLUX.1-schnell',
  texture: 'black-forest-labs/FLUX.1-schnell',
  music: 'facebook/musicgen-small',
  sfx: 'facebook/musicgen-small',
};

export class HuggingFaceProvider implements AssetProvider {
  readonly id = 'huggingface';
  readonly label = 'Hugging Face Inference Providers';
  readonly kinds: AssetKind[] = ['sprite', 'texture', 'music', 'sfx'];

  constructor(
    private readonly apiKey: () => string,
    private readonly models: () => HuggingFaceModelMap,
  ) {}

  configured(): boolean {
    return Boolean(this.apiKey());
  }

  async submit(request: AssetRequest): Promise<ProviderJob> {
    const base: ProviderJob = {
      providerId: this.id, requestId: request.id, kind: request.kind, externalId: null, status: 'queued',
    };
    const model = String(
      (request.providerOptions?.model as string) || this.models()[request.kind as keyof HuggingFaceModelMap] || '',
    );
    if (!model) return { ...base, status: 'skipped', error: `no Hugging Face model configured for ${request.kind}` };

    const audio = request.kind === 'music' || request.kind === 'sfx';
    const parameters: Record<string, unknown> = audio
      ? {}
      : {
        ...(request.width ? { width: request.width } : {}),
        ...(request.height ? { height: request.height } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

    const { bytes, contentType } = await postForBytes({
      provider: this.id,
      url: `${ROUTER}/${model}`,
      headers: { Authorization: `Bearer ${this.apiKey()}` },
      body: {
        inputs: request.prompt,
        ...(Object.keys(parameters).length ? { parameters } : {}),
        ...(request.providerOptions || {}),
      },
    });

    return {
      ...base,
      status: 'succeeded',
      output: { bytes, contentType: contentType || (audio ? 'audio/flac' : 'image/png') },
    };
  }

  /** Synchronous: `submit` already returned the bytes. */
  async poll(job: ProviderJob): Promise<ProviderJob> {
    return job;
  }
}
