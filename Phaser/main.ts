import Phaser from "phaser";
import { RuntimeCore } from "./runtime/RuntimeCore";
import { PhaserAdapter } from "./adapters/PhaserAdapter";
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
import type { Entity } from "./dsl/types";

const VIEW_W = 800;
const VIEW_H = 600;
const OFFSET_X = 100; // px; shifts DSL x=0 clear of the left edge
const WORLD_MARGIN_PX = 400;

/**
 * Host scene: owns nothing about gameplay. It generates placeholder art for
 * whatever sprite ids the bundle references, hands the bundle to the
 * RuntimeCore, and follows whichever entity is tagged `player`.
 */
export class DslHostScene extends Phaser.Scene {
  private core!: RuntimeCore;
  private adapter!: PhaserAdapter;
  private readonly bundle: GameplayBundle;
  private readonly ppu: number;
  private readonly worldWidthPx: number;

  constructor(bundle: GameplayBundle) {
    super("DslHostScene");
    this.bundle = bundle;
    this.ppu = bundle.game.config.pixelPerUnit ?? 100;
    this.worldWidthPx = Math.max(
      VIEW_W,
      OFFSET_X + worldWidthUnits(bundle) * this.ppu + WORLD_MARGIN_PX
    );
  }

  preload() {
    // No binary assets: 1 DSL unit (meter) = pixelPerUnit pixels, so each
    // generated texture matches its entity's collider at scale 1.
    for (const spec of spriteSpecs(this.bundle)) {
      this.makeTexture(spec.id, spec.widthUnits, spec.heightUnits, spec.color);
    }
  }

  create() {
    this.physics.world.setBounds(0, 0, this.worldWidthPx, VIEW_H);

    this.adapter = new PhaserAdapter(this, {
      pixelsPerUnit: this.ppu,
      worldHeight: VIEW_H,
      offsetX: OFFSET_X,
      gravityY: this.bundle.game.config.gravity.y,
    });
    this.core = new RuntimeCore(this.adapter);

    this.core.loadGame(
      this.bundle.game,
      this.bundle.scenes,
      this.bundle.entities,
      this.bundle.stateMachines,
      this.bundle.triggers,
      this.bundle.directors ?? [],
      this.bundle.sequences ?? []
    );

    // Observation before the first scene loads, so scene_enter is captured.
    attachSignalBridgeFromUrl(this.core, "dsl-phaser");

    this.cameras.main.setBounds(0, 0, this.worldWidthPx, VIEW_H);
    // A multi-scene bundle swaps every sprite on LoadScene; re-acquire the
    // follow target each time rather than holding a destroyed handle.
    this.core.subscribe(n => {
      if (n.kind === "event" && n.event.type === "OnSceneEnter") this.followPlayer();
    });

    this.core.loadScene(entrySceneId(this.bundle));
  }

  update(_time: number, delta: number) {
    this.core.update(delta / 1000);
  }

  private followPlayer() {
    const player = this.bundle.entities.find((e: Entity) => e.tags.includes("player"));
    const sprite = player ? this.adapter.getEntityHandle(player.id) : undefined;
    if (sprite) this.cameras.main.startFollow(sprite, true, 0.1, 0.1);
  }

  private makeTexture(key: string, wUnits: number, hUnits: number, color: number) {
    const w = Math.max(1, Math.round(wUnits * this.ppu));
    const h = Math.max(1, Math.round(hUnits * this.ppu));
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(3, 0x000000, 0.35);
    g.strokeRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}

void resolveBundle(SKYRUN_BUNDLE).then(result => {
  showStatus("Phaser", result.bundle, result);
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: "#1c2340",
    physics: {
      default: "arcade",
      // Gravity comes from the bundle via the adapter in createScene.
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [new DslHostScene(result.bundle)],
  };
  new Phaser.Game(config);
});
