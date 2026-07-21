export type EngineTarget = 'browser' | 'unreal' | 'unity' | 'blender' | 'godot' | 'webxr' | string;
export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface SourcePayload {
  sourceType?: string;
  title?: string;
  text?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface ExperiencePackage {
  id?: string;
  /**
   * The user's explicit genre/template selection (a template id, genre family,
   * or runtime archetype). When set, template selection honors it instead of
   * inferring a genre from content keywords. See TemplatesService.resolve.
   */
  templatePreference?: string;
  experience?: {
    id?: string;
    title?: string;
    genre?: unknown;
    outputType?: unknown;
    outputExperience?: unknown;
    world?: unknown;
  };
  source?: SourcePayload;
  blueprint?: Record<string, unknown>;
  specification?: Record<string, unknown>;
  runtimeContract?: Record<string, unknown>;
  progression?: {
    domain?: string;
    xpReward?: number;
    skillTree?: Array<Record<string, unknown>>;
    loot?: string[];
    profileVersion?: string;
    [key: string]: unknown;
  };
  renderTargets?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface BuildJob {
  id: string;
  experienceId: string;
  target: EngineTarget;
  status: BuildStatus;
  packageRef?: string;
  artifactId?: string;
  launchUrl?: string;
  downloadUrl?: string;
  error?: string;
  workerId?: string;
  createdAt: string;
  updatedAt: string;
  logs: string[];
}

export interface BuildCommand {
  jobId: string;
  target: EngineTarget;
  experienceId: string;
  package: ExperiencePackage;
  callbackUrl: string;
  requestedAt: string;
  template?: unknown;
  mappingManifest?: unknown;
}

export interface ArtifactRecord {
  id: string;
  jobId: string;
  experienceId: string;
  target: EngineTarget;
  kind: 'playable-session' | 'engine-build' | 'asset-export' | 'developer-artifact';
  status: 'ready' | 'failed';
  launchUrl?: string;
  downloadUrl?: string;
  storageKey?: string;
  contentType?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
