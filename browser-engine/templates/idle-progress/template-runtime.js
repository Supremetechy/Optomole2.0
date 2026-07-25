/**
 * template-runtime (idle-progress) — orchestrates the scene flow for one idle
 * experience.
 *
 *   manifest -> MappingEngine -> Economy (generators + upgrades + milestones)
 *   Boot -> Lab (tick loop) -> Completion(mastered) -> start over
 *
 * Reuses the genre-agnostic MappingEngine (binding -> EntitySpec) and QuestEngine
 * (milestone checklist in the HUD), then drives the idle-specific Boot / Idle /
 * Completion scenes over a pure Economy model.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { buildEconomy } from './entity-factory.js';
import { Economy } from './economy.js';
import { BootScene } from './scenes/BootScene.js';
import { IdleScene } from './scenes/IdleScene.js';
import { CompletionScene } from './scenes/CompletionScene.js';

export class IdleTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);
    this.model = buildEconomy(this.mapping.specs, { title: this.mapping.world.title || meta.title || manifest.title });
    const coach = this.mapping.specs.find((s) => s.entityType === 'npc');
    this._coachLine = coach?.description || null;
  }

  async start(runtime) {
    this.runtime = runtime;
    const ctx = runtime.services;

    ctx.quests = new QuestEngine(ctx.state, ctx.audio);

    for (const slot of this.manifest.assetSlots || []) {
      if (slot.type === 'audio' && slot.url) ctx.audio.register(slot.id, slot.url);
    }

    ctx.state.set({
      experience: {
        title: this.meta.title || 'Optomole Idle',
        template: 'idle-progress',
        roomCount: 1,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    const briefing = [this.meta.briefing, this._coachLine].filter(Boolean).join(' ')
      || 'Invest Insight into each concept to automate your learning, then push every milestone to full mastery.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.model.title,
        subtitle: this.meta.subtitle || 'Idle · Progress',
        briefing,
        onStart: () => this._enterLab(),
      }),
    );
  }

  _enterLab() {
    const ctx = this.runtime.services;
    // Fresh economy each run so replay starts clean.
    this.economy = new Economy({
      generators: this.model.generators,
      upgrades: this.model.upgrades,
      clickPower: 1,
    });

    ctx.scenes.replace(
      new IdleScene(ctx, {
        economy: this.economy,
        milestones: this.model.milestones,
        title: this.model.title,
        onComplete: () => this._showCompletion(),
      }),
    );
  }

  _showCompletion() {
    const ctx = this.runtime.services;
    ctx.state.setFlag('experienceComplete', true); // ends the signal session + notifies the embedding page
    ctx.scenes.replace(
      new CompletionScene(ctx, {
        economy: this.economy,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._enterLab();
  }
}

/** Convenience factory used by the loader. */
export function createIdleRuntime(manifest, meta) {
  return new IdleTemplateRuntime(manifest, meta);
}
