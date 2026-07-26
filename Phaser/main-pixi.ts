import { Application, Container, Graphics, Texture } from "pixi.js";
import { RuntimeCore } from "./runtime/RuntimeCore";
import { PixiAdapter } from "./adapters/PixiAdapter";
import { attachSignalBridgeFromUrl } from "./runtime/SignalBridge";
import {
  GameplayBundle,
  entrySceneId,
  resolveBundle,
  spriteSpecs,
  worldWidthUnits,
} from "./runtime/GameplayBundle";
import { showStatus } from "./runtime/StatusLine";
import { SKYRUN_BUNDLE } from "./skyrun";

/**
 * The Pixi host — the second proof that gameplay lives in the DSL.
 *
 * It loads the same bundle as main.ts (static SkyRun, or a compiled one via
 * `?bundle=`), builds the same placeholder art from the same specs, and runs
 * the same RuntimeCore. Only the adapter differs.
 */

const VIEW_W = 800;
const VIEW_H = 600;
const OFFSET_X = 100; // px; shifts DSL x=0 clear of the left edge
const WORLD_MARGIN_UNITS = 4;
const MAX_FRAME_S = 0.05; // clamp so a backgrounded tab can't tunnel bodies

async function main() {
  const result = await resolveBundle(SKYRUN_BUNDLE);
  const bundle = result.bundle;
  showStatus("Pixi", bundle, result);

  const app = new Application();
  await app.init({ width: VIEW_W, height: VIEW_H, background: "#1c2340", antialias: true });
  (document.getElementById("stage") ?? document.body).appendChild(app.canvas);

  const world = new Container();
  const overlay = new Container();
  app.stage.addChild(world, overlay);

  const ppu = bundle.game.config.pixelPerUnit ?? 100;
  const textures = buildTextures(app, bundle, ppu);
  const widthUnits = worldWidthUnits(bundle) + WORLD_MARGIN_UNITS;

  const adapter = new PixiAdapter({
    world,
    overlay,
    textures,
    pixelsPerUnit: ppu,
    worldHeight: VIEW_H,
    offsetX: OFFSET_X,
    gravityY: bundle.game.config.gravity.y,
    worldWidthUnits: widthUnits,
    viewportWidth: VIEW_W,
  });

  const core = new RuntimeCore(adapter);
  core.loadGame(
    bundle.game,
    bundle.scenes,
    bundle.entities,
    bundle.stateMachines,
    bundle.triggers,
    bundle.directors ?? [],
    bundle.sequences ?? []
  );

  // Observation before the first scene loads, so scene_enter is captured.
  attachSignalBridgeFromUrl(core, "dsl-pixi");

  core.loadScene(entrySceneId(bundle));

  const playerId = bundle.entities.find(e => e.tags.includes("player"))?.id;
  const worldWidthPx = OFFSET_X + widthUnits * ppu;

  app.ticker.add(ticker => {
    core.update(Math.min(ticker.deltaMS / 1000, MAX_FRAME_S));
    // Camera: pan the world container so the player stays centred, clamped to
    // the world edges. Re-read the handle each frame — LoadScene replaces it.
    const player = playerId ? adapter.getEntityHandle(playerId) : undefined;
    if (!player) return;
    const target = player.x - VIEW_W / 2;
    world.x = -Math.max(0, Math.min(target, Math.max(0, worldWidthPx - VIEW_W)));
  });
}

/**
 * Flat-color stand-ins, one per sprite id the bundle references. Drawn at
 * 1 DSL unit = pixelPerUnit pixels so a sprite at scale 1 matches its collider.
 */
function buildTextures(app: Application, bundle: GameplayBundle, ppu: number): Map<string, Texture> {
  const textures = new Map<string, Texture>();
  for (const spec of spriteSpecs(bundle)) {
    const w = Math.max(1, Math.round(spec.widthUnits * ppu));
    const h = Math.max(1, Math.round(spec.heightUnits * ppu));
    const g = new Graphics()
      .rect(0, 0, w, h)
      .fill({ color: spec.color })
      .stroke({ width: 3, color: 0x000000, alpha: 0.35 });
    textures.set(spec.id, app.renderer.generateTexture(g));
    g.destroy();
  }
  return textures;
}

void main();
