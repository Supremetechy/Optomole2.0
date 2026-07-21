import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GdpService } from './gdp.service';
import { SourcePayload } from '../shared/types';

interface GdpRequest {
  source: SourcePayload;
  options?: Record<string, unknown>;
}

@ApiTags('gdp')
@Controller('gdp')
export class GdpController {
  constructor(private readonly gdp: GdpService) {}

  @Post('create')
  create(@Body() body: GdpRequest) {
    return this.gdp.create(body);
  }

  @Post('manifest')
  manifest(@Body() body: GdpRequest) {
    return this.gdp.manifest(body);
  }
}
