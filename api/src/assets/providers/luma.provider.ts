import { AssetKind, AssetProvider, AssetRequest, ProviderJob } from '../asset.types';
import { getJson, postJson } from '../provider-http';

/**
 * Luma (Dream Machine) — text-to-image and text-to-video.
 *
 *   POST https://api.lumalabs.ai/dream-machine/v1/generations{/image}
 *        Authorization: Bearer luma-...   -> Generation { id, state, assets }
 *   GET  https://api.lumalabs.ai/dream-machine/v1/generations/{id}
 *        -> state: queued | dreaming | completed | failed
 *
 * WORTH KNOWING: Luma's public API generates IMAGE and VIDEO only. Its 3D
 * capture/Genie work is not exposed here, so this provider deliberately does
 * NOT advertise `model3d` — routing a 3D request to it would fail at request
 * time instead of falling through to Meshy, which can actually serve it.
 */

const BASE = 'https://api.lumalabs.ai/dream-machine/v1/generations';

export class LumaProvider implements AssetProvider {
  readonly id = 'luma';
  readonly label = 'Luma Dream Machine (image/video)';
  // Sprites and textures are stills; video is not an asset kind the gameplay
  // DSL can place, so it is not claimed here.
  readonly kinds: AssetKind[] = ['sprite', 'texture'];

  constructor(private readonly apiKey: () => string) {}

  configured(): boolean {
    return Boolean(this.apiKey());
  }

  private headers() {
    return { Authorization: `Bearer ${this.apiKey()}`, accept: 'application/json' };
  }

  async submit(request: AssetRequest): Promise<ProviderJob> {
    const created = await postJson<any>({
      provider: this.id,
      url: `${BASE}/image`,
      headers: this.headers(),
      body: {
        prompt: promptWithStyle(request),
        model: 'photon-1',
        ...(request.width && request.height
          ? { aspect_ratio: aspectRatio(request.width, request.height) }
          : {}),
        ...(request.providerOptions || {}),
      },
    });
    return {
      providerId: this.id,
      requestId: request.id,
      kind: request.kind,
      externalId: String(created?.id || ''),
      status: 'queued',
      raw: created,
    };
  }

  async poll(job: ProviderJob): Promise<ProviderJob> {
    if (!job.externalId) return { ...job, status: 'failed', error: 'no luma generation id' };
    const generation = await getJson<any>({
      provider: this.id, url: `${BASE}/${job.externalId}`, headers: this.headers(),
    });

    const state = String(generation?.state || '').toLowerCase();
    if (state === 'failed') {
      return { ...job, status: 'failed', error: generation?.failure_reason || 'luma generation failed', raw: generation };
    }
    if (state !== 'completed') return { ...job, status: 'running', raw: generation };

    const assets = generation?.assets || {};
    const url = assets.image || assets.video;
    if (!url) {
      return { ...job, status: 'failed', error: 'luma completed but returned no asset url', raw: generation };
    }
    return {
      ...job,
      status: 'succeeded',
      output: { url, contentType: assets.image ? 'image/png' : 'video/mp4' },
      raw: generation,
    };
  }
}

/** Luma takes a single prose prompt, so style has to be folded into words. */
function promptWithStyle(request: AssetRequest): string {
  const bits = [request.prompt];
  if (request.style?.tone) bits.push(`mood: ${request.style.tone}`);
  if (request.style?.palette?.length) bits.push(`palette: ${request.style.palette.slice(0, 3).join(', ')}`);
  return bits.join('. ');
}

function aspectRatio(width: number, height: number): string {
  if (width === height) return '1:1';
  return width > height ? '16:9' : '9:16';
}
