/**
 * template-runtime (Phaser · arcade-collect-avoid) — the Phaser-build twin of
 * templates/arcade-collect-avoid/template-runtime.js.
 *
 *   manifest -> MappingEngine -> waves
 *   Boot -> Wave 1 -> Wave 2 -> ... -> Result(win) -> replay
 *                         └─(integrity/time out)─> Result(lose) -> retry
 *
 * It reuses the genre-agnostic MappingEngine (binding -> EntitySpec), QuestEngine
 * (per-wave objectives + rewards) and RpgEngine (score/level) exactly as the Pixi
 * build does, then drives Boot / Arena / Result scenes rendered with Phaser 4.
 *
 * The scene classes are built from factories at start() time (after the Phaser
 * lib is loaded) so this module never touches the `Phaser` global at import time.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { buildWaves } from './waves.js';
import { makeBootScene } from './scenes/BootScene.js';
import { makeArenaScene } from './scenes/ArenaScene.js';
import { makeResultScene } from './scenes/ResultScene.js';

export class PhaserArcadeTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);
    this.waveModel = buildWaves(this.mapping.specs, {
      waveSize: meta.waveSize || 4,
      title: meta.title || manifest.title,
    });
    const coach = this.mapping.specs.find((s) => s.entityType === 'npc');
    this._coachLine = coach?.description || null;
  }

  async start(runtime) {
    this.runtime = runtime;
    const ctx = runtime.services;

    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    ctx.rpg = new RpgEngine(ctx.state);

    for (const slot of this.manifest.assetSlots || []) {
      if (slot.type === 'audio' && slot.url) ctx.audio.register(slot.id, slot.url);
    }

    ctx.state.set({
      experience: {
        title: this.meta.title || 'Optomole Arcade',
        template: 'arcade-collect-avoid · phaser',
        roomCount: this.waveModel.waves.length,
      },
    });

    const snapshot = JSON.parse(JSON.stringify(ctx.state.get()));

    // Scenes read shared data + helpers out of the Phaser registry. Transitions
    // are driven from inside the active scene (this.scene.start / .restart) so we
    // never stop-then-start the same key in one tick, which races Phaser's scene
    // manager and drops the restarted scene's update loop + physics colliders.
    const flow = {
      ctx,
      meta: this.meta,
      waveModel: this.waveModel,
      coachLine: this._coachLine,
      waveCount: this.waveModel.waves.length,
      // Replay: restore the opening snapshot and a fresh objective set.
      resetState: () => {
        ctx.state.set(JSON.parse(JSON.stringify(snapshot)));
        ctx.quests = new QuestEngine(ctx.state, ctx.audio);
      },
    };
    const game = runtime.game;
    game.registry.set('flow', flow);

    const Phaser = window.Phaser;
    game.scene.add('Boot', makeBootScene(Phaser), false);
    game.scene.add('Arena', makeArenaScene(Phaser), false);
    game.scene.add('Result', makeResultScene(Phaser), false);

    this._game = game;
    game.scene.start('Boot');
    return this;
  }
}

/** Convenience factory used by boot-phaser.js. */
export function createPhaserArcadeRuntime(manifest, meta) {
  return new PhaserArcadeTemplateRuntime(manifest, meta);
}
