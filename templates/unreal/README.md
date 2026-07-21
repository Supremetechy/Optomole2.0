# Unreal Template — Action Adventure: Key & Lock

A real, playable UE5 **C++** game the build worker generates from a compiled
experience. It implements the `action-adventure-key-lock` genre: the compiled
content becomes a walled **room graph** you explore top-down — collect the keys
in each room to open its gate, avoid the hazards, and clear the final room to
win.

The worker copies this folder to `<workspace>/project`, injects the game spec at
`Content/Data/Experience.json`, then runs `RunUAT BuildCookRun` to cook + package.

## Gameplay

`OptomoleGameMode` reads the spec, chunks the entities into rooms (6 per room,
matching the browser runtime), and builds the level in code:

- **Keys** (gold cubes) — collect all of a room's keys to open its gate.
- **Gate** (amber slab) — blocks the exit until the room's keys are collected,
  then drops into the floor.
- **Hazards** (red spheres) — touching one drains Focus; at zero the run fails.
- **Objectives** (grey markers) — inert content the room still reflects.
- **HUD** — title, room `X / N`, keys `a / b`, Focus, XP, win/lose banner.
- **Controls** — WASD / arrows (top-down `OptomolePlayerPawn`).

Entity types are read via the generator's canonical `role` field, so any genre's
mapping (key-item / loot / evidence → key, enemy / hazard → hazard,
lock / region-gate → gate) plays correctly.

## Structure

| File | Role |
|------|------|
| `OptomoleGameMode` | Loads spec, builds the room graph, tracks progression/win/lose |
| `OptomoleTypes` | Spec parse + room chunking |
| `OptomolePlayerPawn` | Top-down movement + camera |
| `OptomoleKeyActor` / `OptomoleGateActor` / `OptomoleHazardActor` | Room entities |
| `OptomoleHUD` | Canvas HUD |
| `Config/DefaultEngine.ini` | Boots `/Engine/Maps/Entry`; GameMode builds the rest |
| `Config/DefaultInput.ini` | Legacy WASD axis mappings |
| `Config/DefaultGame.ini` | Stages `Content/Data` into the cook |

Because all gameplay is C++ (no binary `.uasset`), the project compiles during
`BuildCookRun` with no hand-authored editor assets.

## Requirements

- Windows builder with `UE_PATH` set to the UE 5.4 install root.
- Off-Windows / no UE: the worker simulates the cook but still writes this
  generated project (see `archive/project-source/` in the artifact).
