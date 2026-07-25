/**
 * template-runtime (open-world-courier) — orchestrates one courier shift.
 *
 *   manifest -> MappingEngine -> buildCity() + buildContracts() -> the board
 *   Boot -> City (free roam, all contracts live at once) -> Result -> replay
 *
 * Unlike the chaptered genres, this template has a single continuous scene: the
 * whole board is available from the first second and the player picks their own
 * order. City size scales with the contract count so a short newsletter gets a
 * tight few blocks and a long SOP gets a real map.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { buildCity, buildContracts, spawnPoint } from './entity-factory.js';
import { BootScene } from './scenes/BootScene.js';
import { CityScene } from './scenes/CityScene.js';
import { ResultScene } from './scenes/ResultScene.js';

export class CourierTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);

    // Scale the map to the workload: enough room that deliveries are journeys,
    // not so much that the player spends the shift driving through empty blocks.
    const contractish = this.mapping.specs.filter(
      (s) => !['npc', 'hazard', 'lock', 'exit-gate'].includes(s.entityType),
    ).length;
    const span = Math.max(12, Math.min(27, 9 + contractish * 2));

    this.city = buildCity({ cols: span, rows: span });
    this.model = buildContracts(this.mapping.specs, this.city, {
      title: this.mapping.world.title || meta.title || manifest.title || 'The City',
      districtSize: meta.districtSize || 4,
      world: this.mapping.world,
    });
    this.model.spawn = spawnPoint(this.city, this.model.contracts[0]?.pickup || null);

    const dispatcher = this.model.dispatcher;
    this._dispatchLine = dispatcher?.description || null;
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
      heat: 0,
      experience: {
        title: this.meta.title || this.model.title,
        template: 'open-world-courier',
        roomCount: this.model.districts.length,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    const briefing = [this.meta.briefing, this._dispatchLine].filter(Boolean).join(' ')
      || 'The board is yours. Pick up each job, run it across town, and keep the heat down.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.model.title,
        subtitle: this.meta.subtitle || 'Open World · Courier',
        briefing,
        contractCount: this.model.contracts.length,
        districtCount: this.model.districts.length,
        onStart: () => this._enterCity(),
      }),
    );
  }

  _enterCity() {
    const ctx = this.runtime.services;
    // Reset per-run contract state so a replay starts from a clean board.
    for (const contract of this.model.contracts) contract.state = 'available';

    ctx.scenes.replace(
      new CityScene(ctx, {
        model: this.model,
        onComplete: (stats) => this._showResult(true, stats),
        onBusted: (stats) => this._showResult(false, stats),
      }),
    );
  }

  _showResult(win, stats) {
    const ctx = this.runtime.services;
    ctx.state.setFlag('experienceComplete', true); // ends the signal session + notifies the embedding page
    ctx.scenes.replace(
      new ResultScene(ctx, {
        win,
        contractCount: this.model.contracts.length,
        stats,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._enterCity();
  }
}

/** Convenience factory used by the loader. */
export function createCourierRuntime(manifest, meta) {
  return new CourierTemplateRuntime(manifest, meta);
}
