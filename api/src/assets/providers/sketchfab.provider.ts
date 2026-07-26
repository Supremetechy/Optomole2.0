import { AssetKind, AssetProvider, AssetRequest, ProviderJob } from '../asset.types';
import { getJson } from '../provider-http';

/**
 * Sketchfab — a LIBRARY, not a generator.
 *
 *   GET https://api.sketchfab.com/v3/search?type=models&q=...&downloadable=true
 *   GET https://api.sketchfab.com/v3/models/{uid}/download
 *       Authorization: Token <api token>  -> temporary gltf / glb / usdz urls
 *
 * It belongs in the same registry because from the pipeline's point of view
 * "give me a crate model" is one request whether a model is synthesized or
 * found. But two properties make it different, and both are handled here:
 *
 *  1. IT RETRIEVES, SO LICENCE MATTERS. Generated art has no upstream author;
 *     a downloaded model does. Search is therefore pinned to downloadable
 *     models, and the licence plus author travel with the result so a build can
 *     attribute them. Never strip that metadata.
 *  2. DOWNLOAD LINKS EXPIRE (minutes). The orchestrator copies bytes into
 *     Optomole's own storage immediately, which it does for every provider —
 *     here it is not an optimization but a correctness requirement.
 */

const BASE = 'https://api.sketchfab.com/v3';

/** Licences permissive enough to ship inside a generated experience. */
const DEFAULT_LICENCES = ['cc0', 'cc-by', 'cc-by-sa'];

export class SketchfabProvider implements AssetProvider {
  readonly id = 'sketchfab';
  readonly label = 'Sketchfab (3D model library)';
  readonly kinds: AssetKind[] = ['model3d'];

  constructor(private readonly apiToken: () => string) {}

  configured(): boolean {
    return Boolean(this.apiToken());
  }

  private headers() {
    // Sketchfab uses "Token", not "Bearer".
    return { Authorization: `Token ${this.apiToken()}` };
  }

  /**
   * Search then resolve a download in one step. There is no long-running task,
   * so this returns a finished job — the shared interface lets a retrieval
   * provider and a generative one sit behind the same call.
   */
  async submit(request: AssetRequest): Promise<ProviderJob> {
    const base: ProviderJob = {
      providerId: this.id,
      requestId: request.id,
      kind: request.kind,
      externalId: null,
      status: 'queued',
    };

    const licences = (request.providerOptions?.licenses as string[]) || DEFAULT_LICENCES;
    const query = new URLSearchParams({
      type: 'models',
      q: request.prompt.slice(0, 120),
      downloadable: 'true',
      archives_flavours: 'false',
      count: '12',
      sort_by: '-likeCount',
    });
    for (const licence of licences) query.append('license', licence);

    const found = await getJson<any>({
      provider: this.id, url: `${BASE}/search?${query.toString()}`, headers: this.headers(),
    });
    const hit = (found?.results || [])[0];
    if (!hit?.uid) {
      // Not an error: the library simply has nothing matching. `skipped` lets
      // the orchestrator fall through to a generative provider or a placeholder.
      return { ...base, status: 'skipped', error: `no downloadable Sketchfab model for "${request.prompt.slice(0, 60)}"` };
    }

    const download = await getJson<any>({
      provider: this.id, url: `${BASE}/models/${hit.uid}/download`, headers: this.headers(),
    });
    const archive = download?.glb || download?.gltf || download?.usdz;
    if (!archive?.url) {
      return { ...base, status: 'failed', error: `Sketchfab model ${hit.uid} exposed no downloadable archive` };
    }

    return {
      ...base,
      externalId: String(hit.uid),
      status: 'succeeded',
      output: {
        url: archive.url,
        contentType: download?.glb ? 'model/gltf-binary' : 'application/zip',
        meta: {
          // Attribution is part of the asset, not a nicety — CC-BY requires it.
          source: 'sketchfab',
          uid: hit.uid,
          name: hit.name,
          viewerUrl: hit.viewerUrl,
          author: hit.user?.displayName || hit.user?.username,
          authorUrl: hit.user?.profileUrl,
          license: hit.license?.label || hit.license?.slug,
          licenseUrl: hit.license?.url,
          expiresInSeconds: archive.expires,
        },
      },
      raw: { hit, download },
    };
  }

  /** Nothing to advance: `submit` already resolved or skipped. */
  async poll(job: ProviderJob): Promise<ProviderJob> {
    return job;
  }
}
