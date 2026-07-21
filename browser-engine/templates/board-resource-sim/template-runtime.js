/**
 * template-runtime (board-resource-sim) — orchestrates the scene flow for one
 * board experience.
 *
 *   manifest -> MappingEngine -> BoardModel (ring of spaces + resources)
 *   Boot -> Board (roll/move/resolve turns) -> Completion -> new board
 *
 * Reuses the genre-agnostic MappingEngine (binding -> EntitySpec) and QuestEngine
 * (concept checklist in the HUD), then drives the board-specific Boot / Board /
 * Completion scenes over a pure BoardModel.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { buildBoard } from './entity-factory.js';
import { BoardModel } from './board.js';
import { BootScene } from './scenes/BootScene.js';
import { BoardScene } from './scenes/BoardScene.js';
import { CompletionScene } from './scenes/CompletionScene.js';

export class BoardTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);
    this.plan = buildBoard(this.mapping.specs, { title: meta.title || manifest.title });
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
        title: this.meta.title || 'Optomole Board',
        template: 'board-resource-sim',
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
      || 'Roll the die, lap the board, and collect every concept square while managing your energy and coins.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.plan.title,
        subtitle: this.meta.subtitle || 'Board · Resource Sim',
        briefing,
        onStart: () => this._enterBoard(),
      }),
    );
  }

  _enterBoard() {
    const ctx = this.runtime.services;
    // Fresh model each run so replay starts clean.
    this.model = new BoardModel({ spaces: this.plan.spaces });

    ctx.scenes.replace(
      new BoardScene(ctx, {
        model: this.model,
        title: this.plan.title,
        onComplete: () => this._showCompletion(),
      }),
    );
  }

  _showCompletion() {
    const ctx = this.runtime.services;
    ctx.scenes.replace(
      new CompletionScene(ctx, {
        model: this.model,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._enterBoard();
  }
}

/** Convenience factory used by the loader. */
export function createBoardRuntime(manifest, meta) {
  return new BoardTemplateRuntime(manifest, meta);
}
