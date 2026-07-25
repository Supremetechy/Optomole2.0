/**
 * template-runtime (fps-target-gallery) — orchestrates one range session.
 *
 *   manifest -> MappingEngine -> buildRounds() -> rounds
 *   Boot -> Round 1 -> Round 2 -> ... -> Result(qualified) -> replay
 *                          └─(integrity/time out)─> Result(failed) -> retry
 *
 * Accuracy and discipline accumulate across rounds so the final qualification
 * card reflects the whole session, not just the last round — one wrongful
 * engagement anywhere caps the badge, which is the behaviour the drill teaches.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { buildRounds } from './entity-factory.js';
import { BootScene } from './scenes/BootScene.js';
import { RangeScene } from './scenes/RangeScene.js';
import { ResultScene } from './scenes/ResultScene.js';

export class FpsGalleryTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);
    this.roundModel = buildRounds(this.mapping.specs, {
      roundSize: meta.roundSize || 4,
      title: this.mapping.world.title || meta.title || manifest.title || 'The Range',
      world: this.mapping.world,
    });
    // An npc binding becomes the range officer's brief.
    const officer = this.mapping.specs.find((s) => s.entityType === 'npc');
    this._officerLine = officer?.description || null;
    this._resetStats();
  }

  _resetStats() {
    this.session = { shotsFired: 0, shotsHit: 0, wrongful: 0, held: 0 };
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
        title: this.meta.title || 'Optomole Range',
        template: 'fps-target-gallery',
        roomCount: this.roundModel.rounds.length,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    const briefing = [this.meta.briefing, this._officerLine].filter(Boolean).join(' ')
      || 'Identify every threat downrange and engage it. Routine activity is not a target — hold fire and you score for it.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.roundModel.title,
        subtitle: this.meta.subtitle || 'FPS · Target Gallery',
        briefing,
        roundCount: this.roundModel.rounds.length,
        onStart: () => this._enterRound(0),
      }),
    );
  }

  _enterRound(index) {
    const ctx = this.runtime.services;
    const round = this.roundModel.rounds[index];
    if (!round) return this._showResult(true);

    ctx.scenes.replace(
      new RangeScene(ctx, {
        round,
        roundIndex: index,
        roundCount: this.roundModel.rounds.length,
        onRoundClear: (stats) => {
          this._accumulate(stats);
          this._enterRound(index + 1);
        },
        onFail: (stats) => {
          this._accumulate(stats);
          this._showResult(false);
        },
      }),
    );
  }

  _accumulate(stats = {}) {
    this.session.shotsFired += stats.shotsFired || 0;
    // Reconstruct hits from the round's own accuracy so the session average is
    // shot-weighted rather than a mean of per-round percentages.
    this.session.shotsHit += Math.round((stats.accuracy || 0) * (stats.shotsFired || 0));
    this.session.wrongful += stats.wrongful || 0;
    this.session.held += stats.held || 0;
  }

  _showResult(win) {
    const ctx = this.runtime.services;
    ctx.state.setFlag('experienceComplete', true); // ends the signal session + notifies the embedding page
    const { shotsFired, shotsHit } = this.session;
    ctx.scenes.replace(
      new ResultScene(ctx, {
        win,
        roundCount: this.roundModel.rounds.length,
        stats: {
          ...this.session,
          accuracy: shotsFired ? shotsHit / shotsFired : win ? 1 : 0,
        },
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._resetStats();
    this._enterRound(0);
  }
}

/** Convenience factory used by the loader. */
export function createFpsGalleryRuntime(manifest, meta) {
  return new FpsGalleryTemplateRuntime(manifest, meta);
}
