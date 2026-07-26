import { Injectable } from '@nestjs/common';
import { GameplayDslBundle } from '../compiler/gameplay-dsl.service';
import { AssetKind, AssetRequest, AssetStyle, GeneratedAsset } from './asset.types';

/**
 * ExperienceAssetsService — the join between the content compiler and the
 * asset providers.
 *
 * Stage 2 already decided what an experience looks and feels like: the asset
 * directives carry a palette derived from the source's emotional arc, a role
 * per sprite, and a tone. That is exactly the material a text-to-image or
 * text-to-audio prompt needs, and until now it only ever drove flat-colour
 * placeholder rectangles.
 *
 * So prompts are DERIVED, never hand-written. A tense incident report and a
 * calm tutorial produce different art because they already produced different
 * palettes and tones — the same reason their enemies differ. If prompts were
 * authored here instead, every generated experience would look identical again,
 * which is the failure this whole pipeline exists to avoid.
 */

/** Sprite roles the compiler emits, mapped to what the art should depict. */
const ROLE_SUBJECTS: Record<string, string> = {
  player: 'a heroic player character sprite, full body, facing right',
  enemy: 'a menacing enemy creature sprite, full body, facing left',
  npc: 'a friendly non-player character sprite, full body, facing forward',
  item: 'a single collectible pickup icon, centered',
  goal: 'a goal marker flag or portal, centered',
  terrain: 'a seamless ground and platform tile',
  prop: 'a small scenery prop object, centered',
};

/** Every generated sprite needs these, or it will not composite into a scene. */
const SPRITE_CONSTRAINTS =
  'game asset, transparent background, orthographic side view, clean silhouette, '
  + 'no text, no watermark, no drop shadow, centered in frame';

export interface AssetPlan {
  requests: AssetRequest[];
  /** Why each request exists, for the operator inspecting a plan before paying. */
  rationale: Record<string, string>;
}

@Injectable()
export class ExperienceAssetsService {
  /**
   * Derive every asset an experience wants. `kinds` narrows the plan — a 2D
   * browser build has no use for 3D models, and audio may be deferred.
   */
  plan(input: {
    bundle: GameplayDslBundle;
    kinds?: AssetKind[];
    /** Voice lines are expensive and optional; off unless asked for. */
    includeVoice?: boolean;
  }): AssetPlan {
    const bundle = input.bundle;
    const wanted = new Set<AssetKind>(input.kinds?.length ? input.kinds : ['sprite', 'music', 'sfx']);
    const requests: AssetRequest[] = [];
    const rationale: Record<string, string> = {};

    const title = String((bundle.game as any)?.title || 'Optomole Experience');
    const style = this.styleOf(bundle);

    // ---- sprites: one per declared vocabulary entry ----
    if (wanted.has('sprite')) {
      for (const asset of bundle.assets || []) {
        const subject = ROLE_SUBJECTS[asset.role] || `a ${asset.role} game sprite`;
        requests.push({
          id: asset.spriteId,
          kind: 'sprite',
          prompt: [
            subject,
            `themed for "${title}"`,
            style.tone ? `mood: ${style.tone}` : '',
            colourGuidance(asset.tint, style.palette),
            SPRITE_CONSTRAINTS,
          ].filter(Boolean).join(', '),
          style,
          format: 'png',
          // The compiler sizes colliders in metres; art is requested at a power
          // of two large enough for the largest sprite, then scaled by the
          // renderer. Asking for exact collider pixels gives unusable art.
          width: 512,
          height: 512,
          // Same seed for the same sprite id keeps a re-run visually stable.
          seed: seedFrom(asset.spriteId),
        });
        rationale[asset.spriteId] = `sprite for role "${asset.role}" declared by the asset directive`;
      }
    }

    // ---- 3D: one model per distinct entity archetype ----
    if (wanted.has('model3d')) {
      for (const archetype of this.archetypesOf(bundle)) {
        const id = `model-${archetype}`;
        requests.push({
          id,
          kind: 'model3d',
          prompt: `low-poly game-ready 3D model of ${ROLE_SUBJECTS[archetype] || `a ${archetype}`}, `
            + `themed for "${title}"${style.tone ? `, mood ${style.tone}` : ''}, clean topology, single mesh`,
          style,
          format: 'glb',
        });
        rationale[id] = `3D model for the "${archetype}" archetype placed in this build`;
      }
    }

    // ---- music: one track per region, following that region's pacing ----
    if (wanted.has('music')) {
      for (const scene of bundle.scenes || []) {
        const id = `music-${scene.id}`;
        const intensity = Number((scene as any).ambientIntensity ?? 0.5);
        requests.push({
          id,
          kind: 'music',
          prompt: `looping instrumental game music for a level called "${scene.name}", `
            + `${intensity > 0.7 ? 'urgent and driving' : intensity < 0.35 ? 'calm and sparse' : 'steady and atmospheric'}`
            + `${style.tone ? `, evoking ${style.tone}` : ''}, no vocals`,
          style,
          format: 'mp3',
          durationSeconds: 30,
        });
        rationale[id] = `region theme; intensity ${intensity} came from that region's pacing directive`;
      }
    }

    // ---- sfx: the events the runtime actually emits ----
    if (wanted.has('sfx')) {
      const effects: Array<[string, string]> = [
        ['sfx-collect', 'a short bright pickup chime, single hit, dry'],
        ['sfx-hit', 'a short impact thud for taking damage, single hit, dry'],
        ['sfx-goal', 'a short triumphant level-complete flourish'],
      ];
      if ((bundle.validation?.contributions?.enemies ?? 0) > 0) {
        effects.push(['sfx-attack', 'a short weapon swing whoosh, single hit, dry']);
      }
      for (const [id, description] of effects) {
        requests.push({ id, kind: 'sfx', prompt: `${description}, game sound effect, mono`, style, format: 'wav', durationSeconds: 2 });
        rationale[id] = 'sound effect for an event the compiled triggers emit';
      }
    }

    // ---- voice: one line per speaking character ----
    if (wanted.has('voice') || input.includeVoice) {
      for (const entity of bundle.entities || []) {
        const tags = (entity as any).tags as string[] | undefined;
        if (!tags?.includes('npc')) continue;
        const id = `voice-${entity.id}`;
        requests.push({
          id,
          kind: 'voice',
          prompt: `Hello, I'm ${(entity as any).label || 'your guide'}.`,
          style,
          format: 'mp3',
        });
        rationale[id] = `spoken greeting for NPC ${(entity as any).label}`;
      }
    }

    return { requests, rationale };
  }

  /**
   * Fold generated assets back into a bundle. Only successful ones are applied,
   * so a partial batch upgrades what it can and leaves the rest on placeholder
   * art — a half-generated experience still plays.
   */
  apply(bundle: GameplayDslBundle, assets: GeneratedAsset[]): GameplayDslBundle {
    const byId = new Map(assets.filter((asset) => asset.status === 'succeeded' && asset.url).map((asset) => [asset.requestId, asset]));
    if (!byId.size) return bundle;

    const nextAssets = (bundle.assets || []).map((asset) => {
      const generated = byId.get(asset.spriteId);
      return generated
        ? { ...asset, url: generated.url, contentType: generated.contentType, source: generated.providerId }
        : asset;
    });

    // Audio and models are new to the bundle rather than replacements, so they
    // get their own block; a runtime that does not know about them ignores it.
    const audio = assets
      .filter((asset) => asset.status === 'succeeded' && (asset.kind === 'music' || asset.kind === 'sfx' || asset.kind === 'voice'))
      .map((asset) => ({ id: asset.requestId, kind: asset.kind, url: asset.url, contentType: asset.contentType }));
    const models = assets
      .filter((asset) => asset.status === 'succeeded' && asset.kind === 'model3d')
      .map((asset) => ({ id: asset.requestId, url: asset.url, alternates: asset.alternates || [] }));

    return {
      ...bundle,
      assets: nextAssets as GameplayDslBundle['assets'],
      ...(audio.length ? { audio } : {}),
      ...(models.length ? { models } : {}),
      validation: {
        ...bundle.validation,
        contributions: {
          ...bundle.validation.contributions,
          generatedAssets: byId.size,
        },
      },
    } as GameplayDslBundle;
  }

  /** Palette and tone the compiler already derived from the source's emotion arc. */
  private styleOf(bundle: GameplayDslBundle): AssetStyle {
    const firstScene = (bundle.scenes || [])[0] as any;
    const assets = (bundle.assets || []) as any[];
    return {
      palette: firstScene?.palette?.length ? firstScene.palette : assets[0]?.palette || [],
      // Any asset carries the tone, but the first one may predate the field on
      // an older bundle — take the first that has it rather than assuming [0].
      tone: assets.find((asset) => asset?.tone)?.tone || undefined,
      genre: String((bundle.game as any)?.genre || '') || undefined,
    };
  }

  private archetypesOf(bundle: GameplayDslBundle): string[] {
    const roles = new Set<string>();
    for (const entity of bundle.entities || []) {
      const archetype = String((entity as any).archetype || '');
      if (archetype) roles.add(archetype);
    }
    return [...roles];
  }
}

/**
 * Colour direction for an image prompt.
 *
 * A spec's `tint` is chosen for the placeholder renderer, where the palette's
 * ink slot is a near-white that reads well on a dark rectangle. Handed to an
 * image model, "dominant colour #ffffff" asks for a white character on a
 * transparent background — invisible. So a near-white or near-black tint is
 * replaced by the first vivid entry in the palette, and the palette travels
 * along either way so the sprite belongs to its scene.
 */
function colourGuidance(tint: string, palette?: string[]): string {
  const accents = (palette || []).filter((colour) => isVivid(colour));
  const dominant = isVivid(tint) ? tint : accents[0];
  const parts: string[] = [];
  if (dominant) parts.push(`dominant colour ${dominant}`);
  if (accents.length) parts.push(`palette ${accents.slice(0, 3).join(' ')}`);
  return parts.join(', ');
}

/** Neither near-white nor near-black: usable as a subject colour. */
function isVivid(colour: string): boolean {
  const hex = /^#?([0-9a-f]{6})$/i.exec(String(colour || '').trim());
  if (!hex) return false;
  const value = parseInt(hex[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.12 && luminance < 0.88;
}

/** Stable per-id seed so regenerating one sprite does not reshuffle the rest. */
function seedFrom(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % 2_147_483_647;
}

export const __test = { seedFrom, colourGuidance, isVivid, ROLE_SUBJECTS };
