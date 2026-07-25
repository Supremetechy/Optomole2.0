/**
 * template-runtime (arcade-collect-avoid) — orchestrates the scene flow for one
 * arcade experience.
 *
 *   manifest -> MappingEngine -> waves
 *   Boot -> Wave 1 -> Wave 2 -> ... -> Result(win) -> replay
 *                         └─(integrity/time out)─> Result(lose) -> retry
 *
 * It reuses the genre-agnostic MappingEngine (binding -> EntitySpec), QuestEngine
 * (per-wave objectives + rewards), and RpgEngine (score/level), then drives the
 * arcade-specific Boot / Arena / Result scenes.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { buildWaves } from './entity-factory.js';
import { BootScene } from './scenes/BootScene.js';
import { ArenaScene } from './scenes/ArenaScene.js';
import { ResultScene } from './scenes/ResultScene.js';

export class ArcadeTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);
    this.waveModel = buildWaves(this.mapping.specs, {
      waveSize: meta.waveSize || 4,
      title: this.mapping.world.title || meta.title || manifest.title,
      world: this.mapping.world,
    });
    // Fold any NPC "coach" binding into the boot briefing.
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
        template: 'arcade-collect-avoid',
        roomCount: this.waveModel.waves.length,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    const briefing = [
      this.meta.briefing,
      this._coachLine,
    ].filter(Boolean).join(' ') || 'Grab the correct concepts, dodge the decoys, and clear every wave before the clock runs out.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.waveModel.title,
        subtitle: this.meta.subtitle || 'Arcade · Collect & Avoid',
        briefing,
        onStart: () => this._enterWave(0),
      }),
    );
  }

  _enterWave(index) {
    const ctx = this.runtime.services;
    const wave = this.waveModel.waves[index];
    if (!wave) return this._showResult(true);

    ctx.scenes.replace(
      new ArenaScene(ctx, {
        wave,
        waveIndex: index,
        waveCount: this.waveModel.waves.length,
        onWaveClear: () => this._enterWave(index + 1),
        onFail: () => this._showResult(false),
      }),
    );
  }

  _showResult(win) {
    const ctx = this.runtime.services;
    ctx.state.setFlag('experienceComplete', true); // ends the signal session + notifies the embedding page
    ctx.scenes.replace(
      new ResultScene(ctx, {
        win,
        waveCount: this.waveModel.waves.length,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._enterWave(0);
  }
}

/** Convenience factory used by the loader. */
export function createArcadeRuntime(manifest, meta) {
  return new ArcadeTemplateRuntime(manifest, meta);
}
