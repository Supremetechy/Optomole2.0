import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BuildsService } from '../builds/builds.service';
import { gatewayConfig } from '../shared/config';

interface WorkerCallback {
  jobId: string;
  status: 'succeeded' | 'failed';
  workerId?: string;
  artifactUrl?: string;
  launchUrl?: string;
  storageKey?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

@ApiTags('workers')
@Controller('workers')
export class WorkersController {
  constructor(private readonly builds: BuildsService) {}

  @Post(':engine/callback')
  callback(
    @Param('engine') engine: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: WorkerCallback,
  ) {
    const expected = `Bearer ${gatewayConfig().workerCallbackToken}`;
    if (authorization !== expected) {
      throw new UnauthorizedException('Invalid worker callback token.');
    }

    if (body.status === 'failed') {
      return {
        ok: true,
        build: this.builds.workerFailed({
          jobId: body.jobId,
          engine,
          workerId: body.workerId,
          error: body.error || 'Worker failed without an error message.',
        }),
      };
    }

    return {
      ok: true,
      build: this.builds.workerSucceeded({
        jobId: body.jobId,
        engine,
        workerId: body.workerId,
        artifactUrl: body.artifactUrl,
        launchUrl: body.launchUrl,
        storageKey: body.storageKey,
        metadata: body.metadata,
      }),
    };
  }
}
