import { BadRequestException, Injectable } from '@nestjs/common';
import { AiGenerationService } from '../integrations/ai-generation.service';
import { BuildsService } from '../builds/builds.service';
import { EngineTarget, SourcePayload } from '../shared/types';
import { WorldModelService } from './world-model.service';
import { ExperimentStore, ExperimentRecord } from './experiment.store';

/**
 * NextExperienceService — loop step #5. Closes the cycle.
 *
 * Given a person and some source content, it asks the World Model (#4) what the
 * next experience should be (explore vs exploit, which genre, what hypothesis),
 * steers the Experience Engine with that directive, stamps the person's id onto
 * the build so the signals it emits attribute back to THIS person, and records
 * the experiment so we know what the experience was testing.
 *
 *   World Model → directive → steered Experience Engine → Experience
 *        ↑                                                     │
 *        └──────── signals (tagged personId + experienceId) ───┘
 *
 * That tagging is the actual loop closure: the manifest carries meta.personId, the
 * SignalEmitter posts to /v1/persons/<personId>/signals, those signals re-enter
 * the graph → world model → the next directive. Self-directed learning.
 */
@Injectable()
export class NextExperienceService {
  constructor(
    private readonly aiGeneration: AiGenerationService,
    private readonly builds: BuildsService,
    private readonly world: WorldModelService,
    private readonly experiments: ExperimentStore,
  ) {}

  async next(
    personId: string,
    body: { source: SourcePayload; options?: Record<string, unknown>; target?: EngineTarget },
  ) {
    const id = String(personId || '').trim();
    if (!id) throw new BadRequestException('personId is required.');
    if (!body?.source || (!body.source.text && !body.source.title && !body.source.uri)) {
      throw new BadRequestException('source with text, title, or uri is required.');
    }

    const model = this.world.build(id, {});
    const rec = model.recommendation;

    const options: Record<string, unknown> = { ...(body.options || {}) };
    // The World Model steers genre/template unless the caller explicitly pinned one.
    const callerPinned = !!(options.templateId || options.genre);
    const steered = !callerPinned && !!rec.templateId;
    if (steered) options.genre = rec.templateId; // options.genre accepts a template id

    const experiment = {
      hypothesis: rec.hypothesis,
      mode: rec.mode,
      rationale: rec.rationale,
      topicFocus: rec.topicFocus ?? null,
      modelAsOf: model.asOf,
      steered,
    };
    options.experiment = experiment;

    // Compile, then stamp identity + experiment onto the package BEFORE building so
    // completeBrowserBuild propagates them into the manifest meta (personId → signal
    // attribution; experiment → recorded on the playable).
    const pkg = await this.aiGeneration.compileExperience({ source: body.source, options });
    (pkg as Record<string, unknown>).personId = id;
    (pkg as Record<string, unknown>).experiment = experiment;

    const publicBaseUrl = String(options.publicGatewayUrl || options.publicBaseUrl || '');
    const build = await this.builds.createBuild({ package: pkg, target: body.target || 'browser', publicBaseUrl });

    const record: ExperimentRecord = this.experiments.record({
      experienceId: build.experienceId,
      buildId: build.id,
      personId: id,
      createdAt: new Date().toISOString(),
      hypothesis: rec.hypothesis,
      mode: rec.mode,
      genre: rec.genre,
      templateId: rec.templateId || (steered ? String(options.genre) : undefined),
      topicFocus: rec.topicFocus ?? null,
      rationale: rec.rationale,
      steered,
      status: 'pending',
    });

    return {
      ok: true,
      personId: id,
      recommendation: rec,
      experiment: record,
      modelConfidence: model.modelConfidence,
      build,
      playable: build.launchUrl ? { url: build.launchUrl, jobId: build.id, target: build.target } : null,
    };
  }
}