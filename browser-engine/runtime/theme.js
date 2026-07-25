/**
 * theme.js — content- and engine-driven visual theme.
 *
 * Two axes of differentiation:
 *  - CONTENT: the ingested source's domain (security, finance, nature, …) picks a
 *    palette, so a safety course and a jazz-history course don't render identically.
 *  - ENGINE: the renderer picks a style — Pixi = "neon" (smooth, glowing), Phaser =
 *    "retro" (chunky, scanlined) — so switching engines is visibly different.
 *
 * One palette themes EVERY genre: colors are assigned by role (hero/friend/item/
 * danger/floor/grid/wall) and each role maps to the concrete PALETTE keys those
 * entities use across templates. So theming the roles themes all 11 genres' sprites.
 */

// Role → the AssetLoader PALETTE keys that role paints across all genres.
const ROLE_KEYS = {
  hero: ['player', 'playerRing', 'hero', 'vehicle', 'structure'],
  friend: ['npc', 'npcTrim', 'civilian'],
  item: ['key', 'target', 'coin', 'ore', 'powerup', 'doorOpen', 'orbGood', 'wood'],
  danger: ['hazard', 'enemy', 'spike', 'orbBad'],
  floor: ['floor', 'road'],
  grid: ['floorGrid', 'building', 'platform', 'stone'],
  wall: ['wall', 'door'],
};

// Domain → palette + keyword detectors. Ordered most-specific first (first match wins).
const DOMAIN_THEMES = {
  security: {
    label: 'Security',
    keywords: ['security', 'cyber', 'incident', 'threat', 'breach', 'forensic', 'malware', 'attack', 'vulnerab', 'phishing', 'intrusion', 'ransom'],
    roles: { hero: 0x93c5fd, friend: 0xf59e0b, item: 0x34d399, danger: 0xef4444, floor: 0x0b0709, grid: 0x3f1220, wall: 0x7f1d1d },
  },
  network: {
    label: 'Network Ops',
    keywords: ['network', 'router', 'server', 'infrastructure', 'protocol', 'packet', 'bandwidth', 'devops', 'latency', 'failover', 'kubernetes', 'endpoint'],
    roles: { hero: 0x60a5fa, friend: 0x818cf8, item: 0x22d3ee, danger: 0xf472b6, floor: 0x080b1a, grid: 0x1e3a8a, wall: 0x1e40af },
  },
  medical: {
    label: 'Clinical',
    keywords: ['medical', 'health', 'clinical', 'patient', 'anatomy', 'disease', 'treatment', 'surgery', 'diagnos', 'therapy', 'nursing', 'pharma'],
    roles: { hero: 0x5eead4, friend: 0xa5f3fc, item: 0x34d399, danger: 0xfb7185, floor: 0x071312, grid: 0x134e4a, wall: 0x115e59 },
  },
  finance: {
    label: 'Ledger',
    keywords: ['finance', 'business', 'econom', 'budget', 'revenue', 'market', 'invest', 'account', 'profit', 'ledger', 'trading', 'portfolio'],
    roles: { hero: 0x7dd3fc, friend: 0xfcd34d, item: 0xfacc15, danger: 0xf87171, floor: 0x0a0f1e, grid: 0x1e293b, wall: 0x78350f },
  },
  nature: {
    label: 'Field',
    keywords: ['nature', 'biolog', 'environment', 'ecolog', 'plant', 'animal', 'climate', 'forest', 'ocean', 'wildlife', 'garden', 'farming'],
    roles: { hero: 0x86efac, friend: 0x4ade80, item: 0xfde047, danger: 0xf87171, floor: 0x06120c, grid: 0x14532d, wall: 0x166534 },
  },
  safety: {
    label: 'Industrial',
    keywords: ['safety', 'warehouse', 'industrial', 'forklift', 'equipment', 'osha', 'operational', 'logistics', 'manufactur', 'maintenance', 'procedure', 'pallet'],
    roles: { hero: 0x67e8f9, friend: 0xfbbf24, item: 0xfacc15, danger: 0xfb923c, floor: 0x100b05, grid: 0x422006, wall: 0x854d0e },
  },
};

function expandRoles(roles = {}) {
  const out = {};
  for (const [role, color] of Object.entries(roles)) {
    for (const key of ROLE_KEYS[role] || []) out[key] = color;
  }
  return out;
}

/** Detect the content domain from the manifest's explicit domain, then keywords. */
export function detectDomain(manifest = {}, meta = {}) {
  const explicit = String(manifest.progression?.domain || meta.domain || manifest.domain || '').toLowerCase();
  const labels = (manifest.bindings || []).slice(0, 10).map((b) => b?.sourceElement?.label || '').join(' ');
  const text = `${explicit} ${meta.title || manifest.title || ''} ${meta.briefing || ''} ${labels}`.toLowerCase();
  for (const [domain, def] of Object.entries(DOMAIN_THEMES)) {
    if (def.keywords.some((k) => text.includes(k))) return domain;
  }
  return 'default';
}

/**
 * Resolve a full theme. `basePalette` is AssetLoader's default PALETTE (passed in
 * to avoid an import cycle); the domain overrides paint over it.
 */
export function resolveTheme(basePalette, { manifest = {}, meta = {}, engine = 'pixi' } = {}) {
  const domain = detectDomain(manifest, meta);
  const def = DOMAIN_THEMES[domain];
  const palette = def ? { ...basePalette, ...expandRoles(def.roles) } : { ...basePalette };
  const style = String(engine).toLowerCase() === 'phaser' ? 'retro' : 'neon';
  return {
    id: domain,
    label: def ? def.label : 'Signal',
    engine: style === 'retro' ? 'phaser' : 'pixi',
    style, // 'neon' (Pixi) | 'retro' (Phaser)
    palette,
    background: palette.floor,
  };
}
