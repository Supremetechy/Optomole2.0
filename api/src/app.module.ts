import { Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts/artifacts.controller';
import { ArtifactsService } from './artifacts/artifacts.service';
import { BuildsController } from './builds/builds.controller';
import { BuildsService } from './builds/builds.service';
import { CompilerController } from './compiler/compiler.controller';
import { ExperienceCompilerService } from './compiler/experience-compiler.service';
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

@Module({
  controllers: [HealthController, ExperienceController, EmailController, GdpController, BuildsController, WorkersController, ArtifactsController, TemplatesController, IrxController, TranscriptionController, CompilerController, PreprocessingController],
  providers: [ExperienceService, EmailService, GdpService, BuildsService, AiGenerationService, QueueService, ObjectStorageService, ArtifactsService, TemplatesService, IrxService, TranscriptionService, ExperienceCompilerService, PreprocessingPipelineService, ContentSanitizationService, SemanticExtractionService, EmotionalIntelligenceService, GameplayNormalizationService, StoryboardService, KnowledgeGraphService],
})
export class AppModule {}
