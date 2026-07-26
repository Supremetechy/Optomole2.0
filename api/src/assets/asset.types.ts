/**
 * The asset-generation contract.
 *
 * Optomole compiles content into an experience; every experience needs art,
 * audio, and 3D. Seven external services can supply those, and they disagree
 * about almost everything: Meshy and Luma are task-based, fal and Replicate are
 * queue-based with different status vocabularies, Hugging Face returns raw
 * bytes from a synchronous POST, OpenAI returns base64 in JSON, and Sketchfab
 * does not generate anything at all — it searches a library of existing models.
 *
 * Rather than let those differences leak into the compiler, every provider
 * implements this one interface. The pipeline asks for "a sprite that looks
 * like X"; which vendor answers, and whether that vendor polls or streams or
 * returns inline, is the provider's problem.
 *
 * ONE SHAPE FOR SYNC AND ASYNC. `submit` always returns a job. A synchronous
 * provider returns it already `succeeded` with `inline` set; an async one
 * returns `queued` and the orchestrator polls. Callers never branch on which.
 */

export type AssetKind =
  | 'sprite'
  | 'texture'
  | 'model3d'
  | 'music'
  | 'sfx'
  | 'voice'
  | 'code';

/** Every kind the pipeline can ask for, in the order a build usually needs them. */
export const ASSET_KINDS: AssetKind[] = ['sprite', 'texture', 'model3d', 'music', 'sfx', 'voice', 'code'];

export interface AssetStyle {
  /** Hex colours from the experience's emotional palette. */
  palette?: string[];
  /** Dominant emotional tone ("urgency", "calm"). */
  tone?: string;
  /** Genre/template family, so a courier game and a dungeon crawl differ. */
  genre?: string;
}

export interface AssetRequest {
  /**
   * Stable id this asset fulfils — normally the `spriteId` the compiled bundle
   * already references, so a generated file can replace a placeholder without
   * touching anything else.
   */
  id: string;
  kind: AssetKind;
  prompt: string;
  style?: AssetStyle;
  /** Desired container ('glb', 'png', 'mp3', 'wav', 'ts'). Advisory. */
  format?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** Force a provider by id. Otherwise the registry routes by capability. */
  provider?: string;
  /** Deterministic seed where the provider supports one. */
  seed?: number;
  /** Provider-specific escape hatch, merged into the request body. */
  providerOptions?: Record<string, unknown>;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

/** A finished payload, either as a URL to fetch or as bytes already in hand. */
export interface ProviderOutput {
  /** Remote URL to fetch. Provider URLs usually expire — see AssetGenerationService. */
  url?: string;
  /** Bytes returned inline (Hugging Face returns image/audio bytes directly). */
  bytes?: Buffer;
  contentType: string;
  /** Companion formats a provider returned alongside the primary one. */
  alternates?: Array<{ format: string; url: string }>;
  meta?: Record<string, unknown>;
}

export interface ProviderJob {
  providerId: string;
  requestId: string;
  kind: AssetKind;
  /** The provider's own task/prediction id; null when it answered inline. */
  externalId: string | null;
  status: JobStatus;
  output?: ProviderOutput;
  error?: string;
  /** Where to poll, when the provider hands back its own URLs (fal does). */
  pollUrl?: string;
  /** Kept for debugging; never relied on by the orchestrator. */
  raw?: unknown;
}

export interface AssetProvider {
  readonly id: string;
  readonly label: string;
  /** What this provider can actually produce. Routing reads only this. */
  readonly kinds: AssetKind[];
  /**
   * Whether the provider is usable right now. Almost always "an API key is
   * present" — the pipeline must degrade to placeholder art rather than fail a
   * build because a key is missing, so this is checked before routing.
   */
  configured(): boolean;
  submit(request: AssetRequest): Promise<ProviderJob>;
  /** Advance an async job. Synchronous providers return the job unchanged. */
  poll(job: ProviderJob): Promise<ProviderJob>;
}

/** What the orchestrator hands back once bytes are stored and addressable. */
export interface GeneratedAsset {
  requestId: string;
  kind: AssetKind;
  providerId: string;
  status: JobStatus;
  /** A stable Optomole URL — never the provider's expiring one. */
  url?: string;
  storageKey?: string;
  contentType?: string;
  bytes?: number;
  alternates?: Array<{ format: string; url: string }>;
  error?: string;
  /** True when this came from cache rather than a fresh (billed) call. */
  cached?: boolean;
  elapsedMs?: number;
}

export const jobFailed = (job: ProviderJob, error: string): ProviderJob => ({
  ...job,
  status: 'failed',
  error,
});
