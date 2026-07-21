# Blender Template

A headless scene-export scaffold the build worker generates from a compiled
experience. The worker copies this folder to `<workspace>/project`, injects the
game spec at `experience.json`, then runs Blender headless over
`optomole_export.py`.

## How it works

`optomole_export.py` reads the injected spec and builds a scene with one object
per compiled entity on the grid the spec defines (hazards red cones, others cyan
cubes), then exports a glTF binary (`experience.glb`) a web viewer or engine can
load.

Invoked as:

```
blender --background --python optomole_export.py -- <experience.json> <experience.glb>
```

## Requirements

- `BLENDER_PATH` set to a Blender executable (3.x+ with the glTF exporter, which
  ships by default).
- No Blender installed: the worker simulates the export but still writes this
  generated project (see `archive/project-source/` in the artifact).
