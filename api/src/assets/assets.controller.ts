import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GameplayDslService } from '../compiler/gameplay-dsl.service';
import { AssetGenerationService } from './asset-generation.service';
import { ExperienceAssetsService } from './experience-assets.service';
import { AssetKind, ASSET_KINDS, AssetRequest } from './asset.types';

interface GenerateRequest {
  requests: AssetRequest[];
  publicBaseUrl?: string;
}

interface BundleAssetsRequest {
  /** A bundle id returned by /v1/compiler/gameplay-dsl, or an inline bundle. */
  bundleId?: string;
  bundle?: any;
  kinds?: AssetKind[];
  includeVoice?: boolean;
  /** Plan only: show what would be generated and by whom, without spending. */
  dryRun?: boolean;
  publicBaseUrl?: string;
}

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly generation: AssetGenerationService,
    private readonly experienceAssets: ExperienceAssetsService,
    private readonly gameplayDsl: GameplayDslService,
  ) {}

  /**
   * What this deployment can produce right now: every provider, whether its key
   * is present, and which one each asset kind would route to. This is the first
   * thing to check when generated art does not appear — it names the reason.
   */
  @Get('providers')
  providers() {
    return { ok: true, ...this.generation.status(), kinds: ASSET_KINDS };
  }

  /** Generate specific assets. Individual failures are reported, not thrown. */
  @Post('generate')
  async generate(@Body() body: GenerateRequest) {
    const requests = Array.isArray(body?.requests) ? body.requests : [];
    if (!requests.length) throw new BadRequestException('requests[] is required.');
    for (const request of requests) {
      if (!request?.id || !request?.kind || !request?.prompt) {
        throw new BadRequestException('each request needs id, kind, and prompt.');
      }
      if (!ASSET_KINDS.includes(request.kind)) {
        throw new BadRequestException(`unknown asset kind "${request.kind}".`);
      }
    }
    const result = await this.generation.generateAll(requests, { publicBaseUrl: body.publicBaseUrl });
    return { ok: true, ...result };
  }

  /**
   * The one-pipeline entry point: take a compiled bundle, derive every asset it
   * wants from the content the compiler already understood, generate them, and
   * return the bundle with real art, audio, and models folded in.
   *
   * `dryRun` returns the plan and the routing decisions without calling any
   * vendor — worth doing first, since the plan says exactly what will be billed.
   */
  @Post('for-bundle')
  async forBundle(@Body() body: BundleAssetsRequest) {
    const bundle = body.bundle || (body.bundleId ? this.gameplayDsl.recall(body.bundleId) : null);
    if (!bundle) throw new BadRequestException('bundle or a still-cached bundleId is required.');

    const plan = this.experienceAssets.plan({
      bundle,
      kinds: body.kinds,
      includeVoice: body.includeVoice,
    });
    const status = this.generation.status();

    if (body.dryRun) {
      return {
        ok: true,
        dryRun: true,
        planned: plan.requests.length,
        byKind: countBy(plan.requests),
        routing: status.byKind,
        enabled: status.enabled,
        reason: status.reason,
        requests: plan.requests,
        rationale: plan.rationale,
      };
    }

    const { assets, summary } = await this.generation.generateAll(plan.requests, {
      publicBaseUrl: body.publicBaseUrl,
    });
    const upgraded = this.experienceAssets.apply(bundle, assets);
    const bundleId = this.gameplayDsl.remember(upgraded);

    return {
      ok: true,
      bundleId,
      bundleUrl: `/v1/compiler/gameplay-dsl/${bundleId}`,
      summary,
      enabled: status.enabled,
      reason: status.reason,
      assets,
      bundle: upgraded,
    };
  }
}

function countBy(requests: AssetRequest[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const request of requests) counts[request.kind] = (counts[request.kind] || 0) + 1;
  return counts;
}
