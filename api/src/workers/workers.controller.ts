import { BadRequestException, Body, Controller, Headers, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { BuildsService } from '../builds/builds.service';
import { ObjectStorageService } from '../integrations/object-storage.service';
import { QueueService } from '../integrations/queue.service';
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
  constructor(
    private readonly builds: BuildsService,
    private readonly queue: QueueService,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * Accept a finished engine-build artifact (a zip) from the worker and store it
   * in the gateway object store, returning a durable /v1/objects download URL.
   * This is the no-MinIO fallback: the worker deletes its workspace after each
   * job, so the artifact must be pushed here to remain downloadable. The raw zip
   * body is parsed by the express.raw() handler registered in main.ts.
   */
  @Post('artifacts/:jobId')
  async uploadArtifact(
    @Param('jobId') jobId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Req() request: Request,
  ) {
    if (authorization !== `Bearer ${gatewayConfig().workerCallbackToken}`) {
      throw new UnauthorizedException('Invalid worker callback token.');
    }
    const body = request.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException('Empty artifact body.');
    }
    const key = `jobs/${jobId}/game.zip`;
    const stored = await this.storage.putBinaryObject({
      body,
      contentType: contentType || 'application/zip',
      key,
    });
    return { ok: true, key: stored.key, url: stored.url, bytes: body.length };
  }

  /**
   * Pull the next queued build command from the gateway's in-memory queue.
   * Lets a worker consume memory-mode builds (BUILD_QUEUE_MODE=memory) over HTTP
   * instead of RabbitMQ/Redis. Returns `{ job: null }` when the queue is empty.
   * Bearer-authenticated with the same worker callback token.
   */
  @Post('next-build')
  nextBuild(@Headers('authorization') authorization: string | undefined) {
    if (authorization !== `Bearer ${gatewayConfig().workerCallbackToken}`) {
      throw new UnauthorizedException('Invalid worker callback token.');
    }
    return { ok: true, job: this.queue.dequeue() };
  }

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
