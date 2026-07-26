import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';

/**
 * GameReferencesService — the "model my game off a favorite" catalog.
 *
 * A user picks a favorite on-market game (the GameDuplicator marketplace samples
 * merged with a curated set of well-known titles). Each entry carries a
 * `mapping` that steers Optomole's existing ExperienceManifest pipeline:
 *
 *   favorite game -> { templateId, archetype, genreFamily, mechanics }
 *                 -> compiler templatePreference + archetype
 *                 -> templates.service.resolve() -> browser-engine template
 *                 -> the playable is built from the USER'S uploaded data,
 *                    shaped like the reference game.
 *
 * No game is actually cloned — the reference is a steering signal. templateId
 * values are versionless registry ids (templates/registry.json); archetype
 * values are runtime-archetype ids (shared/runtime-archetypes.ts).
 */

export interface GameReferenceMapping {
  genreFamily: string;
  /** Versionless registry template id, e.g. `runner-gauntlet`. */
  templateId: string;
  /** One of the six runtime archetype ids. */
  archetype: string;
  /** Gameplay hints recorded as provenance and fed to the AI compiler prompt. */
  mechanics: string[];
}

export interface GameReference {
  id: string;
  title: string;
  /**
   * `gameduplicator-marketplace` (seeded samples), `curated` (hand-mapped
   * well-known titles), or `user-upload` (a game the user made/duplicated in
   * GameDuplicator, imported from that app's localStorage / an export).
   */
  source: 'gameduplicator-marketplace' | 'curated' | 'user-upload';
  category: string;
  engine?: string;
  tags: string[];
  blurb: string;
  mapping: GameReferenceMapping;
  /** Present on user-upload entries: the reference game it was duplicated from. */
  originalGame?: string;
  importedAt?: string;
}

/**
 * Genre/category hint -> Optomole template mapping. Keys are lowercase tokens
 * matched against a user game's category/genre/tags so any imported GameDuplicator
 * game lands on the closest browser-engine template. First matching token wins;
 * order matters (more specific tokens first).
 */
const HINT_TO_MAPPING: Array<{ tokens: string[]; mapping: GameReferenceMapping }> = [
  { tokens: ['idle', 'clicker', 'incremental'], mapping: { genreFamily: 'idle', templateId: 'idle-progress', archetype: 'business-sim', mechanics: ['tap-accumulate', 'upgrades', 'milestones'] } },
  { tokens: ['runner', 'endless'], mapping: { genreFamily: 'arcade-runner', templateId: 'runner-gauntlet', archetype: 'adventure', mechanics: ['endless-run', 'dodge', 'distance'] } },
  { tokens: ['racing', 'race', 'driving', 'kart'], mapping: { genreFamily: 'arcade-runner', templateId: 'runner-gauntlet', archetype: 'adventure', mechanics: ['timed-forward', 'obstacle-avoid', 'time-trial'] } },
  { tokens: ['shooter', 'fps', 'shoot'], mapping: { genreFamily: 'shooter', templateId: 'fps-target-gallery', archetype: 'adventure', mechanics: ['target-shoot', 'threat-judge', 'reflex'] } },
  { tokens: ['puzzle', 'logic', 'brain', 'match'], mapping: { genreFamily: 'learning-navigation', templateId: 'memory-palace', archetype: 'escape-room', mechanics: ['logic-puzzle', 'sequence', 'ordered-steps'] } },
  { tokens: ['mystery', 'detective', 'deduction'], mapping: { genreFamily: 'board-sim', templateId: 'board-resource-sim', archetype: 'detective', mechanics: ['gather-evidence', 'deduce', 'eliminate'] } },
  { tokens: ['board', 'strategy', 'tycoon', 'sim', 'simulation', 'management', '4x'], mapping: { genreFamily: 'board-sim', templateId: 'board-resource-sim', archetype: 'business-sim', mechanics: ['resource-manage', 'tradeoffs', 'decision-turns'] } },
  { tokens: ['rpg', 'role-playing', 'roleplaying'], mapping: { genreFamily: 'rpg', templateId: 'quest-rpg-progression', archetype: 'mission-rpg', mechanics: ['quests', 'skill-tree', 'leveling'] } },
  { tokens: ['sandbox', 'builder', 'build', 'craft', 'crafting', 'survival'], mapping: { genreFamily: 'sandbox-survival', templateId: 'sandbox-craft-build', archetype: 'adventure', mechanics: ['gather', 'craft', 'build'] } },
  { tokens: ['open-world', 'openworld', 'courier', 'delivery', 'sandbox-action'], mapping: { genreFamily: 'open-world-action', templateId: 'open-world-courier', archetype: 'adventure', mechanics: ['deliver', 'navigate', 'backlog'] } },
  { tokens: ['arcade', 'maze', 'collect'], mapping: { genreFamily: 'arcade', templateId: 'arcade-collect-avoid', archetype: 'adventure', mechanics: ['collect', 'avoid-hazards', 'maze'] } },
  { tokens: ['platformer', 'platform'], mapping: { genreFamily: 'action-adventure', templateId: 'action-adventure-key-lock', archetype: 'adventure', mechanics: ['platforming', 'collectibles', 'keys-and-locks'] } },
  { tokens: ['casual', 'relaxing', 'zen', 'peaceful'], mapping: { genreFamily: 'idle', templateId: 'idle-progress', archetype: 'adventure', mechanics: ['light-touch', 'progress', 'collect'] } },
  { tokens: ['action', 'adventure'], mapping: { genreFamily: 'action-adventure', templateId: 'action-adventure-key-lock', archetype: 'adventure', mechanics: ['exploration', 'keys-and-locks', 'items'] } },
  
];

const DEFAULT_MAPPING: GameReferenceMapping = { genreFamily: 'action-adventure', templateId: 'action-adventure-key-lock', archetype: 'adventure', mechanics: ['exploration', 'objectives'] };

@Injectable()
export class GameReferencesService {
  // Seeded from GameDuplicator/game_marketplace.js (its sample catalog). Kept as
  // a decoupled copy because GameDuplicator ships as browser-only UMD modules and
  // is not a node dependency of the gateway. If that catalog changes, update here.
  private readonly marketplace: GameReference[] = [
    {
      id: 'game_001',
      title: 'Pixel Adventure Pro',
      source: 'gameduplicator-marketplace',
      category: 'Platformer',
      engine: 'Unity',
      tags: ['pixel', 'platformer', 'adventure', 'physics'],
      blurb: 'Classic platformer with rooms, collectibles, and power-ups.',
      mapping: { genreFamily: 'action-adventure', templateId: 'action-adventure-key-lock', archetype: 'adventure', mechanics: ['platforming', 'collectibles', 'power-ups', 'keys-and-locks'] },
    },
    {
      id: 'game_002',
      title: 'Mind Bender Deluxe',
      source: 'gameduplicator-marketplace',
      category: 'Puzzle',
      engine: 'HTML5',
      tags: ['puzzle', 'brain', 'logic', 'minimalist'],
      blurb: 'Innovative logic puzzles with a hint system and saved progress.',
      mapping: { genreFamily: 'learning-navigation', templateId: 'memory-palace', archetype: 'escape-room', mechanics: ['logic-puzzle', 'sequence-recall', 'hint-system'] },
    },
    {
      id: 'game_003',
      title: 'Speed Racer Ultimate',
      source: 'gameduplicator-marketplace',
      category: 'Racing',
      engine: 'Unity',
      tags: ['racing', 'cars', 'speed', '3d'],
      blurb: 'High-speed racing with time trials and forward momentum.',
      mapping: { genreFamily: 'arcade-runner', templateId: 'runner-gauntlet', archetype: 'adventure', mechanics: ['timed-forward', 'obstacle-avoid', 'time-trial'] },
    },
    {
      id: 'game_004',
      title: 'Crystal Quest 3D',
      source: 'gameduplicator-marketplace',
      category: 'Action',
      engine: 'Unity',
      tags: ['3d', 'adventure', 'fantasy', 'crystals'],
      blurb: 'Open-world quest adventure with an inventory and quest system.',
      mapping: { genreFamily: 'rpg', templateId: 'quest-rpg-progression', archetype: 'mission-rpg', mechanics: ['quests', 'inventory', 'exploration', 'leveling'] },
    },
    {
      id: 'game_005',
      title: 'Zen Garden Builder',
      source: 'gameduplicator-marketplace',
      category: 'Casual',
      engine: 'HTML5',
      tags: ['zen', 'relaxing', 'builder', 'peaceful'],
      blurb: 'Relaxing creative builder — place, arrange, and share creations.',
      mapping: { genreFamily: 'sandbox-survival', templateId: 'sandbox-craft-build', archetype: 'adventure', mechanics: ['creative-build', 'gather', 'arrange'] },
    },
  ];

  // Curated well-known references, each hand-mapped to the best-fit Optomole
  // template. These are "in the style of" mappings, not the actual games.
  private readonly curated: GameReference[] = [
    { id: 'ref_monopoly', title: 'Monopoly (board / resource strategy)', source: 'curated', category: 'Board', tags: ['board', 'roll-move', 'economy', 'strategy'], blurb: 'Roll, move around a board, and manage resources and tradeoffs.', mapping: { genreFamily: 'board-sim', templateId: 'board-resource-sim', archetype: 'business-sim', mechanics: ['roll-move', 'resource-manage', 'tradeoffs'] } },
    { id: 'ref_chess', title: 'Chess (strategy board)', source: 'curated', category: 'Board', tags: ['strategy', 'board', 'turn-based'], blurb: 'Turn-based strategy over a structured board of positions.', mapping: { genreFamily: 'board-sim', templateId: 'board-resource-sim', archetype: 'business-sim', mechanics: ['turn-based', 'position-strategy', 'planning'] } },
    { id: 'ref_civilization', title: 'Civilization (4X strategy)', source: 'curated', category: 'Strategy', tags: ['strategy', 'empire', 'economy'], blurb: 'Grow and manage systems over many decision turns.', mapping: { genreFamily: 'board-sim', templateId: 'board-resource-sim', archetype: 'business-sim', mechanics: ['resource-manage', 'expand', 'decision-turns'] } },
    { id: 'ref_pacman', title: 'Pac-Man (arcade collect / avoid)', source: 'curated', category: 'Arcade', tags: ['arcade', 'collect', 'avoid', 'maze'], blurb: 'Collect everything on the field while dodging hazards.', mapping: { genreFamily: 'arcade', templateId: 'arcade-collect-avoid', archetype: 'adventure', mechanics: ['collect', 'avoid-hazards', 'maze'] } },
    { id: 'ref_temple_run', title: 'Temple Run (endless runner)', source: 'curated', category: 'Arcade', tags: ['runner', 'endless', 'dodge'], blurb: 'Constant forward motion, dodging obstacles for distance.', mapping: { genreFamily: 'arcade-runner', templateId: 'runner-gauntlet', archetype: 'adventure', mechanics: ['endless-run', 'dodge', 'distance'] } },
    { id: 'ref_zelda', title: 'The Legend of Zelda (action adventure)', source: 'curated', category: 'Action', tags: ['adventure', 'keys', 'exploration', 'items'], blurb: 'Explore rooms, find keys, unlock gates, gather items.', mapping: { genreFamily: 'action-adventure', templateId: 'action-adventure-key-lock', archetype: 'adventure', mechanics: ['keys-and-locks', 'exploration', 'items'] } },
    { id: 'ref_skyrim', title: 'Skyrim (open RPG / quests)', source: 'curated', category: 'RPG', tags: ['rpg', 'quests', 'skills', 'leveling'], blurb: 'Quest-driven progression with a skill tree and leveling.', mapping: { genreFamily: 'rpg', templateId: 'quest-rpg-progression', archetype: 'mission-rpg', mechanics: ['quests', 'skill-tree', 'leveling'] } },
    { id: 'ref_minecraft', title: 'Minecraft (sandbox craft / build)', source: 'curated', category: 'Sandbox', tags: ['sandbox', 'craft', 'build', 'gather'], blurb: 'Gather materials, craft, and build freely.', mapping: { genreFamily: 'sandbox-survival', templateId: 'sandbox-craft-build', archetype: 'adventure', mechanics: ['gather', 'craft', 'build'] } },
    { id: 'ref_doom', title: 'Doom (FPS target gallery)', source: 'curated', category: 'Shooter', tags: ['fps', 'shooter', 'targets'], blurb: 'Judge and shoot the right targets under pressure.', mapping: { genreFamily: 'shooter', templateId: 'fps-target-gallery', archetype: 'adventure', mechanics: ['target-shoot', 'threat-judge', 'reflex'] } },
    { id: 'ref_cookie_clicker', title: 'Cookie Clicker (idle progression)', source: 'curated', category: 'Idle', tags: ['idle', 'clicker', 'upgrades'], blurb: 'Accumulate over time and buy upgrades for daily/habit content.', mapping: { genreFamily: 'idle', templateId: 'idle-progress', archetype: 'business-sim', mechanics: ['tap-accumulate', 'upgrades', 'milestones'] } },
    { id: 'ref_portal', title: 'Portal (puzzle / escape room)', source: 'curated', category: 'Puzzle', tags: ['puzzle', 'escape', 'spatial', 'sequence'], blurb: 'Solve ordered spatial puzzles to progress room by room.', mapping: { genreFamily: 'learning-navigation', templateId: 'memory-palace', archetype: 'escape-room', mechanics: ['spatial-puzzle', 'sequence', 'ordered-steps'] } },
    { id: 'ref_clue', title: 'Clue (deduction / detective)', source: 'curated', category: 'Mystery', tags: ['mystery', 'deduction', 'evidence'], blurb: 'Gather evidence and deduce the answer from clues.', mapping: { genreFamily: 'board-sim', templateId: 'board-resource-sim', archetype: 'detective', mechanics: ['gather-evidence', 'deduce', 'eliminate'] } },
    { id: 'ref_gta_courier', title: 'GTA / Crazy Taxi (open-world courier)', source: 'curated', category: 'Open World', tags: ['open-world', 'delivery', 'navigate'], blurb: 'Navigate an open map completing a backlog of deliveries.', mapping: { genreFamily: 'open-world-action', templateId: 'open-world-courier', archetype: 'adventure', mechanics: ['deliver', 'navigate', 'backlog'] } },
    { id: 'ref_tetris', title: 'Tetris (spatial puzzle)', source: 'curated', category: 'Puzzle', tags: ['puzzle', 'spatial', 'recall'], blurb: 'Fast spatial recall and placement puzzles.', mapping: { genreFamily: 'learning-navigation', templateId: 'memory-palace', archetype: 'escape-room', mechanics: ['spatial-recall', 'placement', 'timed'] } },
  ];

  // Imported GameDuplicator user games, hydrated from disk on first access.
  private readonly userGames = new Map<string, GameReference>();
  private hydrated = false;

  /** Full merged catalog: marketplace, curated, then imported user games. */
  list(): GameReference[] {
    this.hydrate();
    return [...this.marketplace, ...this.curated, ...this.userGames.values()];
  }

  /** Map a category/genre/tag hint to the closest Optomole template. */
  private mappingForHint(...hints: Array<string | undefined>): GameReferenceMapping {
    const haystack = hints.filter(Boolean).join(' ').toLowerCase();
    for (const { tokens, mapping } of HINT_TO_MAPPING) {
      if (tokens.some((token) => haystack.includes(token))) return mapping;
    }
    return DEFAULT_MAPPING;
  }

  /**
   * Import games the user made in GameDuplicator. Accepts the shapes that app
   * produces: its `gameDuplicatorProjects` localStorage array (`[[id, project],
   * …]`), a plain array of project/game objects, or a single object. Each is
   * normalized to a `user-upload` GameReference and persisted. Returns the
   * imported entries.
   */
  importUserGames(raw: unknown): GameReference[] {
    this.hydrate();
    const entries = this.extractGameObjects(raw);
    const imported: GameReference[] = [];
    for (const entry of entries) {
      const reference = this.normalizeUserGame(entry);
      if (!reference) continue;
      this.userGames.set(reference.id, reference);
      this.writeFile(reference);
      imported.push(reference);
    }
    return imported;
  }

  /** Just the imported user games. */
  listUserGames(): GameReference[] {
    this.hydrate();
    return [...this.userGames.values()];
  }

  removeUserGame(id: string): boolean {
    this.hydrate();
    const existed = this.userGames.delete(id);
    if (existed) this.removeFile(id);
    return existed;
  }

  /** Pull game-like objects out of the various shapes GameDuplicator exports. */
  private extractGameObjects(raw: unknown): Array<Record<string, unknown>> {
    let value = raw;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return [];
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.games)) value = obj.games;
      else if (Array.isArray(obj.projects)) value = obj.projects;
      else value = [obj];
    }
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        // localStorage Map entries serialize as [id, project] pairs.
        if (Array.isArray(item)) return item[1];
        return item;
      })
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  }

  private normalizeUserGame(game: Record<string, unknown>): GameReference | null {
    const metadata = (game.metadata && typeof game.metadata === 'object' ? game.metadata : {}) as Record<string, unknown>;
    const title = String(game.title || game.name || game.originalGame || '').trim();
    if (!title) return null;

    const category = String(game.category || metadata.genre || 'Imported').trim() || 'Imported';
    const engine = game.engine || metadata.engine;
    const tags = Array.isArray(game.tags) ? game.tags.map(String) : Array.isArray(metadata.tags) ? (metadata.tags as unknown[]).map(String) : [];
    const originalGame = game.originalGame ? String(game.originalGame) : undefined;

    // Stable id so re-importing the same game updates rather than duplicates.
    const rawId = String(game.id || '').trim();
    const id = rawId.startsWith('user_game_') ? rawId : `user_game_${this.slug(rawId || title)}`;

    return {
      id,
      title,
      source: 'user-upload',
      category,
      engine: engine ? String(engine) : undefined,
      tags,
      blurb: String(game.description || game.blurb || (originalGame ? `Your GameDuplicator project, modeled on ${originalGame}.` : 'Your imported GameDuplicator game.')),
      mapping: this.mappingForHint(category, String(metadata.genre || ''), tags.join(' '), title, originalGame),
      originalGame,
      importedAt: undefined,
    };
  }

  private slug(value: string): string {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64) || 'game';
  }

  // --- local file backend (mirrors AccountStore) -------------------------

  private storeRoot(): string {
    return path.resolve(process.cwd(), gatewayConfig().gameReferenceStorePath);
  }

  private storeFile(id: string): string {
    return path.join(this.storeRoot(), `${Buffer.from(id).toString('base64url')}.json`);
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const dir = this.storeRoot();
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const game = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as GameReference;
        if (game?.id) this.userGames.set(game.id, game);
      } catch {
        // Skip corrupt records rather than failing the whole catalog.
      }
    }
  }

  private writeFile(game: GameReference): void {
    const dir = this.storeRoot();
    fs.mkdirSync(dir, { recursive: true });
    const record = { ...game, importedAt: game.importedAt || new Date().toISOString() };
    this.userGames.set(record.id, record);
    fs.writeFileSync(this.storeFile(game.id), JSON.stringify(record, null, 2), 'utf8');
  }

  private removeFile(id: string): void {
    const file = this.storeFile(id);
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  /** Catalog grouped by category for a selector UI. */
  grouped(): Array<{ category: string; games: GameReference[] }> {
    const map = new Map<string, GameReference[]>();
    for (const game of this.list()) {
      const bucket = map.get(game.category) || [];
      bucket.push(game);
      map.set(game.category, bucket);
    }
    return [...map.entries()].map(([category, games]) => ({ category, games }));
  }

  get(id: string): GameReference | null {
    if (!id) return null;
    return this.list().find((game) => game.id === id) || null;
  }

  /**
   * Steering fields for the compiler. Returns null when the id is unknown so the
   * compiler falls back to its normal content-based template/archetype choice.
   */
  steeringFor(id: string): (GameReferenceMapping & { title: string; category: string }) | null {
    const game = this.get(id);
    if (!game) return null;
    return { ...game.mapping, title: game.title, category: game.category };
  }
}
