/**
 * template-runtime (action-adventure-key-lock) — orchestrates the scene flow
 * for one experience.
 *
 *   manifest -> MappingEngine -> room graph
 *   Boot -> Room 1 -> (Dialogue) -> Room 2 -> ... -> Reward -> replay
 *
 * It instantiates the gameplay engines (Quest, Rpg, Dialogue), attaches them to
 * the shared service context so scenes can reach them, wires audio slots, and
 * advances rooms as the player unlocks each gate.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { DialogueEngine } from '../../engines/DialogueEngine.js';
import { BootScene } from './scenes/BootScene.js';
import { RoomScene } from './scenes/RoomScene.js';
import { DialogueScene } from './scenes/DialogueScene.js';
import { RewardScene } from './scenes/RewardScene.js';

export class KeyLockTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta; // { title, subtitle, briefing }
    this.mapping = new MappingEngine(manifest);
    this.graph = this.mapping.toRoomGraph({ roomSize: meta.roomSize || 6, title: meta.title });
  }

  async start(runtime) {
    this.runtime = runtime;
    const ctx = runtime.services;

    // Attach gameplay engines to the shared context.
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    ctx.rpg = new RpgEngine(ctx.state);
    ctx.dialogue = new DialogueEngine({ state: ctx.state, quests: ctx.quests, audio: ctx.audio });

    // Register any real audio cues supplied by asset slots (optional).
    for (const slot of this.manifest.assetSlots || []) {
      if (slot.type === 'audio' && slot.url) ctx.audio.register(slot.id, slot.url);
    }

    ctx.state.set({
      experience: {
        title: this.meta.title || 'Optomole Experience',
        template: 'action-adventure-key-lock',
        roomCount: this.graph.rooms.length,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.graph.title,
        subtitle: this.meta.subtitle || 'Action Adventure · Key & Lock',
        briefing: this.meta.briefing || 'Explore each room, collect the key evidence, avoid the hazards, and unlock the gate to advance.',
        onStart: () => this._enterRoom(0),
      }),
    );
  }

  _enterRoom(index) {
    const ctx = this.runtime.services;
    const room = this.graph.rooms[index];
    if (!room) return this._showReward();

    ctx.scenes.replace(
      new RoomScene(ctx, {
        room,
        roomIndex: index,
        roomCount: this.graph.rooms.length,
        onExit: () => this._enterRoom(index + 1),
        openDialogue: (tree) => this._openDialogue(tree),
      }),
    );
  }

  _openDialogue(tree) {
    const ctx = this.runtime.services;
    ctx.scenes.push(new DialogueScene(ctx, { tree, onClose: () => ctx.scenes.pop() }));
  }

  _showReward() {
    const ctx = this.runtime.services;
    ctx.scenes.replace(
      new RewardScene(ctx, {
        roomCount: this.graph.rooms.length,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    // Reset progression and rebuild the quest log for a fresh run.
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    ctx.dialogue = new DialogueEngine({ state: ctx.state, quests: ctx.quests, audio: ctx.audio });
    this._enterRoom(0);
  }
}

/** Convenience factory used by the loader. */
export function createKeyLockRuntime(manifest, meta) {
  return new KeyLockTemplateRuntime(manifest, meta);
}
