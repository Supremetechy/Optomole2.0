/**
 * template-runtime (quest-rpg-progression) — orchestrates one RPG campaign.
 *
 *   manifest -> MappingEngine -> buildCampaign() -> chapters
 *   Boot -> Region 1 -> [Briefing / Encounter overlays] -> Skill -> Region 2 ...
 *                              └─(focus depleted)─> Completion(lose) -> retry
 *   ... -> Completion(win) -> replay
 *
 * It reuses the genre-agnostic MappingEngine (binding -> EntitySpec), QuestEngine
 * (objectives + rewards) and RpgEngine (progression), then drives the RPG-specific
 * scenes. Level-ups are detected between chapters and cash out as skill points in
 * the SkillScene — the loop that makes long content feel like character growth.
 */
import { MappingEngine } from '../../engines/MappingEngine.js';
import { QuestEngine } from '../../engines/QuestEngine.js';
import { RpgEngine } from '../../engines/RpgEngine.js';
import { buildCampaign, buildEncounterQuiz } from './entity-factory.js';
import { BootScene } from './scenes/BootScene.js';
import { RegionScene } from './scenes/RegionScene.js';
import { EncounterScene } from './scenes/EncounterScene.js';
import { BriefingScene } from './scenes/BriefingScene.js';
import { SkillScene } from './scenes/SkillScene.js';
import { CompletionScene } from './scenes/CompletionScene.js';

export class QuestRpgTemplateRuntime {
  constructor(manifest = {}, meta = {}) {
    this.manifest = manifest;
    this.meta = meta;
    this.mapping = new MappingEngine(manifest);
    this.campaign = buildCampaign(this.mapping.specs, {
      chapterSize: meta.chapterSize || 5,
      title: this.mapping.world.title || meta.title || manifest.title || 'The Campaign',
      world: this.mapping.world,
    });
    // The mentor/author line frames the boot card.
    const mentor = this.mapping.specs.find((s) => s.entityType === 'npc');
    this._mentorLine = mentor?.description || null;
    this._levelAtChapterStart = 1;
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
      skills: { insight: 0, resolve: 0, momentum: 0 },
      experience: {
        title: this.meta.title || this.campaign.title,
        template: 'quest-rpg-progression',
        roomCount: this.campaign.chapters.length,
      },
    });

    this._snapshot = JSON.parse(JSON.stringify(ctx.state.get()));
    this._showBoot();
    return this;
  }

  _showBoot() {
    const ctx = this.runtime.services;
    const briefing = [this.meta.briefing, this._mentorLine].filter(Boolean).join(' ')
      || 'Take the questline, log every fact in the region, and face what stands in the way.';

    ctx.scenes.replace(
      new BootScene(ctx, {
        title: this.meta.title || this.campaign.title,
        subtitle: this.meta.subtitle || 'Quest RPG · Progression',
        briefing,
        chapterCount: this.campaign.chapters.length,
        skillBranches: this.campaign.skillBranches,
        onStart: () => this._enterChapter(0),
      }),
    );
  }

  _enterChapter(index) {
    const ctx = this.runtime.services;
    const chapter = this.campaign.chapters[index];
    if (!chapter) return this._showCompletion(true);

    this._levelAtChapterStart = ctx.state.get('level');

    const scene = new RegionScene(ctx, {
      chapter,
      chapterIndex: index,
      chapterCount: this.campaign.chapters.length,
      // Distractors are drawn from the whole campaign, so recall checks stay
      // on-topic no matter which chapter the encounter happens in.
      quiz: (enemySpec) => buildEncounterQuiz(enemySpec, this.mapping.specs, { choices: 3 }),
      onChapterClear: () => this._afterChapter(index),
      onFail: () => this._showCompletion(false),
      onBriefing: (giverSpec, done) => {
        ctx.scenes.push(
          new BriefingScene(ctx, {
            giver: giverSpec,
            chapter,
            onClose: () => {
              ctx.scenes.pop();
              done?.();
            },
          }),
        );
      },
      onEncounter: (enemy, quiz, done) => {
        ctx.scenes.push(
          new EncounterScene(ctx, {
            enemy,
            quiz,
            insight: ctx.state.get('skills')?.insight || 0,
            onResolve: (result) => {
              ctx.scenes.pop();
              done?.(result);
            },
          }),
        );
      },
    });

    this._region = scene;
    ctx.scenes.replace(scene);
  }

  /** Between chapters: cash any levels gained into skill points, then continue. */
  _afterChapter(index) {
    const ctx = this.runtime.services;
    const gained = ctx.state.get('level') - this._levelAtChapterStart;
    const next = () => this._enterChapter(index + 1);

    if (gained > 0) {
      ctx.scenes.replace(
        new SkillScene(ctx, {
          points: gained,
          branches: this.campaign.skillBranches,
          onDone: next,
        }),
      );
    } else {
      next();
    }
  }

  _showCompletion(win) {
    const ctx = this.runtime.services;
    ctx.state.setFlag('experienceComplete', true); // ends the signal session + notifies the embedding page
    const factCount = this.campaign.chapters.reduce((n, c) => n + c.objectives.length, 0);
    const enemyCount = this.campaign.chapters.reduce((n, c) => n + c.enemies.length, 0);
    ctx.scenes.replace(
      new CompletionScene(ctx, {
        win,
        chapterCount: this.campaign.chapters.length,
        factCount,
        enemyCount,
        onReplay: () => this._replay(),
      }),
    );
  }

  _replay() {
    const ctx = this.runtime.services;
    ctx.state.set(JSON.parse(JSON.stringify(this._snapshot)));
    ctx.quests = new QuestEngine(ctx.state, ctx.audio);
    this._enterChapter(0);
  }
}

/** Convenience factory used by the loader. */
export function createQuestRpgRuntime(manifest, meta) {
  return new QuestRpgTemplateRuntime(manifest, meta);
}