/**
 * template-runtime (runner-gauntlet) — orchestrates one gauntlet run.
 *
 *   manifest -> MappingEngine -> buildCourse() -> a single linear course
 *   Boot -> Run -> Result -> replay
 *
 * The shortest loop of the five templates by design: this genre is meant to be
 * replayed daily against a distance score, so there are no chapter transitions
 * and no overlays between the start line and the finish. `bestDistance` survives
 * replays within a session so each run has a number to beat.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { buildCourse } from './entity-factory.js';
import { BootScene } from './scenes/BootScene.js';
import { RunScene } from './scenes/RunScene.js';
import { ResultScene } from './scenes/ResultScene.js';

export class RunnerTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);
    this.course = buildCourse(this.mapping.specs, {
      title: this.mapping.world.title || meta.title || manifest.title || 'The Gauntlet',
      tokensPerStage: meta.tokensPerStage || 3,
      world: this.mapping.world,
    });
    this._coachLine = this.course.coach?.description || null;
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
      bestDistance: 0,
      experience: {
        title: this.meta.title || this.course.title,
        template: 'runner-gauntlet',
        roomCount: this.course.stages.length,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    const briefing = [this.meta.briefing, this._coachLine].filter(Boolean).join(' ')
      || 'Jump the setbacks, grab the facts, and reach every checkpoint before your integrity runs out.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.course.title,
        subtitle: this.meta.subtitle || 'Arcade · Runner Gauntlet',
        briefing,
        stageCount: this.course.stages.length,
        tokenCount: this.course.tokenCount,
        onStart: () => this._enterRun(),
      }),
    );
  }

  _enterRun() {
    const ctx = this.runtime.services;
    ctx.scenes.replace(
      new RunScene(ctx, {
        course: this.course,
        onComplete: (stats) => this._showResult(true, stats),
        onFail: (stats) => this._showResult(false, stats),
      }),
    );
  }

  _showResult(win, stats) {
    const ctx = this.runtime.services;
    ctx.state.setFlag('experienceComplete', true); // ends the signal session + notifies the embedding page
    ctx.scenes.replace(
      new ResultScene(ctx, {
        win,
        stats,
        targetSpec: this.course.target,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    // Preserve the session best across replays; reset everything else.
    const best = ctx.state.get('bestDistance') || 0;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.state.set({ bestDistance: best });
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._enterRun();
  }
}

/** Convenience factory used by the loader. */
export function createRunnerRuntime(manifest, meta) {
  return new RunnerTemplateRuntime(manifest, meta);
}
