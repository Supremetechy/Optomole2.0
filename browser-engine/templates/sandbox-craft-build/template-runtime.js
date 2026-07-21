/**
 * template-runtime (sandbox-craft-build) — orchestrates one claim.
 *
 *   manifest -> MappingEngine -> buildWorld() -> nodes + recipes + blueprints
 *   Boot -> World (free roam) -> [Craft overlay] -> Completion -> replay
 *
 * Like the courier genre this is a single continuous world rather than a chapter
 * sequence: the player chooses what to mine and what to build first. World size
 * scales with the node count so short content is a tight claim and a long manual
 * is a real map.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { buildWorld } from './entity-factory.js';
import { BootScene } from './scenes/BootScene.js';
import { WorldScene } from './scenes/WorldScene.js';
import { CraftScene } from './scenes/CraftScene.js';
import { CompletionScene } from './scenes/CompletionScene.js';

export class SandboxTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);

    const bindingCount = this.mapping.specs.length;
    const span = Math.max(14, Math.min(30, 10 + bindingCount));

    this.model = buildWorld(this.mapping.specs, {
      title: meta.title || manifest.title || 'The Claim',
      cols: span,
      rows: Math.round(span * 0.75),
    });

    this._foremanLine = this.model.foreman?.description || null;
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
      energy: 100,
      materials: { ore: 0, wood: 0, stone: 0 },
      experience: {
        title: this.meta.title || this.model.title,
        template: 'sandbox-craft-build',
        roomCount: this.model.blueprints.length,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    const briefing = [this.meta.briefing, this._foremanLine].filter(Boolean).join(' ')
      || 'Mine the blocks for materials, craft each step of the build, and raise it on the claim.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.model.title,
        subtitle: this.meta.subtitle || 'Sandbox · Craft & Build',
        briefing,
        nodeCount: this.model.nodes.length,
        recipeCount: this.model.recipes.length,
        materials: this.model.materials,
        onStart: () => this._enterWorld(),
      }),
    );
  }

  _enterWorld() {
    const ctx = this.runtime.services;

    // Reset per-run craft state so a replay starts from an unbuilt claim.
    for (const recipe of this.model.recipes) {
      recipe.crafted = false;
      recipe.placed = false;
      recipe.placedAt = null;
    }
    for (const bp of this.model.blueprints) bp.complete = false;

    const scene = new WorldScene(ctx, {
      model: this.model,
      onComplete: (stats) => this._showCompletion(true, stats),
      onExhausted: (stats) => this._showCompletion(false, stats),
      onOpenCrafting: (done) => {
        ctx.scenes.push(
          new CraftScene(ctx, {
            model: this.model,
            onCraft: (recipe) => scene.craft(recipe),
            onClose: () => {
              ctx.scenes.pop();
              done?.();
            },
          }),
        );
      },
    });

    this._world = scene;
    ctx.scenes.replace(scene);
  }

  _showCompletion(win, stats) {
    const ctx = this.runtime.services;
    ctx.scenes.replace(
      new CompletionScene(ctx, {
        win,
        model: this.model,
        stats,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._enterWorld();
  }
}

/** Convenience factory used by the loader. */
export function createSandboxRuntime(manifest, meta) {
  return new SandboxTemplateRuntime(manifest, meta);
}
