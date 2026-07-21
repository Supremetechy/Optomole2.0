import { BadRequestException, Injectable } from '@nestjs/common';
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
  ) {}

  async createBuild(input: { package: ExperiencePackage; target: EngineTarget; publicBaseUrl?: string }): Promise<BuildJob> {
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
      return this.completeBrowserBuild(build.id, input.package, input.target, input.publicBaseUrl);
    }

    // The worker consumes the mapping bindings, which are engine-neutral. Some
    // engine targets (blender) or genre templates don't declare the requested
    // target in engineTargets; resolve the mapping against a supported base
    // (browser) in that case so build creation never fails on a target the
    // template registry doesn't enumerate. The job still queues as input.target.
    const resolvedTemplate = this.resolveMappingForTarget(input.package, input.target);

    await this.queue.publishBuild({
      jobId: build.id,
      target: input.target,
      experienceId,
      package: input.package,
      template: resolvedTemplate.template,
      mappingManifest: resolvedTemplate.mappingManifest,
      callbackUrl: `${gatewayConfig().publicGatewayUrl.replace(/\/$/, '')}/v1/workers/${encodeURIComponent(input.target)}/callback`,
      requestedAt: now,
    });

    return this.updateBuild(build.id, {
      logs: [...build.logs, 'Build command published to queue.'],
    });
  }

  listBuilds(): BuildJob[] {
    return [...this.builds.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getBuild(id: string): BuildJob | null {
    return this.builds.get(id) || null;
  }

  listArtifacts(): ArtifactRecord[] {
    return [...this.artifacts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getArtifact(id: string): ArtifactRecord | null {
    return this.artifacts.get(id) || null;
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

  private async completeBrowserBuild(jobId: string, pkg: ExperiencePackage, target: EngineTarget, publicBaseUrl?: string): Promise<BuildJob> {
    const build = this.requireBuild(jobId);
    const resolved = this.resolveTemplate(pkg, target);
    const gatewayBaseUrl = this.normalizePublicBaseUrl(publicBaseUrl).replace(/\/$/, '');
    const manifest = {
      ...resolved.mappingManifest,
      title: pkg.experience?.title || 'Optimole Experience',
      progression: pkg.progression || {},
      runtimeContract: pkg.runtimeContract || {},
      analystChallenge: (pkg.blueprint as any)?.analystChallenge || null,
      proceduralMap: (pkg.blueprint as any)?.proceduralMap || null,
      skillTree: (pkg.blueprint as any)?.skillTree || [],
      preprocessing: (pkg.specification as any)?.preprocessing || null,
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
    const launchUrl = `${this.engineLaunchBase(gatewayBaseUrl)}?manifest=${encodeURIComponent(stored.url)}&template=${encodeURIComponent(String(manifest.templateId || ''))}`;
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
