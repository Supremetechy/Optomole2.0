/**
 * entity-factory — turns EntitySpecs into live prefab instances and lays them
 * out inside a room. This is the concrete end of the mapping bridge:
 *
 *   EntitySpec (from MappingEngine) -> createEntity() -> prefab (sprite+body)
 *
 * layoutRoom() assigns positions: player starts left, the guide NPC sits
 * upper-left, the exit door is centered on the right wall, and collectibles /
 * hazards are scattered across the play field on a loose grid.
 */
import { Player } from './prefabs/Player.js';
import { NPC } from './prefabs/NPC.js';
import { Collectible } from './prefabs/Collectible.js';
import { Hazard } from './prefabs/Hazard.js';
import { Door } from './prefabs/Door.js';

export function createEntity(ctx, spec, pos = { x: 0, y: 0 }) {
  switch (spec.entityType) {
    case 'hazard':
      return new Hazard(ctx, spec, { ...pos, patrol: 42 });
    case 'npc':
      return new NPC(ctx, spec, pos);
    case 'lock':
    case 'exit-gate':
    case 'door':
      return new Door(ctx, spec, pos);
    case 'key-item':
    case 'quest-objective':
    case 'score-condition':
    default:
      return new Collectible(ctx, spec, pos);
  }
}

export function createPlayer(ctx, pos) {
  return new Player(ctx, pos);
}

/**
 * Compute positions for a room's contents inside `bounds` (the inner play area,
 * already inset from the walls). Returns concrete coordinates the RoomScene
 * uses to instantiate everything.
 */
export function layoutRoom(room, bounds) {
  const { x, y, w, h } = bounds;
  const playerStart = { x: x + 60, y: y + h / 2 };
  const npcPos = { x: x + 70, y: y + 70 };
  const doorPos = { x: x + w - 30, y: y + h / 2 };

  const items = room.entities.filter((e) => e.entityType !== 'npc');
  // Grid across the central region, avoiding the player's spawn column.
  const cols = Math.max(2, Math.ceil(Math.sqrt(items.length)));
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const padX = w * 0.28;
  const gridW = w - padX - 90;
  const gridH = h - 120;
  const positions = new Map();

  items.forEach((spec, i) => {
    const col = i % cols;
    const rowIdx = Math.floor(i / cols);
    const cx = x + padX + (cols === 1 ? gridW / 2 : (col / (cols - 1 || 1)) * gridW);
    const cy = y + 70 + (rows === 1 ? gridH / 2 : (rowIdx / (rows - 1 || 1)) * gridH);
    // Jitter so it doesn't read as a rigid grid.
    const jx = ((i * 53) % 40) - 20;
    const jy = ((i * 31) % 40) - 20;
    positions.set(spec.id, { x: cx + jx, y: cy + jy });
  });

  return { playerStart, npcPos, doorPos, positions };
}
