import { Injectable } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';
import { AssetKind, ASSET_KINDS, AssetProvider } from './asset.types';
import { MeshyProvider } from './providers/meshy.provider';
import { LumaProvider } from './providers/luma.provider';
import { SketchfabProvider } from './providers/sketchfab.provider';
import { ReplicateProvider, DEFAULT_REPLICATE_MODELS } from './providers/replicate.provider';
import { FalProvider, DEFAULT_FAL_MODELS } from './providers/fal.provider';
import { HuggingFaceProvider, DEFAULT_HF_MODELS } from './providers/huggingface.provider';
import { OpenAiAssetProvider } from './providers/openai.provider';

/**
 * The registry — which vendor answers a given request.
 *
 * Routing reads capability and configuration only. That is what makes the set
 * modular: adding an eighth vendor is one class plus one line here, and
 * removing a key silently re-routes its kinds to whoever else can serve them
 * instead of failing a build.
 *
 * PREFERENCE IS PER KIND, NOT GLOBAL. The best 3D vendor is not the best music
 * vendor. Each kind carries its own ordered list, so `model3d` tries Meshy
 * (which synthesizes) before Sketchfab (which retrieves), while `music` never
 * considers either.
 */

/** Default order per kind, best-fit first. Overridable via ASSET_PROVIDER_ORDER. */
const DEFAULT_ORDER: Record<AssetKind, string[]> = {
  sprite: ['fal', 'replicate', 'huggingface', 'openai', 'luma'],
  texture: ['fal', 'replicate', 'huggingface', 'openai', 'luma'],
  // Generate first, retrieve second: a synthesized model always matches the
  // prompt, whereas the library may only have something approximate.
  model3d: ['meshy', 'sketchfab'],
  music: ['fal', 'replicate', 'huggingface'],
  sfx: ['fal', 'replicate', 'huggingface'],
  voice: ['openai'],
  code: ['openai'],
};

export interface ProviderCapability {
  id: string;
  label: string;
  kinds: AssetKind[];
  configured: boolean;
}

@Injectable()
export class AssetProviderRegistry {
  private readonly providers: AssetProvider[];

  constructor() {
    const config = () => gatewayConfig();
    this.providers = [
      new MeshyProvider(() => config().meshyApiKey),
      new LumaProvider(() => config().lumaApiKey),
      new SketchfabProvider(() => config().sketchfabApiToken),
      new FalProvider(() => config().falApiKey, () => ({ ...DEFAULT_FAL_MODELS, ...parseModelMap(config().falModels) })),
      new ReplicateProvider(
        () => config().replicateApiKey,
        () => ({ ...DEFAULT_REPLICATE_MODELS, ...parseModelMap(config().replicateModels) }),
      ),
      new HuggingFaceProvider(
        () => config().huggingfaceApiKey,
        () => ({ ...DEFAULT_HF_MODELS, ...parseModelMap(config().huggingfaceModels) }),
      ),
      new OpenAiAssetProvider(
        () => config().openaiApiKey,
        () => config().openaiSpeechModel,
        () => config().openaiCodeModel,
      ),
    ];
  }

  all(): AssetProvider[] {
    return this.providers;
  }

  byId(id: string): AssetProvider | null {
    return this.providers.find((provider) => provider.id === id) || null;
  }

  /**
   * Providers that can serve a kind, in preference order, configured ones
   * first. Unconfigured providers are still returned (at the end) so a caller
   * asking "who could do this if I added a key" gets a truthful answer.
   */
  candidatesFor(kind: AssetKind): AssetProvider[] {
    const order = this.orderFor(kind);
    const capable = this.providers.filter((provider) => provider.kinds.includes(kind));
    const rank = (provider: AssetProvider) => {
      const index = order.indexOf(provider.id);
      return index === -1 ? order.length : index;
    };
    return capable.sort((a, b) => {
      // Configured always outranks preference: a preferred vendor with no key
      // cannot serve the request at all.
      if (a.configured() !== b.configured()) return a.configured() ? -1 : 1;
      return rank(a) - rank(b);
    });
  }

  /** The provider that will actually be used, or null if none is usable. */
  resolve(kind: AssetKind, preferredId?: string): AssetProvider | null {
    if (preferredId) {
      const explicit = this.byId(preferredId);
      // An explicit choice is honored only if it can really do the job —
      // otherwise routing falls through rather than failing at request time.
      if (explicit && explicit.kinds.includes(kind) && explicit.configured()) return explicit;
    }
    return this.candidatesFor(kind).find((provider) => provider.configured()) || null;
  }

  /** What this deployment can produce right now — the honest capability report. */
  capabilities(): {
    providers: ProviderCapability[];
    byKind: Record<string, { provider: string | null; fallback: 'procedural-placeholder' }>;
    configuredCount: number;
  } {
    const providers = this.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      kinds: provider.kinds,
      configured: provider.configured(),
    }));
    const byKind: Record<string, { provider: string | null; fallback: 'procedural-placeholder' }> = {};
    for (const kind of ASSET_KINDS) {
      byKind[kind] = { provider: this.resolve(kind)?.id || null, fallback: 'procedural-placeholder' };
    }
    return { providers, byKind, configuredCount: providers.filter((p) => p.configured).length };
  }

  private orderFor(kind: AssetKind): string[] {
    const override = parseOrder(gatewayConfig().assetProviderOrder)[kind];
    return override?.length ? override : DEFAULT_ORDER[kind];
  }
}

/**
 * "sprite:fal,replicate;model3d:sketchfab" — a compact env override so an
 * operator can re-rank vendors without a deploy.
 */
function parseOrder(raw: string): Partial<Record<AssetKind, string[]>> {
  const parsed: Partial<Record<AssetKind, string[]>> = {};
  for (const entry of String(raw || '').split(';')) {
    const [kind, list] = entry.split(':');
    const key = String(kind || '').trim() as AssetKind;
    if (!key || !ASSET_KINDS.includes(key) || !list) continue;
    parsed[key] = list.split(',').map((id) => id.trim()).filter(Boolean);
  }
  return parsed;
}

/** "sprite=owner/model,music=owner/other" — per-kind model overrides. */
function parseModelMap(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const entry of String(raw || '').split(',')) {
    const [kind, model] = entry.split('=');
    if (kind?.trim() && model?.trim()) parsed[kind.trim()] = model.trim();
  }
  return parsed;
}

export const __test = { parseOrder, parseModelMap, DEFAULT_ORDER };
