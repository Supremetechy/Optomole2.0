import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ExperienceService } from './experience.service';
import { EngineTarget, SourcePayload } from '../shared/types';

interface CompileRequest {
  source: SourcePayload;
  options?: Record<string, unknown>;
}

interface LaunchRequest extends CompileRequest {
  target?: EngineTarget;
}

@ApiTags('experiences')
@Controller('experiences')
export class ExperienceController {
  constructor(private readonly experienceService: ExperienceService) {}

  @Post('compile')
  compile(@Body() body: CompileRequest) {
    return this.experienceService.compile(body);
  }

  @Post('launch')
  launch(@Body() body: LaunchRequest) {
    return this.experienceService.compileAndLaunch(body);
  }
}
