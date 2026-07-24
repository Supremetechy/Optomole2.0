import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SignalsService } from './signals.service';
import { PersonGraphService } from './person-graph.service';
import { WorldModelService } from './world-model.service';
import { ReflectionService } from './reflection.service';
import { SignalBatch } from './signal.types';

/**
 * SignalsController — the observation intake for the Experience Engine loop.
 *
 *   POST /v1/persons/:id/signals   ingest a batch from the playable runtime
 *   GET  /v1/persons/:id/signals   read a person's accumulated stream
 *   GET  /v1/persons               list persons that have emitted signals
 *
 * POST is intentionally unauthenticated: the emitter is client-side JS in the
 * game and cannot hold a secret. It's a write-only append keyed by personId.
 * TODO(auth): sign the launch URL with a short-lived per-session token and
 * verify it here; gate the GET read endpoints behind AdminGuard.
 */
@ApiTags('signals')
@Controller('persons')
export class SignalsController {
  constructor(
    private readonly signals: SignalsService,
    private readonly graph: PersonGraphService,
    private readonly world: WorldModelService,
    private readonly reflection: ReflectionService,
  ) {}

  @Post(':id/signals')
  ingest(@Param('id') id: string, @Body() body: SignalBatch) {
    const result = this.signals.ingest(id, body);
    // Auto-reflect: a session_end means a directed experience just finished, so
    // score it against its hypothesis immediately (no external nudge). Best-effort
    // — reflection must never fail signal ingestion.
    let reflection: unknown;
    if (Array.isArray(body?.signals) && body.signals.some((s) => s?.type === 'session_end')) {
      try {
        reflection = this.reflection.reflect(id);
      } catch {
        reflection = undefined;
      }
    }
    return { ok: true, ...result, ...(reflection ? { reflection } : {}) };
  }

  @Get(':id/signals')
  read(@Param('id') id: string) {
    return { ok: true, ...this.signals.read(id) };
  }

  /**
   * The person's compounding, confidence-weighted, time-decaying identity graph
   * folded from their signal stream (loop step #3). `halfLifeDays` tunes how fast
   * stale evidence decays; `asOf` (epoch ms) lets callers evaluate the graph at a
   * point in time (e.g. reproduce a past state); `k` tunes skepticism.
   */
  @Get(':id/graph')
  graphFor(
    @Param('id') id: string,
    @Query('halfLifeDays') halfLifeDays?: string,
    @Query('asOf') asOf?: string,
    @Query('k') k?: string,
  ) {
    return {
      ok: true,
      ...this.graph.build(id, {
        halfLifeDays: halfLifeDays ? Number(halfLifeDays) : undefined,
        asOf: asOf ? Number(asOf) : undefined,
        k: k ? Number(k) : undefined,
      }),
    };
  }

  /**
   * The World Model (loop #4): predictions + the uncertainty set + an
   * explore/exploit directive for the NEXT experience. The Experience Engine (#5)
   * feeds `recommendation.templateId`/`genre` into the compiler and treats
   * `recommendation.hypothesis` as what the next game is designed to learn.
   */
  @Get(':id/world-model')
  worldModel(
    @Param('id') id: string,
    @Query('halfLifeDays') halfLifeDays?: string,
    @Query('asOf') asOf?: string,
    @Query('k') k?: string,
  ) {
    return {
      ok: true,
      ...this.world.build(id, {
        halfLifeDays: halfLifeDays ? Number(halfLifeDays) : undefined,
        asOf: asOf ? Number(asOf) : undefined,
        k: k ? Number(k) : undefined,
      }),
    };
  }

  @Get()
  persons() {
    return { ok: true, persons: this.signals.persons() };
  }
}
