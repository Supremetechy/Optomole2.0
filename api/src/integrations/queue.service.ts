import { Injectable } from '@nestjs/common';
import { connect as connectRabbit } from 'amqplib';
import Redis from 'ioredis';
import { gatewayConfig } from '../shared/config';
import { BuildCommand } from '../shared/types';

@Injectable()
export class QueueService {
  private memoryQueue: BuildCommand[] = [];

  async publishBuild(command: BuildCommand): Promise<void> {
    const config = gatewayConfig();

    if (config.buildQueueMode === 'rabbitmq') {
      const connection = await connectRabbit(config.rabbitmqUrl);
      const channel = await connection.createChannel();
      await channel.assertQueue(config.buildQueueName, { durable: true });
      channel.sendToQueue(config.buildQueueName, Buffer.from(JSON.stringify(command)), { persistent: true });
      await channel.close();
      await connection.close();
      return;
    }

    if (config.buildQueueMode === 'redis') {
      const redis = new Redis(config.redisUrl);
      await redis.lpush(config.buildQueueName, JSON.stringify(command));
      redis.disconnect();
      return;
    }

    this.memoryQueue.push(command);
  }

  listMemoryQueue(): BuildCommand[] {
    return [...this.memoryQueue];
  }

  /**
   * Pop the next queued command (FIFO), or null when empty. The in-memory queue
   * lives inside the gateway process, so a separate worker can't read it
   * directly — it pulls jobs through the gateway via WorkersController's
   * next-build endpoint, which calls this.
   */
  dequeue(): BuildCommand | null {
    return this.memoryQueue.shift() || null;
  }
}
