import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BuildsService } from './builds.service';
import { EngineTarget, ExperiencePackage } from '../shared/types';

interface CreateBuildRequest {
  package: ExperiencePackage;
  target?: EngineTarget;
  publicGatewayUrl?: string;
  publicBaseUrl?: string;
}

@ApiTags('builds')
@Controller('builds')
export class BuildsController {
  constructor(private readonly builds: BuildsService) {}

  @Post()
  create(@Body() body: CreateBuildRequest) {
    return this.builds.createBuild({
      package: body.package,
      target: body.target || 'browser',
      publicBaseUrl: body.publicGatewayUrl || body.publicBaseUrl,
    });
  }

  @Get()
  list() {
    return { ok: true, builds: this.builds.listBuilds() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const build = this.builds.getBuild(id);
    if (!build) throw new NotFoundException('Build not found.');
    return { ok: true, build };
  }
}
