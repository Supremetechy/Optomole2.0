# Unity Template — Action Adventure: Key & Lock

A real, playable Unity game the build worker generates from a compiled
experience — the Unity counterpart of the Unreal key & lock template. The
compiled content becomes a walled **room graph** you explore top-down: collect a
room's keys to open its gate, avoid the hazards, and clear the final room to win.

The worker copies this folder to `<workspace>/project`, injects the game spec at
`Assets/StreamingAssets/experience.json`, then runs the Unity Editor headless to
build a standalone player.

## Gameplay

`Assets/Scripts/OptomoleAdventure.cs` reads the spec, chunks entities into rooms
(6 per room), and builds the level in code at runtime:

- **Keys** (gold cubes) — collect a room's keys to open its gate.
- **Gate** (amber slab) — blocks the exit until the keys are collected.
- **Hazards** (red spheres) — proximity drains Focus; at zero the run fails.
- **Objectives** (grey markers) — inert content the room reflects.
- **HUD** (`OnGUI`) — title, room `X/N`, keys `a/b`, Focus, XP, win/lose banner.
- **Controls** — WASD / arrows (`CharacterController`, top-down follow camera).

Entity types are read via the generator's canonical `role` field, so any genre's
mapping (key-item / loot → key, enemy / hazard → hazard, lock / region-gate →
gate) plays correctly.

`Assets/Editor/OptomoleBuild.cs` is the headless `-executeMethod` entry point; it
builds an empty scene holding `OptomoleAdventure` and calls `BuildPipeline.BuildPlayer`.

Invoked as:

```
Unity -batchmode -nographics -quit -projectPath <proj> \
  -executeMethod OptomoleBuild.PerformBuild \
  -buildTarget StandaloneOSX -optomoleOutput <dir> -logFile <log>
```

## Requirements

- `UNITY_PATH` set to a Unity executable (2022.3 LTS or newer). Platform via
  `UNITY_BUILD_TARGET` (`StandaloneOSX` | `StandaloneWindows64` | `StandaloneLinux64`).
- No Unity installed: the worker simulates the build but still writes this
  generated project (see `archive/project-source/` in the artifact).
