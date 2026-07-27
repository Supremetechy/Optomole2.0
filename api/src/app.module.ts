import { Module } from '@nestjs/common';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { AccountStore } from './accounts/accounts.store';
import { PersonNodeAdapterService } from './person-node/person-node.adapter';
import { AdminGuard } from './shared/admin.guard';
import { ArtifactsController } from './artifacts/artifacts.controller';
import { ArtifactsService } from './artifacts/artifacts.service';
import { BuildsController } from './builds/builds.controller';
import { BuildsService } from './builds/builds.service';
import { AssetGenerationService } from './assets/asset-generation.service';
import { AssetProviderRegistry } from './assets/asset-provider.registry';
import { AssetsController } from './assets/assets.controller';
import { ExperienceAssetsService } from './assets/experience-assets.service';
import { BehaviorCompilerService } from './compiler/behavior-compiler.service';
import { CompilerController } from './compiler/compiler.controller';
import { ExperienceDirectiveService } from './compiler/experience-directive.service';
import { FormSynthesisService } from './compiler/form-synthesis.service';
import { SemanticModelService } from './compiler/semantic-model.service';
import { ExperienceBuildService } from './compiler/experience-build.service';
import { ExperienceCompilerService } from './compiler/experience-compiler.service';
import { GameplayDslService } from './compiler/gameplay-dsl.service';
import { EmailController } from './email/email.controller';
import { EmailService } from './email/email.service';
import { ExperienceController } from './experience/experience.controller';
import { ExperienceService } from './experience/experience.service';
import { GdpController } from './gdp/gdp.controller';
import { GdpService } from './gdp/gdp.service';
import { HealthController } from './health/health.controller';
import { IrxController } from './irx/irx.controller';
import { IrxService } from './irx/irx.service';
import { AiGenerationService } from './integrations/ai-generation.service';
import { QueueService } from './integrations/queue.service';
import { ObjectStorageService } from './integrations/object-storage.service';
import { ContentSanitizationService } from './preprocessing/content-sanitization.service';
import { EmotionalIntelligenceService } from './preprocessing/emotional-intelligence.service';
import { GameplayNormalizationService } from './preprocessing/gameplay-normalization.service';
import { KnowledgeGraphService } from './preprocessing/knowledge-graph.service';
import { PreprocessingController } from './preprocessing/preprocessing.controller';
import { PreprocessingPipelineService } from './preprocessing/preprocessing-pipeline.service';
import { SemanticExtractionService } from './preprocessing/semantic-extraction.service';
import { StoryboardService } from './preprocessing/storyboard.service';
import { TemplatesController } from './templates/templates.controller';
import { TemplatesService } from './templates/templates.service';
import { TranscriptionController } from './transcription/transcription.controller';
import { TranscriptionService } from './transcription/transcription.service';
import { WorkersController } from './workers/workers.controller';
import { GameReferencesController } from './game-references/game-references.controller';
import { GameReferencesService } from './game-references/game-references.service';
import { SignalsController } from './signals/signals.controller';
import { SignalsService } from './signals/signals.service';
import { SignalStore } from './signals/signals.store';
import { PersonGraphService } from './signals/person-graph.service';
import { WorldModelService } from './signals/world-model.service';
import { NextExperienceService } from './signals/next-experience.service';
import { ReflectionService } from './signals/reflection.service';
import { ExperimentStore } from './signals/experiment.store';
import { PersonExperienceController } from './signals/person-experience.controller';

@Module({
  controllers: [HealthController, ExperienceController, EmailController, GdpController, BuildsController, WorkersController, ArtifactsController, TemplatesController, IrxController, TranscriptionController, CompilerController, AssetsController, PreprocessingController, AccountsController, GameReferencesController, SignalsController, PersonExperienceController],
  providers: [ExperienceService, EmailService, GdpService, BuildsService, AiGenerationService, QueueService, ObjectStorageService, ArtifactsService, TemplatesService, IrxService, TranscriptionService, ExperienceCompilerService, AssetProviderRegistry, AssetGenerationService, ExperienceAssetsService, ExperienceBuildService, SemanticModelService, ExperienceDirectiveService, FormSynthesisService, BehaviorCompilerService, GameplayDslService, PreprocessingPipelineService, ContentSanitizationService, SemanticExtractionService, EmotionalIntelligenceService, GameplayNormalizationService, StoryboardService, KnowledgeGraphService, AccountsService, AccountStore, PersonNodeAdapterService, AdminGuard, GameReferencesService, SignalsService, SignalStore, PersonGraphService, WorldModelService, NextExperienceService, ReflectionService, ExperimentStore],
})
export class AppModule {}
