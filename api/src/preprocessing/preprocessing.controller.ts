import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NormalizeIrxRequest } from '../irx/irx.service';
import { PreprocessingPipelineService } from './preprocessing-pipeline.service';

@ApiTags('preprocessing')
@Controller('preprocessing')
export class PreprocessingController {
  constructor(private readonly pipeline: PreprocessingPipelineService) {}

  @Post('run')
  run(@Body() body: NormalizeIrxRequest) {
    return this.pipeline.run(body);
  }
}
