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
    return {
      ok: true,
      package: experiencePackage,
    };
  }

  async compileAndLaunch(body: { source: SourcePayload; options?: Record<string, unknown>; target?: EngineTarget }) {
    const compiled = await this.compile(body);
    const publicBaseUrl = String(body.options?.publicGatewayUrl || body.options?.publicBaseUrl || '');
    const build = await this.builds.createBuild({
      package: compiled.package,
      target: body.target || 'browser',
      publicBaseUrl,
    });

    return {
      ok: true,
      package: compiled.package,
      build,
      playable: build.launchUrl ? { url: build.launchUrl, jobId: build.id, target: build.target } : null,
    };
  }
}
