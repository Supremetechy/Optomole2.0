# Optomole Browser Engine

The **playable runtime layer** — the piece that turns a compiled Game Design
Package / Semantic Mapping Manifest into an actual game you can move around in,
not just a quest UI you click through.

```
Content → AI Compiler (Optomole) → Semantic Mapping Manifest → Browser Engine → Playable Game
```

Rendering is **PixiJS v8**, physics/collision is **Matter.js**, audio is
**Howler** (with a Web-Audio procedural fallback so no sound files are required).
All three load as UMD globals from CDN in `index.html`.

## Run it

Served by the backend (see repo `start.sh`) or any static host:

```
GET /browser-engine/                              → sample game (loads sample-manifest.json)
GET /browser-engine/?manifest=<url>               → play any Semantic Mapping Manifest
GET /browser-engine/?manifest=./sample-arcade-manifest.json   → arcade sample
GET /browser-engine/?manifest=./sample-idle-manifest.json     → idle sample
GET /browser-engine/?manifest=./sample-board-manifest.json    → board sample
GET /browser-engine/?template=<id>                → force a genre (overrides manifest.templateId)
```

`boot.js` picks the genre runtime from the manifest's `templateId` via a small
template registry (add a genre in one line). Controls: **WASD / arrow keys** to
move, **E / Space** to interact / roll (touch: drag-to-move joystick + INTERACT
button, or the on-screen buttons for menu-driven genres).

Four genres ship today:

- **`action-adventure-key-lock`** — a two-room warehouse forklift-safety course:
  talk to leads, collect evidence, dodge hazards, unlock each gate.
- **`arcade-collect-avoid`** — a wave-based concept arena (sample: *Phishing
  Defense Arcade*): grab the correct concepts, dodge the red decoys, grab
  power-ups, and clear every wave before the timer runs out.
- **`idle-progress`** — an incremental mastery lab (sample: *Data Literacy Lab*):
  study to earn Insight, invest it in each concept to auto-produce more, buy
  upgrades, and compound to every milestone. A crisp DOM surface over an ambient
  PixiJS backdrop; no avatar or physics.
- **`board-resource-sim`** — a turn-based board (sample: *Onboarding Journey*):
  roll the die, hop around a ring of spaces, collect every concept square (on
  pass or landing), manage energy/coins, and weather hazard setbacks. Pixi board
  + token + die with a DOM roll control.

## Optional build: Phaser engine

The runtime above is the **PixiJS build** (default). There is now a second,
optional **Phaser build** — the same Semantic Mapping Manifest, played through a
[Phaser 4](https://phaser.io) `Phaser.Game` (WebGL renderer + arcade physics)
instead of Pixi + Matter. Select it per experience:

```
GET /browser-engine/?manifest=./sample-phaser-arcade-manifest.json   → Phaser build (manifest opts in)
GET /browser-engine/?manifest=<url>&engine=phaser                     → force the Phaser build for any manifest
```

A manifest opts in with a top-level `"engine": "phaser"`; the `?engine=phaser`
query param forces it for testing. Anything else uses the Pixi build. Dispatch
lives in `boot.js` (`selectEngine`) and lazy-imports the Phaser stack, so the
default Pixi path never loads Phaser (and vice-versa) — each build only fetches
its own renderer.

What the Phaser build **reuses unchanged** (all genre-agnostic, no renderer
dependency): the DOM `Hud`, the `StateStore`, `AudioManager` (WebAudio
procedural fallback), and the `MappingEngine` / `QuestEngine` / `RpgEngine`. What
it replaces: Phaser brings its own renderer, scene manager, input, and physics,
so `OptomoleRuntime` / `SceneManager` / `InputController` have Phaser-native
equivalents rather than being reused.

```
browser-engine/
  vendor/phaser.min.js          vendored Phaser 4 UMD build (lazy-loaded)
  runtime-phaser/
    PhaserRuntime.js            owns Phaser.Game + shared services (twin of OptomoleRuntime)
    boot-phaser.js              lazy-loads Phaser lib → PhaserRuntime + HUD → Phaser template
  templates-phaser/
    arcade-collect-avoid/       reference genre ported to Phaser
      template-runtime.js       Boot → Wave 1..N (in-place) → Result(win/lose) → replay
      waves.js                  pure classify/chunk logic (mirrors the Pixi entity-factory)
      scenes/  BootScene ArenaScene ResultScene
```

Adding a Phaser genre mirrors the Pixi flow: a `templates-phaser/<genre>/`
folder plus one line in the `PHASER_TEMPLATES` map in `boot-phaser.js`. Scenes
are exported as `make<Scene>(Phaser)` factories so nothing touches the `Phaser`
global at import time (it is injected just before the runtime boots).

## Architecture

```
browser-engine/
  index.html            CDN libs + boot
  boot.js               loads manifest → runtime (Pixi | Phaser) → template
  runtime/
    OptomoleRuntime.js  PixiJS app + frame loop + service wiring
    SceneManager.js     scene stack with fade transitions (boot/room/dialogue/reward)
    AssetLoader.js      procedural sprite pack (no PNGs needed) + slot resolution
    InputController.js  keyboard + touch joystick + tap-to-interact
    AudioManager.js     Howler + procedural cue synthesis
    StateStore.js       reactive store (xp, keys, focus, flags, objectives)
    Hud.js              DOM HUD bound to StateStore
  engines/
    MappingEngine.js    manifest bindings → entity specs → room graph  ← the bridge
    QuestEngine.js      objectives, success/fail, rewards
    DialogueEngine.js   branching dialogue trees (+ auto-synthesis)
    RpgEngine.js        xp / level / currency progression
  templates/
    action-adventure-key-lock/
      template-runtime.js   scene-flow orchestrator
      entity-factory.js     spec → prefab + room layout
      scenes/   BootScene RoomScene DialogueScene RewardScene
      prefabs/  Player NPC Collectible Hazard Door
    arcade-collect-avoid/
      template-runtime.js   Boot → Wave 1..N → Result(win/lose) → replay
      entity-factory.js     spec → good/bad/power orb + wave chunking
      scenes/   BootScene ArenaScene ResultScene
      prefabs/  Player Orb
    idle-progress/
      template-runtime.js   Boot → Lab (tick loop) → Completion → start over
      entity-factory.js     spec → generators + upgrades + milestones
      economy.js            pure incremental model (rate/cost/tick, no Pixi/DOM)
      scenes/   BootScene IdleScene CompletionScene
    board-resource-sim/
      template-runtime.js   Boot → Board (roll/move/resolve) → Completion → new board
      entity-factory.js     spec → ring of concept/event/hazard spaces + layout
      board.js              pure turn/resource model (roll, resolve, no Pixi/DOM)
      scenes/   BootScene BoardScene CompletionScene
      prefabs/  Token
```

### The mapping bridge (the core gap this closes)

`MappingEngine` consumes the manifest's `bindings[]` — each pairing a
`sourceElement` (a piece of the source content) with a `gameBinding`
(`gameEntityType`, `interactionType`, `reward`, `successConditions`,
`spawnRules`). It normalizes them into `EntitySpec`s and groups them into a room
graph. `entity-factory` then instantiates each spec as a live prefab with a
sprite, an (optional) Matter body, and interaction behavior:

```
binding → EntitySpec → createEntity() → sprite + body + behavior → gameplay
```

- `evidence`        → **key-item** (walk over to collect; unlocks the gate)
- `procedure-step`  → **quest-objective** (collect to complete the sequence)
- `hazard`          → **hazard** (avoid; contact drains focus)
- `npc-dialogue`    → **NPC** (interact to open branching dialogue)
- `decision-point`  → **lock / exit-gate** (unlock to advance)

Each room auto-derives a gate that requires the room's own key items.

## Extending to other genres

Add a folder under `templates/<genre>/` with its own `template-runtime.js`,
`entity-factory.js`, scenes, and prefabs. Reuse everything in `runtime/` and
`engines/` — the runtime core, mapping bridge, quest/dialogue/rpg engines, asset
pipeline, input, audio, and HUD are all genre-agnostic. Register the genre in the
`TEMPLATES` map in `boot.js` (keyed by `templateId` prefix); dispatch is automatic.

`arcade-collect-avoid` and `idle-progress` are the references for adding a genre.
Both reuse the same `StateStore` keys so the existing HUD renders them unchanged
(arcade: `xp`→score, `keys`→concepts, `focus`→integrity, room→wave; idle:
`xp`→lifetime Insight, `level`→milestone tier, `keys`→concepts unlocked) with
zero HUD edits. `idle-progress` also shows a genre doesn't need sprites or
physics — it renders its own DOM surface over the ambient canvas and tears it
down on scene exit. `board-resource-sim` shows the third interaction model —
turn-based dice/token movement — reusing the same services and HUD keys
(`xp`→Knowledge, `level`→lap, `keys`→concepts collected, `focus`→energy).

All four roadmap genres are implemented (`action-adventure-key-lock`,
`arcade-collect-avoid`, `idle-progress`, `board-resource-sim`). A new genre is a
`templates/<genre>/` folder plus one line in the `TEMPLATES` map.

## Debugging

`window.__optomole` exposes `{ runtime, template, services }` at runtime for
dev-tools inspection and automated testing (e.g. `window.__optomole.services.
scenes.current`).
