import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ExperienceCompilerService } from './experience-compiler.service';
import { SourcePayload } from '../shared/types';

interface CompileManifestRequest {
  source: SourcePayload;
  options?: Record<string, unknown>;
}

@ApiTags('compiler')
@Controller('compiler')
export class CompilerController {
  constructor(private readonly compiler: ExperienceCompilerService) {}

  @Post('experience-manifest')
  async experienceManifest(@Body() body: CompileManifestRequest) {
    const pkg = await this.compiler.compileWithAi(body.source, body.options || {});
    return {
      ok: true,
      package: pkg,
      experienceManifest: pkg.specification?.experienceManifest,
    };
  }
}
