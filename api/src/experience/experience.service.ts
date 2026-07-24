import { BadRequestException, Injectable } from '@nestjs/common';
import { AiGenerationService } from '../integrations/ai-generation.service';
import { BuildsService } from '../builds/builds.service';
import { EngineTarget, SourcePayload } from '../shared/types';

@Injectable()
export class ExperienceService {
  constructor(
    private readonly aiGeneration: AiGenerationService,
    private readonly builds: BuildsService,
  ) {}

  async compile(body: { source: SourcePayload; options?: Record<string, unknown> }) {
    if (!body?.source || (!body.source.text && !body.source.title && !body.source.uri)) {
      throw new BadRequestException('source with text, title, or uri is required.');
    }

    const experiencePackage = await this.aiGeneration.compileExperience(body);
    // Per-user identity: stamp the caller's personId onto the package so the build
    // propagates it into manifest meta.personId, which is where the playable's
    // SignalEmitter reads it — so signals from this game attribute to this person
    // (not the shared 'anonymous' bucket). Empty/absent → stays anonymous.
    const personId = body.options?.personId;
    if (personId) (experiencePackage as Record<string, unknown>).personId = String(personId);
    return {
      ok: true,
      package: experiencePackage,
    };
  }

  async compileAndLaunch(body: { source: SourcePayload; options?: Record<string, unknown>; target?: EngineTarget }) {
    const compiled = await this.compile(body);
    const publicBaseUrl = String(body.options?.publicGatewayUrl || body.options?.publicBaseUrl || '');
    const engine = String(body.options?.engine || (body as any).engine || '');
    const build = await this.builds.createBuild({
      package: compiled.package,
      target: body.target || 'browser',
      publicBaseUrl,
      engine,
    });

    return {
      ok: true,
      package: compiled.package,
      build,
      playable: build.launchUrl ? { url: build.launchUrl, jobId: build.id, target: build.target } : null,
    };
  }
}
