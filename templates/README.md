# Optimole Template Registry

This directory is the bridge between generated Experience Packages and concrete engine skeletons.

```text
Experience Package
  -> Semantic Mapping Manifest
  -> Template Registry
  -> Engine Skeleton
  -> Worker Build
  -> Playable Session
```

The registry is intentionally data-driven. Each template declares:

- supported engine targets
- runtime loop
- mechanics
- entity and interaction types
- asset slots
- data contract
- engine skeleton loaders
- semantic mapping rules

The API gateway reads `registry.json`, resolves a template for the requested target, and produces a mapping manifest that Unreal/Unity/browser workers can consume.
