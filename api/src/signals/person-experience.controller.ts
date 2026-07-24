import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NextExperienceService } from './next-experience.service';
import { ReflectionService } from './reflection.service';
import { ExperimentStore } from './experiment.store';
import { EngineTarget, SourcePayload } from '../shared/types';

/**
 * PersonExperienceController — the generative side of the loop (step #5).
 *
 *   POST /v1/persons/:id/next-experience   build the next experience the World
 *                                          Model wants, steered by its directive
 *   GET  /v1/persons/:id/experiments       the person's experiment ledger
 *
 * Shares the `persons` path with SignalsController; routes don't collide.
 */
@ApiTags('signals')
@Controller('persons')
export class PersonExperienceController {
  constructor(
    private readonly nextExperience: NextExperienceService,
    private readonly reflection: ReflectionService,
    private readonly experiments: ExperimentStore,
  ) {}

  @Post(':id/next-experience')
  next(
    @Param('id') id: string,
    @Body() body: { source: SourcePayload; options?: Record<string, unknown>; target?: EngineTarget },
  ) {
    return this.nextExperience.next(id, body);
  }

  @Get(':id/experiments')
  experimentsFor(@Param('id') id: string) {
    return { ok: true, personId: id, experiments: this.experiments.listForPerson(id) };
  }

  /**
   * Reflection (loop #6): score every played-but-unscored experiment against the
   * signals it produced, record the verdict, and feed the conclusions back into
   * the person's stream as `insight:*` nodes. Returns what was learned — outcomes,
   * surprises, discoveries, drifts, and who the person is becoming.
   */
  @Post(':id/reflect')
  reflect(@Param('id') id: string) {
    return this.reflection.reflect(id);
  }
}
