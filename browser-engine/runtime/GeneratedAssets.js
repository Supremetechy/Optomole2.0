/**
 * GeneratedAssets — folds a build's generated art and audio into the runtime.
 *
 * The gateway's asset pipeline produces assets keyed by the COMPILER's
 * vocabulary (sprite roles: player, enemy, npc, item, goal, terrain, prop; and
 * cue ids: sfx-collect, sfx-hit...). The runtime draws from a fixed procedural
 * pack keyed by its own texture names ('player', 'hazard', 'tile-floor'...).
 * This module is the translation between the two, and the only place that
 * knows both vocabularies.
 *
 * One role maps to SEVERAL pack keys on purpose: the compiler declares one
 * "enemy" for an experience, while the runtime draws enemies as 'enemy',
 * 'hazard', 'spike', and 'patrol' depending on which genre template is playing.
 * Swapping every key a role covers is what makes generated art show up
 * regardless of which template the content resolved to.
 *
 * Nothing here is required for a playable game. Every step is best-effort: a
 * missing, failed, or slow asset leaves the procedural placeholder in place.
 */

/** Compiler sprite role -> the runtime pack keys that role should replace. */
const ROLE_TO_TEXTURES = {
  player: ['player', 'hero', 'runner', 'vehicle', 'builder'],
  enemy: ['enemy', 'hazard', 'spike', 'patrol', 'target-bad', 'orb-bad'],
  npc: ['npc', 'civilian'],
  item: ['key', 'coin', 'powerup', 'orb-good', 'waypoint-pickup', 'node-ore'],
  goal: ['objective', 'quest-marker', 'door-open', 'waypoint-dropoff', 'target-good'],
  terrain: ['tile-floor', 'tile-ground', 'tile-road', 'platform'],
  prop: ['door', 'structure', 'tile-block'],
};

/** Generated sfx id -> the runtime cue names it should stand in for. */
const SFX_TO_CUES = {
  'sfx-collect': ['pickup'],
  'sfx-goal': ['success', 'reward'],
  'sfx-hit': ['failure'],
  'sfx-attack': ['unlock'],
};

/**
 * Point a generated-asset URL at the origin the page is served from.
 *
 * The gateway writes absolute URLs (`http://localhost:8080/v1/objects/...`),
 * but the Workstation frames the engine through the console's dev-server proxy,
 * so the page runs on :3000 with `/v1/objects` proxied. Keeping only the path
 * makes both cases same-origin — which matters beyond tidiness: WebGL refuses a
 * cross-origin texture without CORS headers, so a raw absolute URL would load
 * as an image and then fail at upload time. Non-gateway URLs (a CDN, a vendor
 * host we chose to link rather than copy) are left exactly as they are.
 */
export function sameOriginAssetUrl(url) {
  try {
    const parsed = new URL(String(url), window.location.href);
    if (parsed.origin === window.location.origin) return parsed.href;
    return parsed.pathname.startsWith('/v1/objects/') ? parsed.pathname + parsed.search : parsed.href;
  } catch (_) {
    return url;
  }
}

/**
 * Apply `manifest.generatedAssets` to a live runtime's services.
 *
 * Returns a small report rather than throwing, so boot can log what actually
 * landed — "8 sprites requested, 6 applied" is the difference between "the
 * pipeline is off" and "two vendors timed out", and both look identical on
 * screen.
 */
export async function applyGeneratedAssets(services, manifest) {
  const generated = manifest?.generatedAssets;
  const report = { sprites: 0, audio: 0, music: 0, skipped: 0 };
  if (!generated || typeof generated !== 'object') return report;

  const { assets, audio } = services;
  const sprites = generated.sprites || {};
  const sounds = generated.audio || {};

  // Sprites: one load per role, then reuse the resolved texture across every
  // pack key that role covers — loading the same URL once per key would be
  // four network round-trips for one image.
  const swaps = [];
  for (const [role, url] of Object.entries(sprites)) {
    const keys = ROLE_TO_TEXTURES[role];
    if (!keys || !url) {
      report.skipped += 1;
      continue;
    }
    const resolved = sameOriginAssetUrl(url);
    swaps.push(
      (async () => {
        for (const key of keys) {
          const applied = await assets.replaceWithImage(key, resolved);
          if (applied) report.sprites += 1;
        }
      })(),
    );
  }
  await Promise.all(swaps);

  for (const [id, url] of Object.entries(sounds)) {
    if (!url) continue;
    const resolved = sameOriginAssetUrl(url);
    if (id.startsWith('music-')) {
      // One track plays at a time; the first region's theme is the bed.
      if (!report.music) {
        audio.registerMusic(resolved);
        report.music += 1;
      }
      continue;
    }
    const cues = SFX_TO_CUES[id];
    if (!cues) {
      report.skipped += 1;
      continue;
    }
    for (const cue of cues) audio.register(cue, resolved);
    report.audio += 1;
  }

  return report;
}

export const __test = { ROLE_TO_TEXTURES, SFX_TO_CUES };
