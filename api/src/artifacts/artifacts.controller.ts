import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ArtifactsService } from './artifacts.service';

@ApiTags('artifacts')
@Controller()
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get('artifacts')
  list() {
    return this.artifacts.list();
  }

  @Get('artifacts/:id')
  get(@Param('id') id: string) {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new NotFoundException('Artifact not found.');
    return { ok: true, artifact };
  }

  @Get('objects/:key')
  object(@Param('key') key: string, @Res() response: Response) {
    const object = this.artifacts.getObject(decodeURIComponent(key));
    if (!object) throw new NotFoundException('Object not found.');
    response.type(object.contentType).send(object.body);
  }
}
