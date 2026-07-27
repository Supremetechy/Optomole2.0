# The Gameplay Compiler

> **STATUS: IMPLEMENTED — this document is retired as a spec.**
>
> Everything below is built, wired and tested (`api/test/content-pipeline.test.js`,
> `Phaser/tests/`). It is kept as *design rationale* — why the numbers are shaped
> the way they are, and which playtest failures produced each invariant — not as
> work to be done. **The code is the specification now.** If this file and the
> code ever disagree, the code is right and this file is stale.
>
> Retired 2026-07-26. Start from `api/src/compiler/` and `Phaser/runtime/`.

This describes what the compiler **does**, not what it was once sketched to do.
Where the original sketch and the implementation disagreed, the implementation
won and the reason is recorded here.

The engine reads content, infers the intended experience, and generates
gameplay behaviors, state machines, and level flow. It is a compiler, not a
content loader: the same source always produces the same experience, a different
source produces a different one, and every number is traceable back to the
sentence that caused it.

```
Stage 0/1  SemanticModelService        package + preprocessing -> ContentNode[] / SemanticNode[]
Stage 2    ExperienceDirectiveService  SemanticNode[] (+ author tags) -> ExperienceDirective[]
Stage 3    BehaviorCompilerService     ExperienceDirective[] -> state machines / directors / sequences
Stage 4    GameplayDslService          behaviors + content -> GameplayDslBundle
Stage 5    RuntimeCore + EngineAdapter the bundle is played
```

Entry points: `POST /v1/compiler/gameplay-dsl` (full chain, returns the bundle)
and `POST /v1/compiler/directives` (stages 0–3 only, for inspecting what the
compiler understood). The same chain runs inside `BuildsService`.

---

## 1. Where an experience comes from

The original sketch mapped a fixed tag vocabulary to directives:
`mapTagsToMovementExperience(["floaty", "verticality"])`. That was replaced,
because it answers the wrong question first — it assumes an author has already
described the experience, when the entire premise is that the **content**
describes it.

So Stage 2 derives from semantics, and tags **bend** the result:

| Source | Drives |
|---|---|
| mood pressure (emotional arc) | movement feel, pacing curve, beat stretch |
| actor threat / hazard severity | enemy aggression, health, reaction time |
| location enclosure | region layout, verticality, prop vocabulary |
| relationships marked *gating* | which narrative beats cannot be skipped |
| **author tags** | explicit overrides, applied on top |

Every directive carries `derivedFrom` — the SemanticNode ids behind it — so any
number can be traced back through Stage 1 to the source. A tag does not erase
that: it modifies the value and records itself in `appliedTags`.

### Author tags

Tags may be set on `package.experience.tags`, `package.tags`,
`package.blueprint.tags`, or in an uploaded file's own metadata (`hints.tags`).
They are normalized (lower-cased, spaces and hyphens to underscores).

| Tag | Effect |
|---|---|
| `floaty` | higher apex, more air control, longer coyote time |
| `verticality` | higher apex, more rise, more platforms |
| `low_gravity` | the world's gravity itself is reduced |
| `exploration` | slower movement, more platforms, tighter gaps |
| `pressure` / `aggressive` / `zoning` | forces every enemy into that family |

A tag the compiler does not recognize is reported in
`directiveSet.tags.unrecognized` rather than silently ignored.

**Invariant — jump is authored as a HEIGHT.** `jumpApexHeight` is the authored
quantity; `jumpForce` is derived from it through the world's gravity
(`sqrt(2·g·h)`), and `game.config.gravity` in the emitted bundle is that same
gravity. A tuned impulse of ~12 reads fine on paper and puts the player 8m up: in
a real playtest they sailed over every collectible and the exit flag. If you
change gravity, the impulse must be recomputed, or every authored height is wrong.

---

## 2. The three enemy families

A family selects the **shape** of the behavior tree; the numbers already resolved
from content fill it in. The family is chosen from range preference and
aggression, and can be forced by tag.

### pressure — closes and stays closed

```
Idle → Alert → Approaching → Telegraphing → Attacking → Approaching
                    ↓ (squad denies)
                 Holding → Telegraphing
```

### aggression — bursts in, and pays for it

Same shape, plus a `Recovering` state after every attack: a window where it is
doing nothing and can be punished. Without that, "commits harder" would only
mean "hits more often", which is not a different feel — just a worse one.

### zoning — holds a band and shoots

```
Idle → Alert → MaintainDistance → Telegraphing → Attacking → MaintainDistance
                       ↓ (squad denies)
                    Holding → Telegraphing
```

`MaintainDistance` runs `ApplyStandoffMovement` (back off inside the band, close
outside it, hold within it) and never charges. `Attacking` runs `FireProjectile`
instead of `ApplyAttack`.

**Invariant — a shot resolves on arrival.** Flight time is derived from the gap
the enemy actually fired across and its compiled `projectileSpeed`. A target that
moved, died, or despawned mid-flight takes nothing. That is what makes the
distance a zoning enemy fights to keep worth something to the player too.

**Invariant — reach matches commit range.** An enemy that telegraphs from 6m and
strikes with a melee-sized default reach attacks empty air forever. This
happened; the compiled `range` now always covers the range it commits at.

### Above the family: the squad

`groupPressure` is deliberately *not* consumed by an enemy's own tree. The squad
coordinator owns it, arbitrates who may commit, and broadcasts an
`effectiveAggression` override down. Each enemy only ever learns granted/denied.
An unsquadded enemy is granted by default, so a lone enemy never deadlocks.

---

## 3. Level pacing: curves and beats

Pacing has two halves, and they are compiled from one plan so they cannot drift.

**The curve** is continuous — `steady`, `escalating`, `pulse`, `release` — chosen
from where the region sits in the emotional arc. The runtime samples it and hands
the adapter a scalar; the adapter never learns what "escalating" means.

**The beats** are discrete: `calm | build | peak | release`, each with a
`duration`, an `enemyDensity`, and a `traversalComplexity`. The beat sequence is
read off the curve shape, and pressure sharpens it — a tense region's peaks run
longer and its lulls shorter, but a calm beat is still a calm beat.

| Beat | Geometry (compile time) | Population (runtime) |
|---|---|---|
| calm | wide ledges, short gaps, flat | near-empty |
| build | staggered, longer gaps | filling |
| peak | narrow ledges, long gaps, climbing | crowded |
| release | wide and flat again | near-empty |

`traversalComplexity` is spent **at compile time** by the environment compiler:
the platform run is divided across the region's beats in order, so a player
crossing the region crosses calm ground, then staggered gaps, then the climb.
`enemyDensity` is spent **at runtime** by the pacing director.

### What the runtime actually does with it

- `EvaluateSpawnBudget` — accrues the curve-scaled rate into whole spawns and
  tops the region back up to the active beat's density. Reinforcements are
  **cloned** from enemies the region already declared, so they keep their
  compiled behavior tree, squad tag, sprite and health.
- `TriggerBreather` — suspends accrual and zeroes banked budget, so a rest is
  not paid back as a wave the moment it ends.
- `SetMusicIntensity` — drives `MusicBus`, a synthesized three-layer drone whose
  gain, filter and dissonance follow the region's loudness. It synthesizes
  rather than plays stems because a compiled experience ships no audio assets,
  and a bed built from the intensity itself cannot drift out of sync with it.
  With no WebAudio available it is silent, never broken.

The core resolves both scalars (`resolvedRate`, `resolvedIntensity`) by folding
the curve into the compiled value, so an adapter turns a knob and never learns
what "escalating" means.

**Invariant — the cap counts the living, not the spawned.** A player who clears a
region faster than the budget accrues earns quiet; one who leaves it standing
never faces more at once than the beat allows.

**Invariant — a reinforcement must be targetable.** A scene's entity list is
compiled and fixed. A spawned enemy missing from the runtime's target resolution
is an unhittable ghost that damages a player who cannot answer it.

---

## 4. What the adapter is allowed to do

Nothing that decides anything. Targeting, timers, damage, death, squad
arbitration, curve sampling, beat advance, spawn budgets and projectile flight
are all core-owned. The adapter receives resolved actions — `ApplyImpulse`,
`PlayAnimation`, `MoveTo`, `FireProjectile`, `LoadScene` — and renders them.

`targetTag` is resolved to a concrete `targetEntityId` before an adapter sees it,
which is what lets one compiled combat tree run in Pixi and Phaser alike without
either knowing what "the player" means.

---

## 5. Drops are visible

Every stage reports what it produced and what it dropped:
`pipelineValidation` carries `semanticModel.coverage`, `directives.coverage`,
`directives.tags`, `behaviors.validation` and `bundle.validation`. A region that
produced no gameplay, a hazard nothing was built from, or a tag nobody
recognized is recorded — never silent.

---

## 6. Risks: bodies and terrain

Not every risk a source names is something to punch. Normalization already draws
the line, and Stage 2 reads it:

| Atom type | Interaction | Becomes |
|---|---|---|
| `challenge` | resolve | an **enemy** — confronted, with a behavior tree and a squad |
| `branch` | choose | a **hazard zone** — terrain, routed around, never cleared |

The partition is global and exclusive: **no risk is ever both.** Before it,
every risk in a source arrived as an identical monster and `hazardBudget`,
`hazardNodeIds` and the whole environmental-danger path were dead parameters.

A region places its own hazards, capped by the `hazardBudget` its layout was
sized for, positioned on beats whose `traversalComplexity` is high — danger on a
calm stretch is an unfair surprise, danger on a peak *is* the peak. Contact costs
health on a cooldown (without one, standing in a hazard drains the player in a
single frame) and the hazard stays: it is terrain, not an encounter.

Collectibles follow the same ownership rule. A region's own `itemNodeIds` are
placed **in that region** — the compiler already worked out which location each
collectible belongs to, and the old round-robin threw that away. Anything the
plans do not claim still falls back to the even spread, so nothing is dropped.
