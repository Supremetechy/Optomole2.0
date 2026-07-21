import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { gatewayConfig } from '../shared/config';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  health() {
    const config = gatewayConfig();
    return {
      ok: true,
      service: 'optimole-api-gateway',
      nodeEnv: config.nodeEnv,
      queueMode: config.buildQueueMode,
      objectStorageMode: config.objectStorageMode,
      timestamp: new Date().toISOString(),
    };
  }
}
