import { BadRequestException, Injectable } from '@nestjs/common';
import { ExperienceBuildService } from '../compiler/experience-build.service';
import { QueueService } from '../integrations/queue.service';
import { ObjectStorageService } from '../integrations/object-storage.service';
import { gatewayConfig } from '../shared/config';
import { id } from '../shared/ids';
import { ArtifactRecord, BuildJob, EngineTarget, ExperiencePackage } from '../shared/types';
import { TemplatesService } from '../templates/templates.service';

@Injectable()
export class BuildsService {
  private readonly builds = new Map<string, BuildJob>();
  private readonly artifacts = new Map<string, ArtifactRecord>();

  constructor(
    private readonly queue: QueueService,
    private readonly storage: ObjectStorageService,
    private readonly templates: TemplatesService,
    private readonly experienceBuild: ExperienceBuildService,
  ) {}

  async createBuild(input: { package: ExperiencePackage; target: EngineTarget; publicBaseUrl?: string; engine?: string }): Promise<BuildJob> {
    if (!input.package) throw new BadRequestException('package is required.');
    const isLocalWebRuntime = input.target === 'browser' || input.target === 'mobile' || input.target === 'pixijs';

    const now = new Date().toISOString();
    const experienceId = input.package.experience?.id || input.package.id || id('exp');
    const build: BuildJob = {
      id: id('build'),
      experienceId,
      target: input.target,
      status: isLocalWebRuntime ? 'running' : 'queued',
      createdAt: now,
      updatedAt: now,
      logs: [`Build requested for ${input.target}.`],
    };
    this.builds.set(build.id, build);

    if (isLocalWebRuntime) {
      return this.completeBrowserBuild(build.id, input.package, input.target, input.publicBaseUrl, input.engine);
    }

    // The worker consumes the mapping bindings, which are engine-neutral. Some
    // engine targets (blender) or genre templates don't declare the requested
    // target in engineTargets; resolve the mapping against a supported base
    // (browser) in that case so build creation never fails on a target the
    // template registry doesn't enumerate. The job still queues as input.target.
    const resolvedTemplate = this.resolveMappingForTarget(input.package, input.target);
    // Native engines build from the same projected component set the browser
    // plays, so a layer wired once reaches every renderer.
    const experienceBuild = this.experienceBuild.project({
      package: input.package,
      mappingManifest: resolvedTemplate.mappingManifest,
      templateId: resolvedTemplate.template.id,
    });

    await this.queue.publishBuild({
      jobId: build.id,
      target: input.target,
      experienceId,
      package: input.package,
      template: resolvedTemplate.template,
      mappingManifest: resolvedTemplate.mappingManifest,
      experienceBuild,
      callbackUrl: `${gatewayConfig().publicGatewayUrl.replace(/\/$/, '')}/v1/workers/${encodeURIComponent(input.target)}/callback`,
      requestedAt: now,
    });

    return this.updateBuild(build.id, {
      logs: [...build.logs, 'Build command published to queue.'],
    });
  }

  listBuilds(): BuildJob[] {
    this.recoverPersistedBuilds();
    return [...this.builds.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getBuild(id: string): BuildJob | null {
    this.recoverPersistedBuilds();
    return this.builds.get(id) || null;
  }

  listArtifacts(): ArtifactRecord[] {
    this.recoverPersistedBuilds();
    return [...this.artifacts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getArtifact(id: string): ArtifactRecord | null {
    this.recoverPersistedBuilds();
    return this.artifacts.get(id) || null;
  }

  /**
   * Delete a build and everything it owns: its artifact record(s), the in-memory
   * build entry, and the persisted manifest object on disk. Removing the disk
   * object matters — otherwise recoverPersistedBuilds re-adds the build on the
   * next list. Returns false if the build id is unknown.
   */
  deleteBuild(id: string): boolean {
    this.recoverPersistedBuilds();
    const build = this.builds.get(id);
    if (!build) return false;

    for (const artifact of [...this.artifacts.values()]) {
      if (artifact.jobId !== id && artifact.id !== build.artifactId) continue;
      if (artifact.storageKey) this.storage.deleteObject(artifact.storageKey);
      this.artifacts.delete(artifact.id);
    }
    this.builds.delete(id);
    return true;
  }

  /** Delete every build/artifact and their persisted manifests. Returns the count. */
  deleteAllBuilds(): number {
    this.recoverPersistedBuilds();
    const ids = [...this.builds.keys()];
    let removed = 0;
    for (const id of ids) {
      if (this.deleteBuild(id)) removed += 1;
    }
    return removed;
  }

  /**
   * Rebuild build/artifact records from the object store.
   *
   * Build state lives in memory, but every browser build durably writes
   * `<experienceId>/<buildId>/manifest.json`. Without this, restarting the
   * gateway emptied the console's build list and "Open Playable" silently fell
   * back to whichever build happened to be created since the restart — even
   * though every manifest was still on disk.
   *
   * Records already in memory win: a live or just-completed build is more
   * accurate than anything reconstructed from a filename.
   */
  private recoverPersistedBuilds(): void {
    const publicBaseUrl = gatewayConfig().publicGatewayUrl.replace(/\/$/, '');
    for (const { key, createdAt } of this.storage.listObjectKeys()) {
      const match = /^(.+)\/(build_[^/]+)\/manifest\.json$/.exec(key);
      if (!match) continue;
      const [, experienceId, buildId] = match;
      if (this.builds.has(buildId)) continue;

      const downloadUrl = `${publicBaseUrl}/v1/objects/${encodeURIComponent(key)}`;
      // The template is omitted deliberately: the runtime falls back to the
      // manifest's own templateId, so we never have to parse the payload here.
      const launchUrl = `${this.engineLaunchBase(publicBaseUrl)}?manifest=${encodeURIComponent(downloadUrl)}`;
      const artifact = this.createArtifact({
        jobId: buildId,
        experienceId,
        target: 'browser',
        kind: 'playable-session',
        launchUrl,
        downloadUrl,
        storageKey: key,
        contentType: 'application/json; charset=utf-8',
        metadata: { runtime: 'browser-engine', recovered: true },
      });
      this.builds.set(buildId, {
        id: buildId,
        experienceId,
        target: 'browser',
        status: 'succeeded',
        createdAt,
        updatedAt: createdAt,
        logs: ['Recovered from object store after a gateway restart.'],
        artifactId: artifact.id,
        launchUrl,
        downloadUrl,
      });
    }
  }

  async workerSucceeded(input: {
    jobId: string;
    engine: string;
    workerId?: string;
    artifactUrl?: string;
    launchUrl?: string;
    storageKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BuildJob> {
    const build = this.requireBuild(input.jobId);
    const artifact = this.createArtifact({
      jobId: build.id,
      experienceId: build.experienceId,
      target: build.target,
      kind: build.target === 'unreal' || build.target === 'unity' ? 'engine-build' : build.target === 'blender' ? 'asset-export' : 'playable-session',
      launchUrl: input.launchUrl,
      downloadUrl: input.artifactUrl,
      storageKey: input.storageKey,
      metadata: input.metadata,
    });

    return this.updateBuild(build.id, {
      status: 'succeeded',
      artifactId: artifact.id,
      launchUrl: artifact.launchUrl,
      downloadUrl: artifact.downloadUrl,
      workerId: input.workerId,
      logs: [...build.logs, `${input.engine} worker completed build.`],
    });
  }

  workerFailed(input: { jobId: string; engine: string; workerId?: string; error: string }): BuildJob {
    const build = this.requireBuild(input.jobId);
    return this.updateBuild(build.id, {
      status: 'failed',
      error: input.error,
      workerId: input.workerId,
      logs: [...build.logs, `${input.engine} worker failed build: ${input.error}`],
    });
  }

  /**
   * Resolve the playable template. The compiler picks a runtime archetype and
   * maps it to a concrete `playableTemplateId`; we honor that so each archetype
   * drives a different browser-engine runtime. If the archetype left it null
   * (AI-generated) or the id is invalid/unsupported for the target, we fall back
   * to the registry recommender.
   */
  /**
   * Resolve the mapping manifest for a queued engine build. Prefer the requested
   * target so its engineSkeleton is included; fall back to browser when the
   * chosen template doesn't declare the target (blender, or a genre template
   * limited to a subset of engines). Bindings are identical either way.
   */
  private resolveMappingForTarget(pkg: ExperiencePackage, target: EngineTarget) {
    try {
      return this.templates.resolve({ package: pkg, target });
    } catch {
      return this.templates.resolve({ package: pkg, target: 'browser' });
    }
  }

  private resolveTemplate(pkg: ExperiencePackage, target: EngineTarget) {
    // An explicit user genre selection (templatePreference) wins over the
    // archetype's default template mapping. resolve() honors the preference via
    // its hint matcher, falling back to the content recommender.
    if (typeof pkg.templatePreference === 'string' && pkg.templatePreference.trim()) {
      return this.templates.resolve({ package: pkg, target });
    }
    const preferredTemplateId = (pkg.runtimeContract as any)?.playableTemplateId;
    if (preferredTemplateId) {
      try {
        return this.templates.resolve({ package: pkg, target, preferredTemplateId: String(preferredTemplateId) });
      } catch (_) {
        // Invalid or target-incompatible archetype mapping — recommend instead.
      }
    }
    return this.templates.resolve({ package: pkg, target });
  }

  private async completeBrowserBuild(jobId: string, pkg: ExperiencePackage, target: EngineTarget, publicBaseUrl?: string, engineChoice?: string): Promise<BuildJob> {
    const build = this.requireBuild(jobId);
    const resolved = this.resolveTemplate(pkg, target);
    const gatewayBaseUrl = this.normalizePublicBaseUrl(publicBaseUrl).replace(/\/$/, '');
    // Rendering engine for the browser-engine runtime: 'pixi' (default) or
    // 'phaser'. boot.js reads it from manifest.engine (and the ?engine= param).
    const engine = this.normalizeEngine(engineChoice);
    // The engine-neutral component set (world, narrative, quests, cast,
    // knowledge, inventory, progression, challenges). Components reference
    // binding ids rather than copying content, so this adds structure, not bulk.
    const projected = this.experienceBuild.project({
      package: pkg,
      mappingManifest: resolved.mappingManifest,
      templateId: resolved.template.id,
    });
    const manifest = {
      ...resolved.mappingManifest,
      engine,
      components: projected.components,
      loadOrder: projected.loadOrder,
      componentValidation: projected.validation,
      title: pkg.experience?.title || 'Optimole Experience',
      // World identity (AI-chosen planet/region) — the runtime's WorldContext
      // titles the playable world from this before falling back to the title.
      world: (pkg.experience as any)?.world || null,
      progression: pkg.progression || {},
      runtimeContract: pkg.runtimeContract || {},
      analystChallenge: (pkg.blueprint as any)?.analystChallenge || null,
      proceduralMap: (pkg.blueprint as any)?.proceduralMap || null,
      skillTree: (pkg.blueprint as any)?.skillTree || [],
      preprocessing: this.preprocessingSummary((pkg.specification as any)?.preprocessing),
      semanticExtraction: (pkg.specification as any)?.semanticExtraction || null,
      gameplayNormalization: (pkg.specification as any)?.gameplayNormalization || null,
      storyboard: (pkg.blueprint as any)?.storyboard || (pkg.specification as any)?.storyboard || null,
      knowledgeGraph: (pkg.blueprint as any)?.knowledgeGraph || (pkg.specification as any)?.knowledgeGraph || null,
      experienceOutputType: (pkg.experience as any)?.outputType || (pkg.specification as any)?.experienceOutputType || null,
      outputExperience: (pkg.experience as any)?.outputExperience || null,
    };
    const payload = {
      meta: {
        title: pkg.experience?.title || 'Optimole Experience',
        subtitle: `${resolved.template.name} · Browser Engine`,
        genre: { id: resolved.template.id, title: resolved.template.name, family: resolved.template.genreFamily },
        briefing: this.firstQuestSummary(pkg) || 'Explore the generated Optimole experience.',
        roomSize: 6,
        // Signal loop wiring: the playable runtime's SignalEmitter posts player
        // observations to `${apiBase}/v1/persons/${personId}/signals`. personId
        // defaults to 'anonymous' until the person-node compile path stamps a real
        // one onto the package (step #3+). experienceId ties signals to this build.
        apiBase: gatewayBaseUrl,
        personId: (pkg.experience as any)?.personId || (pkg as any)?.personId || 'anonymous',
        experienceId: build.experienceId,
        // Loop #5: the World-Model hypothesis this experience was generated to test.
        experiment: (pkg as any)?.experiment || null,
        domain: (pkg.progression as any)?.domain || null,
        xpReward: (pkg.progression as any)?.xpReward || null,
        experienceOutputType: (pkg.experience as any)?.outputType || (pkg.specification as any)?.experienceOutputType || null,
        outputExperience: (pkg.experience as any)?.outputExperience || null,
      },
      manifest,
    };
    const stored = await this.storage.putObject({
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json; charset=utf-8',
      key: `${build.experienceId}/${build.id}/manifest.json`,
      publicBaseUrl: gatewayBaseUrl,
    });
    const launchUrl = `${this.engineLaunchBase(gatewayBaseUrl)}?manifest=${encodeURIComponent(stored.url)}&template=${encodeURIComponent(String(manifest.templateId || ''))}&engine=${encodeURIComponent(engine)}`;
    const artifact = this.createArtifact({
      jobId,
      experienceId: build.experienceId,
      target: build.target,
      kind: 'playable-session',
      launchUrl,
      downloadUrl: stored.url,
      storageKey: stored.key,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        runtime: 'browser-engine',
        templateId: manifest.templateId,
        templateName: resolved.template.name,
        domain: (pkg.progression as any)?.domain || null,
        xpReward: (pkg.progression as any)?.xpReward || null,
        experienceOutputType: (pkg.experience as any)?.outputType || (pkg.specification as any)?.experienceOutputType || null,
        mechanics: (pkg.runtimeContract as any)?.template?.mechanics || [],
        componentCoverage: projected.validation.componentCoverage,
        knowledgeGraphStats: ((pkg.blueprint as any)?.knowledgeGraph || (pkg.specification as any)?.knowledgeGraph)?.stats || null,
        storyboardCoverage: ((pkg.blueprint as any)?.storyboard || (pkg.specification as any)?.storyboard)?.coverage || null,
      },
    });

    return this.updateBuild(jobId, {
      status: 'succeeded',
      artifactId: artifact.id,
      launchUrl: artifact.launchUrl,
      downloadUrl: artifact.downloadUrl,
      logs: [...build.logs, `Browser-engine manifest compiled with ${resolved.template.id}.`, 'Playable runtime URL created.'],
    });
  }

  /**
   * The full preprocessing pipeline dump is ~98% of a browser manifest's bytes
   * (mostly `contentSanitization`, plus copies of knowledgeGraph /
   * semanticExtraction / storyboard / gameplayNormalization that the manifest
   * already carries at the top level). Nothing in the runtime reads it, so the
   * playable payload ships a descriptor instead of the raw pipeline output.
   */
  private preprocessingSummary(preprocessing: any): Record<string, unknown> | null {
    if (!preprocessing || typeof preprocessing !== 'object') return null;
    const stageNames = ['contentSanitization', 'semanticExtraction', 'emotionalIntelligence', 'knowledgeGraph', 'storyboard', 'gameplayNormalization'];
    const stages: Record<string, unknown> = {};
    for (const name of stageNames) {
      const stage = preprocessing[name];
      if (!stage || typeof stage !== 'object') continue;
      stages[name] = { id: stage.id ?? null, generatedAt: stage.generatedAt ?? null, stats: stage.stats ?? null };
    }
    return {
      schemaVersion: preprocessing.schemaVersion ?? null,
      kind: preprocessing.kind ?? null,
      id: preprocessing.id ?? null,
      generatedAt: preprocessing.generatedAt ?? null,
      stages,
      note: 'Stage detail omitted from the playable payload; fetch the experience record for full pipeline output.',
    };
  }

  private createArtifact(input: Omit<ArtifactRecord, 'id' | 'status' | 'createdAt'>): ArtifactRecord {
    const artifact: ArtifactRecord = {
      id: id('artifact'),
      status: 'ready',
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  private updateBuild(idValue: string, patch: Partial<BuildJob>): BuildJob {
    const current = this.requireBuild(idValue);
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.builds.set(idValue, next);
    return next;
  }

  private requireBuild(idValue: string): BuildJob {
    const build = this.builds.get(idValue);
    if (!build) throw new BadRequestException(`Unknown build job: ${idValue}`);
    return build;
  }

  private firstQuestSummary(pkg: ExperiencePackage): string {
    const quests = Array.isArray(pkg.blueprint?.quests) ? pkg.blueprint.quests : [];
    const firstQuest = quests[0] as { summary?: unknown } | undefined;
    return String(firstQuest?.summary || pkg.source?.text || '').slice(0, 280);
  }

  /**
   * The base the playable launch URL points at, up to and including the
   * trailing slash. When BROWSER_ENGINE_URL is set the engine runs standalone
   * (e.g. serve.py at https://localhost:8777), so link straight to it. Otherwise
   * fall back to the gateway-served engine at /v1/browser-engine.
   */
  /**
   * Normalize the requested browser rendering engine to what boot.js supports.
   * Anything containing "phaser" -> 'phaser'; everything else (incl. empty) ->
   * 'pixi', the default runtime. Keeps an unknown value from reaching the engine.
   */
  private normalizeEngine(engine?: string): 'pixi' | 'phaser' {
    return String(engine || '').toLowerCase().includes('phaser') ? 'phaser' : 'pixi';
  }

  private engineLaunchBase(gatewayBaseUrl: string): string {
    const configured = gatewayConfig().browserEngineUrl.trim();
    if (configured) return `${configured.replace(/\/+$/, '')}/`;
    return `${gatewayBaseUrl}/v1/browser-engine/`;
  }

  private normalizePublicBaseUrl(input?: string): string {
    const configured = gatewayConfig().publicGatewayUrl;
    const candidate = input || configured;
    try {
      const candidateUrl = new URL(candidate);
      const configuredUrl = new URL(configured);
      const isLocalOrPrivate = candidateUrl.hostname === 'localhost'
        || candidateUrl.hostname === '127.0.0.1'
        || candidateUrl.hostname.startsWith('192.168.')
        || candidateUrl.hostname.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(candidateUrl.hostname);
      // Only downgrade to http when the gateway itself is configured for http.
      // If PUBLIC_GATEWAY_URL is https (GATEWAY_HTTPS=true), keep https so the
      // launch URL matches the server the engine is actually served over.
      if (candidateUrl.protocol === 'https:' && isLocalOrPrivate && configuredUrl.protocol === 'http:') {
        candidateUrl.protocol = 'http:';
      }
      return candidateUrl.toString();
    } catch (_) {
      return configured;
    }
  }
}
