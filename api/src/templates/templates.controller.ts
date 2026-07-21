import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RegisterTemplateInput, TemplatesService } from './templates.service';
import { EngineTarget, ExperiencePackage } from '../shared/types';

interface ResolveTemplateRequest {
  package: ExperiencePackage;
  target?: EngineTarget;
  preferredTemplateId?: string;
}

@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list() {
    return this.templates.listTemplates();
  }

  @Post('register')
  register(@Body() body: RegisterTemplateInput) {
    return this.templates.register(body);
  }

  @Post('resolve')
  resolve(@Body() body: ResolveTemplateRequest) {
    return this.templates.resolve(body);
  }

  @Get(':id/compatibility')
  compatibility(@Param('id') id: string, @Query('target') target?: EngineTarget) {
    return this.templates.compatibility(id, target);
  }

  @Post(':id/validate-package')
  validatePackage(@Param('id') id: string, @Body() body: { package: ExperiencePackage; target?: EngineTarget }) {
    return this.templates.validatePackage(id, body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.templates.getTemplate(id);
  }
}
