import { AssetKind, AssetProvider, AssetRequest, ProviderJob } from '../asset.types';
import { getJson, postJson } from '../provider-http';

/**
 * Meshy — text-to-3D.
 *
 *   POST https://api.meshy.ai/openapi/v2/text-to-3d   Authorization: Bearer <key>
 *        { mode: "preview" | "refine", prompt }        -> { result: "<taskId>" }
 *   GET  https://api.meshy.ai/openapi/v2/text-to-3d/{taskId}
 *        -> { status, model_urls: { glb, fbx, usdz, obj, ... }, texture_urls }
 *
 * Two-stage by design: `preview` produces untextured geometry, `refine` textures
 * a finished preview. The pipeline asks for one model, so this runs preview and
 * (when the caller wants texture) chains refine off the preview's id — the
 * chaining lives here rather than in the orchestrator, because it is a quirk of
 * this vendor and no other provider has it.
 */

const BASE = 'https://api.meshy.ai/openapi/v2/text-to-3d';

/** Meshy's task states. Only SUCCEEDED yields model urls. */
const TERMINAL_OK = 'SUCCEEDED';
const TERMINAL_BAD = new Set(['FAILED', 'CANCELED', 'EXPIRED']);

export class MeshyProvider implements AssetProvider {
  readonly id = 'meshy';
  readonly label = 'Meshy (text-to-3D)';
  readonly kinds: AssetKind[] = ['model3d'];

  constructor(private readonly apiKey: () => string) {}

  configured(): boolean {
    return Boolean(this.apiKey());
  }

  private headers() {
    return { Authorization: `Bearer ${this.apiKey()}` };
  }

  async submit(request: AssetRequest): Promise<ProviderJob> {
    const body = {
      mode: 'preview',
      // Meshy caps the prompt at 600 characters.
      prompt: request.prompt.slice(0, 600),
      art_style: request.style?.genre?.includes('retro') ? 'sculpture' : 'realistic',
      should_remesh: true,
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.providerOptions || {}),
    };
    const created = await postJson<{ result: string }>({
      provider: this.id, url: BASE, headers: this.headers(), body,
    });
    return {
      providerId: this.id,
      requestId: request.id,
      kind: request.kind,
      externalId: String(created.result),
      status: 'queued',
      raw: created,
    };
  }

  async poll(job: ProviderJob): Promise<ProviderJob> {
    if (!job.externalId) return { ...job, status: 'failed', error: 'no meshy task id' };
    const task = await getJson<any>({
      provider: this.id, url: `${BASE}/${job.externalId}`, headers: this.headers(),
    });

    const status = String(task?.status || '').toUpperCase();
    if (TERMINAL_BAD.has(status)) {
      return { ...job, status: 'failed', error: task?.task_error?.message || `meshy task ${status}`, raw: task };
    }
    if (status !== TERMINAL_OK) return { ...job, status: 'running', raw: task };

    const urls = (task?.model_urls || {}) as Record<string, string>;
    // GLB is the web-playable container; everything else rides along as an
    // alternate so an engine exporter can pick what it needs later.
    const primary = urls.glb || urls.gltf || Object.values(urls)[0];
    if (!primary) {
      return { ...job, status: 'failed', error: 'meshy succeeded but returned no model url', raw: task };
    }
    return {
      ...job,
      status: 'succeeded',
      output: {
        url: primary,
        contentType: 'model/gltf-binary',
        alternates: Object.entries(urls)
          .filter(([format, url]) => url && url !== primary)
          .map(([format, url]) => ({ format, url })),
        meta: { thumbnail: task?.thumbnail_url, textures: task?.texture_urls },
      },
      raw: task,
    };
  }
}
