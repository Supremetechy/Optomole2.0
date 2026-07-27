import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BehaviorCompilerService } from './behavior-compiler.service';
import { ExperienceBuildService } from './experience-build.service';
import { ExperienceCompilerService } from './experience-compiler.service';
import { ExperienceDirectiveService } from './experience-directive.service';
import { FormSynthesisService } from './form-synthesis.service';
import { GameplayDslService } from './gameplay-dsl.service';
import { SemanticModelService } from './semantic-model.service';
import { EngineTarget, ExperiencePackage, SourcePayload } from '../shared/types';
import { TemplatesService } from '../templates/templates.service';

interface CompileManifestRequest {
  source: SourcePayload;
  options?: Record<string, unknown>;
}

interface CompileGameplayDslRequest {
  package: ExperiencePackage;
  target?: EngineTarget;
  templateId?: string;
  /** Return the intermediate stage output alongside the bundle (debug/inspection). */
  includeStages?: boolean;
}

@ApiTags('compiler')
@Controller('compiler')
export class CompilerController {
  constructor(
    private readonly compiler: ExperienceCompilerService,
    private readonly templates: TemplatesService,
    private readonly experienceBuild: ExperienceBuildService,
    private readonly semanticModel: SemanticModelService,
    private readonly directives: ExperienceDirectiveService,
    private readonly forms: FormSynthesisService,
    private readonly behaviors: BehaviorCompilerService,
    private readonly gameplayDsl: GameplayDslService,
  ) {}

  @Post('experience-manifest')
  async experienceManifest(@Body() body: CompileManifestRequest) {
    const pkg = await this.compiler.compileWithAi(body.source, body.options || {});
    return {
      ok: true,
      package: pkg,
      experienceManifest: pkg.specification?.experienceManifest,
    };
  }

  /**
   * Compile a package into a Gameplay DSL bundle — the pure-data game format
   * the RuntimeCore plays through any EngineAdapter.
   *
   * This is the full 5-stage compiler, not a 2-stage loader:
   *
   *   0/1  SemanticModelService       package + preprocessing -> ContentNode[] / SemanticNode[]
   *   2    ExperienceDirectiveService SemanticNode[]          -> ExperienceDirective[]
   *   2.5  FormSynthesisService       SemanticNode[]          -> topology / verbs / resolution
   *   3    BehaviorCompilerService    ExperienceDirective[]   -> state machines / directors / sequences
   *   4    (runtime)                  the adapter blindly runs actions
   *
   * Stage 2.5 is what decides the KIND of game; the stages around it decide how
   * it feels and what it is about. The emitter composes from all three, so two
   * uploads with different shapes compile to structurally different games rather
   * than to the same platformer with different labels.
   *
   * The ExperienceBuild projection still runs alongside, because it is what
   * carries the *content* (bindings, quests, cast) while the directive chain
   * carries the *behavior*. The emitter joins them.
   *
   * The bundle is returned inline AND cached under `bundleUrl`, so a runtime can
   * be pointed at it with `?bundle=<url>` without re-posting the package.
   */
  @Post('gameplay-dsl')
  compileGameplayDsl(@Body() body: CompileGameplayDslRequest) {
    const target = body.target || 'browser';
    const resolved = this.templates.resolve({
      package: body.package,
      target,
      preferredTemplateId: body.templateId,
    });
    const build = this.experienceBuild.project({
      package: body.package,
      mappingManifest: resolved.mappingManifest,
      templateId: resolved.template.id,
    });

    const model = this.semanticModel.project({
      package: body.package,
      mappingManifest: resolved.mappingManifest,
    });
    const directiveSet = this.directives.resolve({ model, package: body.package as Record<string, any> });
    const form = this.forms.synthesize({ model, package: body.package as Record<string, any> });
    const behaviors = this.behaviors.compile({ directives: directiveSet, model, form });

    const bundle = this.gameplayDsl.compile({ build, behaviors, form });
    const bundleId = this.gameplayDsl.remember(bundle);

    return {
      ok: true,
      bundleId,
      bundleUrl: `/v1/compiler/gameplay-dsl/${bundleId}`,
      templateId: resolved.template.id,
      form: { signature: form.signature, topology: form.topology, verbs: form.verbs, resolution: form.resolution },
      componentValidation: build.validation,
      // Every stage reports what it dropped, so an empty region or an
      // unfought hazard is visible here rather than as a missing entity.
      pipelineValidation: {
        semanticModel: model.coverage,
        semanticStats: model.stats,
        directives: directiveSet.coverage,
        form: form.coverage,
        behaviors: behaviors.validation,
        bundle: bundle.validation,
      },
      ...(body.includeStages
        ? { stages: { semanticModel: model, directives: directiveSet, form, behaviors } }
        : {}),
      bundle,
    };
  }

  /**
   * Stage 0-3 only, without emitting a bundle. Useful for inspecting what the
   * compiler understood from a package — which content became actors, which
   * moods drove pacing, and what each directive's numbers were derived from.
   */
  @Post('directives')
  compileDirectives(@Body() body: CompileGameplayDslRequest) {
    const resolved = this.templates.resolve({
      package: body.package,
      target: body.target || 'browser',
      preferredTemplateId: body.templateId,
    });
    const model = this.semanticModel.project({
      package: body.package,
      mappingManifest: resolved.mappingManifest,
    });
    const directiveSet = this.directives.resolve({ model, package: body.package as Record<string, any> });
    const form = this.forms.synthesize({ model, package: body.package as Record<string, any> });
    const behaviors = this.behaviors.compile({ directives: directiveSet, model, form });
    return { ok: true, semanticModel: model, directives: directiveSet, form, behaviors };
  }

  @Get('gameplay-dsl/:id')
  getGameplayDsl(@Param('id') id: string) {
    const bundle = this.gameplayDsl.recall(id);
    if (!bundle) throw new NotFoundException('Bundle not found or evicted from the cache.');
    return { ok: true, bundle };
  }
}
