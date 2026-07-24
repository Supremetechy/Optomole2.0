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
    const decodedKey = decodeURIComponent(key);
    const object = this.artifacts.getObject(decodedKey);
    if (!object) throw new NotFoundException('Object not found.');
    const body = object.encoding === 'base64' ? Buffer.from(object.body, 'base64') : object.body;
    // Engine-build zips download as a file; text objects (manifests) render inline.
    if (/zip|octet-stream/i.test(object.contentType)) {
      const filename = decodedKey.split('/').pop() || 'artifact.zip';
      response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    response.type(object.contentType).send(body);
  }
}
