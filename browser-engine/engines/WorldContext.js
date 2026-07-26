/**
 * WorldContext — the runtime's view of the manifest's world-building layers.
 *
 * The compile pipeline ships proceduralMap (named locations derived from the
 * person's content), storyboard (narrative scene order), world (the planet /
 * region identity), and skillTree (domain-specific progression) on every
 * manifest. Historically no template read any of it, so every playable rendered
 * generic "Room 1 / Wave 2" chrome around customized entities. This module is
 * the single projection point: templates ask it for chunk names, world titles,
 * and skill branches instead of minting generic ones.
 *
 *   manifest.proceduralMap.locations -> chapter/room/wave/district names + flavor
 *   manifest.storyboard.scenes       -> fallback names in narrative order
 *   manifest.world.planet / regionName -> world title
 *   manifest.skillTree               -> skill branch labels (quest-rpg)
 */

// Server-side placeholder names that carry no user content — never surface them
// over a real region/location name.
const GENERIC_NAMES = new Set(['knowledge frontier', 'optimole experience', 'optomole experience']);

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v == null ? '' : String(v).trim());

function isGeneric(name) {
  return !name || GENERIC_NAMES.has(name.toLowerCase());
}

export function shortName(text, max = 34) {
  const t = str(text).replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function createWorldContext(manifest = {}, meta = {}) {
  // Prefer the gateway's projected components (ExperienceBuildService) — they
  // are already normalized and shared with the native engines. The raw pipeline
  // layers stay as the fallback for manifests built before the projection, so
  // an older stored build still plays.
  const components = manifest.components || {};
  const map = manifest.proceduralMap || {};

  const projectedRegions = arr(components.world?.regions)
    .map((region) => ({
      name: str(region.name),
      description: str(region.description),
      hazards: [],
      loot: [],
    }))
    .filter((region) => !isGeneric(region.name));

  const locations = projectedRegions.length
    ? projectedRegions
    : arr(map.locations)
      .map((loc) => ({
        name: str(loc.name),
        description: str(loc.description),
        hazards: arr(loc.hazards).map(str).filter(Boolean),
        loot: arr(loc.lootTable).map(str).filter(Boolean),
      }))
      .filter((loc) => !isGeneric(loc.name));

  const projectedBeats = arr(components.narrative?.beats)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((beat) => ({ title: str(beat.title), type: str(beat.type) }))
    .filter((beat) => beat.title);

  const scenes = projectedBeats.length
    ? projectedBeats
    : arr(manifest.storyboard?.scenes)
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((scene) => ({ title: str(scene.title), type: str(scene.sceneType) }))
      .filter((scene) => scene.title);

  const planet = str(components.world?.identity?.planet || manifest.world?.planet);
  const region = str(map.regionName);
  const title =
    str(components.world?.identity?.title && !isGeneric(str(components.world.identity.title)) ? components.world.identity.title : '') ||
    (!isGeneric(planet) && planet) ||
    (!isGeneric(region) && region) ||
    str(manifest.title || meta.title) ||
    'Optomole Experience';

  const projectedBranches = arr(components.progression?.branches)
    .map((branch) => ({
      id: str(branch.id),
      label: str(branch.label),
      blurb: str(branch.blurb),
      icon: str(branch.icon) || '◆',
    }))
    .filter((branch) => branch.label);

  const skillTree = projectedBranches.length
    ? projectedBranches
    : arr(manifest.skillTree)
      .map((skill) => ({
        id: str(skill.id) || str(skill.name).toLowerCase().replace(/\s+/g, '-'),
        label: str(skill.name || skill.title),
        blurb: str(skill.description),
        icon: str(skill.icon) || '◆',
      }))
      .filter((skill) => skill.label);

  return {
    title,
    description: str(map.description),
    locations,
    scenes,
    skillTree,

    /** Content-derived name for the i-th chunk (room/wave/chapter/district), or ''. */
    chunkName(index) {
      return locations[index]?.name || scenes[index]?.title || '';
    },

    /** Flavor line for the i-th chunk — the location's own description, or ''. */
    chunkDescription(index) {
      return locations[index]?.description || '';
    },

    /**
     * Display title for the i-th chunk: "<Kind> <n>: <content name>". Falls back
     * to the caller's label (usually the chunk's first entity), then bare "<Kind> <n>".
     */
    chunkTitle(index, kind, fallbackLabel = '') {
      const name = this.chunkName(index) || str(fallbackLabel);
      return name ? `${kind} ${index + 1}: ${shortName(name)}` : `${kind} ${index + 1}`;
    },
  };
}
