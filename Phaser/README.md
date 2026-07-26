# Gameplay DSL — engine-agnostic runtime + two adapters

Reference implementation of the "gameplay logic layer" from `Working.md`: a
deterministic runtime that turns pure JSON content into a playable game, with
no gameplay logic in any engine.

The directory is still named `Phaser/` for history; it now hosts both adapters.

- `dsl/types.ts` — the gameplay DSL (entities, components, events, conditions,
  actions, triggers, state machines)
- `runtime/RuntimeCore.ts` — engine-agnostic interpreter: event bus, rule
  engine (triggers), state machine runner, variable resolution, and a
  `subscribe()` observation hook
- `runtime/EngineAdapter.ts` — the contract every engine adapter implements
- `runtime/GameplayBundle.ts` — one playable experience as data, plus the
  `?bundle=` loader and the placeholder-art derivation both hosts share
- `runtime/SignalBridge.ts` — the return edge: batches runtime observations
  and POSTs them to `/v1/persons/:id/signals`, the same batch shape
  `browser-engine/runtime/SignalEmitter.js` uses
- `adapters/PhaserAdapter.ts` — Phaser 3 (arcade physics)
- `adapters/PixiAdapter.ts` — Pixi 8 rendering with its own AABB solver and
  keyboard reader; shares no engine code with the Phaser path
- `../game/` — the hand-authored SkyRun bundle (game, scenes, entities, state
  machines, triggers) plus JSON Schemas. **No gameplay code lives here — only data.**

## Run

```bash
cd Phaser
npm install
npm run dev     # open the printed URL
```

`/index.html` is the Phaser adapter, `/pixi.html` is the Pixi adapter. Both
pages link to each other and print what they are running in the status line.

Controls: A/D or arrows to move, Space/W/Up to jump. Reach the green flag.

## Playing a compiled experience

Both hosts play the static SkyRun content by default, and any compiled bundle
when given one:

```
/index.html?bundle=/sample-bundle.json
/pixi.html?bundle=/sample-bundle.json
```

`public/sample-bundle.json` is a bundle emitted by the API's
`GameplayDslService` — the same output `POST /v1/compiler/gameplay-dsl`
returns. Against a running gateway, point at the served copy instead:

```
/pixi.html?bundle=http://localhost:4000/v1/compiler/gameplay-dsl/<bundleId>
```

A failed fetch never blanks the page: it falls back to SkyRun and says so in
the status line.

## Sending signals back

Add `?personId=<id>` (optionally `&apiBase=http://localhost:4000`) and the
SignalBridge attaches, posting scene enters, collisions, state changes and
session end into the Person Node loop. No `personId`, no telemetry.

## Placeholder art

There are no binary assets. Each host derives one flat-colour texture per
sprite id the bundle references — including `PlayAnimation` targets — from
`spriteSpecs()`, so a freshly compiled bundle is playable the moment it is
emitted. DSL units are meters (y-up); colliders are **base units, before the
entity's transform scale**, and each adapter converts via `pixelPerUnit`.

## Tests

```bash
npm run typecheck
npm test        # RuntimeCore + bundle integrity, no renderer involved
```

`tests/runtime.test.ts` drives the core through a recording stub adapter
against both bundles: scene entry, item collection (including the `bindingId`
that keeps content joinable), scene advance, grounded-only jumping, variable
resolution, and art coverage.

## Adding another engine

Implement `EngineAdapter` for the target engine (Unity, Unreal, …) and feed it
the same bundle. `RuntimeCore`, the content, and the compiler need no changes —
that is the point of the layer, and `PixiAdapter` is the proof.
