/**
 * AssetLoader — resolves asset slots to real, usable textures/sounds.
 *
 * The AI content pipeline emits *asset slots* (e.g. `key_item_icon`,
 * `room_backdrop`) plus optional generated URLs. The runtime, however, needs
 * concrete textures right now — so this loader ships a **default procedural
 * sprite pack** drawn with PixiJS Graphics. No external PNGs required; every
 * entity has a visible, themeable sprite out of the box. When a binding provides
 * a real image/audio URL we load that instead and fall back to the procedural
 * texture on error.
 *
 * This closes the "asset-slot -> actual asset" gap for the browser runtime.
 */
const PIXI = window.PIXI;

// Palette shared with the HUD so procedural art matches the shell.
export const PALETTE = {
  player: 0x67e8f9,
  playerRing: 0x0891b2,
  npc: 0xfbbf24,
  npcTrim: 0x92400e,
  key: 0x34d399,
  hazard: 0xfb7185,
  door: 0x64748b,
  doorOpen: 0x34d399,
  floor: 0x0b1220,
  floorGrid: 0x1e293b,
  wall: 0x334155,
  particle: 0xe5f4ff,
  orbGood: 0x34d399,
  orbBad: 0xfb7185,
  powerup: 0xa78bfa,
  // Added for the quest-rpg / fps / open-world / sandbox / runner genres.
  hero: 0x7dd3fc,
  enemy: 0xf87171,
  target: 0x34d399,
  civilian: 0xfbbf24,
  vehicle: 0x67e8f9,
  road: 0x111827,
  building: 0x1f2937,
  ore: 0x38bdf8,
  wood: 0xb45309,
  stone: 0x94a3b8,
  structure: 0x34d399,
  platform: 0x475569,
  coin: 0xfbbf24,
  spike: 0xfb7185,
};

export class AssetLoader {
  constructor(renderer, theme = null) {
    this.renderer = renderer;
    this.textures = new Map();
    this.sounds = new Map();
    // Themed palette (content domain + engine style); falls back to default neon.
    this.palette = theme?.palette || PALETTE;
    this.theme = theme || null;
  }

  /** Build the default procedural sprite pack. Call once after the renderer exists. */
  buildDefaultPack() {
    this._register('player', this._drawPlayer());
    this._register('npc', this._drawNpc());
    this._register('key', this._drawKey());
    this._register('hazard', this._drawHazard());
    this._register('door', this._drawDoor(this.palette.door));
    this._register('door-open', this._drawDoor(this.palette.doorOpen, true));
    this._register('objective', this._drawObjective());
    this._register('particle', this._drawParticle());
    this._register('tile-floor', this._drawFloorTile());
    this._register('orb-good', this._drawOrb(this.palette.orbGood, true));
    this._register('orb-bad', this._drawOrb(this.palette.orbBad, false));
    this._register('powerup', this._drawPowerUp());

    // ---- quest-rpg-progression ----
    this._register('hero', this._drawHero());
    this._register('enemy', this._drawEnemy());
    this._register('quest-marker', this._drawQuestMarker());

    // ---- fps-runner ----
    this._register('coin', this._drawCoin());
    this._register('spike', this._drawSpike());

    // ---- fps-target-gallery ----
    this._register('target-good', this._drawTarget(this.palette.target, true));
    this._register('target-bad', this._drawTarget(this.palette.civilian, false));
    this._register('muzzle', this._drawMuzzle());

    // ---- open-world-courier ----
    this._register('vehicle', this._drawVehicle());
    this._register('tile-road', this._drawRoadTile());
    this._register('tile-block', this._drawBlockTile());
    this._register('waypoint-pickup', this._drawWaypoint(this.palette.key));
    this._register('waypoint-dropoff', this._drawWaypoint(this.palette.powerup));
    this._register('patrol', this._drawPatrol());

    // ---- sandbox-craft-build ----
    this._register('node-ore', this._drawNode(this.palette.ore));
    this._register('node-wood', this._drawNode(this.palette.wood));
    this._register('node-stone', this._drawNode(this.palette.stone));
    this._register('structure', this._drawStructure());
    this._register('tile-ground', this._drawGroundTile());

    // ---- runner-gauntlet ----
    this._register('runner', this._drawRunner());
    this._register('platform', this._drawPlatform());
    this._register('coin', this._drawCoin());
    this._register('spike', this._drawSpike());

    

    return this;
  }

  _register(key, graphics) {
    const texture = this.renderer.generateTexture(graphics);
    this.textures.set(key, texture);
    graphics.destroy();
  }

  get(key) {
    return this.textures.get(key) || this.textures.get('particle');
  }

  /**
   * Resolve a binding's template slot to a concrete texture key.
   * gameEntityType is the primary signal; slot is a hint.
   */
  textureForEntity(entityType) {
    const map = {
      'key-item': 'key',
      key: 'key',
      hazard: 'hazard',
      lock: 'door',
      'exit-gate': 'door',
      door: 'door',
      npc: 'npc',
      'quest-objective': 'objective',
      room: 'tile-floor',
    };
    return this.get(map[entityType] || 'objective');
  }

  // ---- Procedural drawing (PixiJS v8 Graphics) ------------------------------

  _drawPlayer() {
    const g = new PIXI.Graphics();
    g.circle(20, 20, 16).fill(this.palette.player);
    g.circle(20, 20, 16).stroke({ width: 3, color: this.palette.playerRing });
    // little directional notch
    g.circle(28, 20, 3).fill(0x03131d);
    return g;
  }

  _drawNpc() {
    const g = new PIXI.Graphics();
    g.roundRect(4, 4, 32, 36, 8).fill(this.palette.npc);
    g.roundRect(4, 4, 32, 36, 8).stroke({ width: 3, color: this.palette.npcTrim });
    g.circle(14, 18, 3).fill(0x1f2937); // eyes
    g.circle(26, 18, 3).fill(0x1f2937);
    g.moveTo(13, 28).lineTo(27, 28).stroke({ width: 2, color: 0x1f2937 });
    return g;
  }

  _drawKey() {
    const g = new PIXI.Graphics();
    g.circle(12, 20, 9).stroke({ width: 4, color: this.palette.key });
    g.rect(20, 18, 16, 4).fill(this.palette.key);
    g.rect(32, 18, 4, 8).fill(this.palette.key);
    return g;
  }

  _drawHazard() {
    const g = new PIXI.Graphics();
    g.poly([20, 3, 37, 34, 3, 34]).fill(this.palette.hazard);
    g.poly([20, 3, 37, 34, 3, 34]).stroke({ width: 2, color: 0x7f1d1d });
    g.rect(18, 14, 4, 10).fill(0x3b0a0a);
    g.circle(20, 29, 2.5).fill(0x3b0a0a);
    return g;
  }

  _drawDoor(color, open = false) {
    const g = new PIXI.Graphics();
    g.roundRect(2, 2, 36, 52, 4).fill(open ? 0x064e3b : 0x1e293b);
    g.roundRect(2, 2, 36, 52, 4).stroke({ width: 3, color });
    if (!open) {
      g.circle(30, 28, 3).fill(color); // handle
    } else {
      g.moveTo(10, 12).lineTo(30, 28).stroke({ width: 3, color }); // ajar check
      g.moveTo(10, 44).lineTo(30, 28).stroke({ width: 3, color });
    }
    return g;
  }

  _drawObjective() {
    const g = new PIXI.Graphics();
    g.star(18, 18, 5, 16, 8).fill(0xa78bfa);
    g.star(18, 18, 5, 16, 8).stroke({ width: 2, color: 0x5b21b6 });
    return g;
  }

  _drawParticle() {
    const g = new PIXI.Graphics();
    g.circle(6, 6, 6).fill(this.palette.particle);
    return g;
  }

  _drawFloorTile() {
    const g = new PIXI.Graphics();
    g.rect(0, 0, 64, 64).fill(this.palette.floor);
    g.rect(0, 0, 64, 64).stroke({ width: 1, color: this.palette.floorGrid, alpha: 0.6 });
    return g;
  }

  /** Arcade collectible: a glowing orb. `good` orbs get a soft halo + check
   *  vibe; bad orbs get a jagged warning ring so correct/decoy read at a glance. */
  _drawOrb(color, good) {
    const g = new PIXI.Graphics();
    g.circle(24, 24, 22).fill({ color, alpha: 0.16 }); // halo
    g.circle(24, 24, 15).fill(color);
    g.circle(24, 24, 15).stroke({ width: 3, color: good ? 0x064e3b : 0x7f1d1d });
    g.circle(19, 19, 4).fill({ color: 0xffffff, alpha: 0.7 }); // specular highlight
    if (!good) {
      // little X to mark a decoy / wrong concept
      g.moveTo(18, 18).lineTo(30, 30).stroke({ width: 3, color: 0x3b0a0a });
      g.moveTo(30, 18).lineTo(18, 30).stroke({ width: 3, color: 0x3b0a0a });
    }
    return g;
  }

  _drawPowerUp() {
    const g = new PIXI.Graphics();
    g.circle(22, 22, 20).fill({ color: this.palette.powerup, alpha: 0.18 });
    g.star(22, 22, 5, 18, 8).fill(this.palette.powerup);
    g.star(22, 22, 5, 18, 8).stroke({ width: 2, color: 0x5b21b6 });
    g.circle(22, 22, 6).fill(0xffffff);
    return g;
  }

  // ---- quest-rpg-progression ------------------------------------------------

  /** Hero: the key-lock player silhouette with a cloak, so the RPG reads as a
   *  character-driven genre rather than the abstract arcade puck. */
  _drawHero() {
    const g = new PIXI.Graphics();
    g.circle(20, 22, 15).fill(this.palette.hero);
    g.circle(20, 22, 15).stroke({ width: 3, color: 0x0369a1 });
    g.poly([20, 7, 32, 24, 8, 24]).fill({ color: 0x0369a1, alpha: 0.9 }); // hood
    g.circle(15, 22, 2.5).fill(0x03131d);
    g.circle(25, 22, 2.5).fill(0x03131d);
    return g;
  }

  _drawEnemy() {
    const g = new PIXI.Graphics();
    g.roundRect(4, 6, 32, 32, 6).fill(this.palette.enemy);
    g.roundRect(4, 6, 32, 32, 6).stroke({ width: 3, color: 0x7f1d1d });
    g.poly([4, 6, 12, 0, 16, 6]).fill(0x7f1d1d); // horns
    g.poly([24, 6, 28, 0, 36, 6]).fill(0x7f1d1d);
    g.rect(12, 18, 5, 5).fill(0x3b0a0a);
    g.rect(23, 18, 5, 5).fill(0x3b0a0a);
    g.moveTo(13, 31).lineTo(27, 31).stroke({ width: 2, color: 0x3b0a0a });
    return g;
  }

  /** Floating "!" marker over an available quest. */
  _drawQuestMarker() {
    const g = new PIXI.Graphics();
    g.circle(14, 14, 13).fill({ color: this.palette.npc, alpha: 0.2 });
    g.roundRect(11, 4, 6, 13, 3).fill(this.palette.npc);
    g.circle(14, 22, 3.2).fill(this.palette.npc);
    return g;
  }

  // ---- fps-target-gallery ---------------------------------------------------

  /** Shooting-range target. `hostile` targets are the concepts to hit; the
   *  amber variant is a bystander/decoy that costs accuracy when shot. */
  _drawTarget(color, hostile) {
    const g = new PIXI.Graphics();
    g.circle(32, 32, 30).fill({ color, alpha: 0.16 });
    g.circle(32, 32, 26).fill(0x050c18);
    g.circle(32, 32, 26).stroke({ width: 3, color });
    g.circle(32, 32, 17).stroke({ width: 3, color });
    g.circle(32, 32, 8).fill(color);
    if (!hostile) {
      // Diagonal "hold fire" bar across bystander targets.
      g.moveTo(12, 52).lineTo(52, 12).stroke({ width: 4, color: 0x7f1d1d });
    }
    return g;
  }

  _drawMuzzle() {
    const g = new PIXI.Graphics();
    g.star(24, 24, 8, 22, 9).fill({ color: 0xfef3c7, alpha: 0.9 });
    g.circle(24, 24, 9).fill(0xffffff);
    return g;
  }

  // ---- open-world-courier ---------------------------------------------------

  _drawVehicle() {
    const g = new PIXI.Graphics();
    g.roundRect(10, 4, 24, 44, 7).fill(this.palette.vehicle);
    g.roundRect(10, 4, 24, 44, 7).stroke({ width: 2, color: 0x0e7490 });
    g.roundRect(13, 9, 18, 12, 4).fill(0x082f49); // windshield
    g.roundRect(13, 31, 18, 10, 4).fill({ color: 0x082f49, alpha: 0.7 });
    g.rect(6, 12, 5, 10).fill(0x0f172a); // wheels
    g.rect(33, 12, 5, 10).fill(0x0f172a);
    g.rect(6, 32, 5, 10).fill(0x0f172a);
    g.rect(33, 32, 5, 10).fill(0x0f172a);
    return g;
  }

  _drawRoadTile() {
    const g = new PIXI.Graphics();
    g.rect(0, 0, 64, 64).fill(this.palette.road);
    g.rect(0, 30, 64, 4).fill({ color: 0x475569, alpha: 0.55 }); // lane dashes
    g.rect(30, 0, 4, 64).fill({ color: 0x475569, alpha: 0.55 });
    return g;
  }

  _drawBlockTile() {
    const g = new PIXI.Graphics();
    g.rect(0, 0, 64, 64).fill(this.palette.building);
    g.rect(0, 0, 64, 64).stroke({ width: 2, color: 0x0f172a });
    // Lit windows give the city blocks depth from above.
    for (let x = 8; x < 56; x += 16) {
      for (let y = 8; y < 56; y += 16) {
        g.rect(x, y, 8, 8).fill({ color: 0x67e8f9, alpha: (x + y) % 32 === 0 ? 0.22 : 0.08 });
      }
    }
    return g;
  }

  _drawWaypoint(color) {
    const g = new PIXI.Graphics();
    g.circle(24, 24, 22).fill({ color, alpha: 0.15 });
    g.circle(24, 24, 16).stroke({ width: 3, color });
    g.circle(24, 24, 6).fill(color);
    return g;
  }

  _drawPatrol() {
    const g = new PIXI.Graphics();
    g.roundRect(8, 6, 24, 36, 6).fill(0x1e293b);
    g.roundRect(8, 6, 24, 36, 6).stroke({ width: 2, color: this.palette.hazard });
    g.circle(20, 16, 6).fill(this.palette.hazard); // light bar
    g.circle(20, 16, 3).fill(0xffffff);
    return g;
  }

  // ---- sandbox-craft-build --------------------------------------------------

  /** A minable resource node: a chunky voxel-ish cube with ore flecks. */
  _drawNode(color) {
    const g = new PIXI.Graphics();
    g.rect(4, 4, 40, 40).fill(color);
    g.rect(4, 4, 40, 40).stroke({ width: 3, color: 0x0f172a });
    g.rect(4, 4, 40, 8).fill({ color: 0xffffff, alpha: 0.18 }); // top face highlight
    g.rect(36, 4, 8, 40).fill({ color: 0x000000, alpha: 0.18 }); // side face shade
    g.rect(14, 18, 7, 7).fill({ color: 0xffffff, alpha: 0.5 });
    g.rect(26, 28, 6, 6).fill({ color: 0xffffff, alpha: 0.35 });
    return g;
  }

  _drawStructure() {
    const g = new PIXI.Graphics();
    g.rect(4, 16, 40, 28).fill(this.palette.structure);
    g.rect(4, 16, 40, 28).stroke({ width: 3, color: 0x064e3b });
    g.poly([2, 16, 24, 2, 46, 16]).fill(0x064e3b); // roof
    g.rect(19, 28, 10, 16).fill(0x03271c); // door
    return g;
  }

  _drawGroundTile() {
    const g = new PIXI.Graphics();
    g.rect(0, 0, 64, 64).fill(0x0d1b16);
    g.rect(0, 0, 64, 64).stroke({ width: 1, color: 0x1c3a2e, alpha: 0.8 });
    g.rect(12, 14, 6, 6).fill({ color: 0x1c3a2e, alpha: 0.7 });
    g.rect(40, 38, 8, 5).fill({ color: 0x1c3a2e, alpha: 0.7 });
    return g;
  }

  // ---- runner-gauntlet ------------------------------------------------------

  _drawRunner() {
    const g = new PIXI.Graphics();
    g.roundRect(10, 6, 20, 26, 8).fill(this.palette.player);
    g.roundRect(10, 6, 20, 26, 8).stroke({ width: 3, color: this.palette.playerRing });
    g.circle(25, 15, 3).fill(0x03131d); // forward-facing eye
    g.roundRect(12, 32, 7, 8, 3).fill(this.palette.playerRing); // legs
    g.roundRect(21, 32, 7, 8, 3).fill(this.palette.playerRing);
    return g;
  }

  _drawPlatform() {
    const g = new PIXI.Graphics();
    g.roundRect(0, 0, 64, 20, 5).fill(this.palette.platform);
    g.roundRect(0, 0, 64, 20, 5).stroke({ width: 2, color: 0x64748b });
    g.rect(0, 0, 64, 5).fill({ color: 0x67e8f9, alpha: 0.35 }); // lit top edge
    return g;
  }

  _drawCoin() {
    const g = new PIXI.Graphics();
    g.circle(18, 18, 16).fill({ color: this.palette.coin, alpha: 0.18 });
    g.circle(18, 18, 12).fill(this.palette.coin);
    g.circle(18, 18, 12).stroke({ width: 2, color: 0x92400e });
    g.circle(18, 18, 6).stroke({ width: 2, color: 0x92400e });
    return g;
  }

  _drawSpike() {
    const g = new PIXI.Graphics();
    g.poly([0, 32, 12, 4, 24, 32]).fill(this.palette.spike);
    g.poly([0, 32, 12, 4, 24, 32]).stroke({ width: 2, color: 0x7f1d1d });
    g.poly([20, 32, 32, 10, 44, 32]).fill(this.palette.spike);
    g.poly([20, 32, 32, 10, 44, 32]).stroke({ width: 2, color: 0x7f1d1d });
    return g;
  }

  /**
   * Load a real image URL into a texture, keyed for reuse. Falls back to the
   * procedural texture for `fallbackKey` if the load fails.
   */
  async loadImage(key, url, fallbackKey = 'objective') {
    if (!url) return this.get(fallbackKey);
    try {
      const texture = await PIXI.Assets.load(url);
      this.textures.set(key, texture);
      return texture;
    } catch (err) {
      console.warn('[AssetLoader] image load failed, using fallback', url, err);
      return this.get(fallbackKey);
    }
  }

  /**
   * Swap generated art in over an existing pack key, AT THE PACK KEY'S SIZE.
   *
   * The resize is the whole point. Prefabs and scenes were written against the
   * procedural pack's dimensions — a TilingSprite floor repeats at the tile's
   * natural size, and several prefabs never set width/height at all. Generated
   * art arrives at 512x512, so registering it raw would tile a room with four
   * enormous squares and inflate every unsized sprite. Rendering it down to the
   * texture it replaces means every existing consumer keeps working untouched.
   *
   * Returns true when the swap happened; false leaves the procedural texture in
   * place, which is always a playable outcome.
   */
  async replaceWithImage(key, url) {
    const existing = this.textures.get(key);
    if (!existing || !url) return false;
    try {
      const loaded = await PIXI.Assets.load(url);
      const sprite = new PIXI.Sprite(loaded);
      sprite.width = existing.width;
      sprite.height = existing.height;
      const resized = this.renderer.generateTexture(sprite);
      sprite.destroy();
      this.textures.set(key, resized);
      return true;
    } catch (err) {
      console.warn('[AssetLoader] generated art failed to load, keeping placeholder', key, url, err);
      return false;
    }
  }
}