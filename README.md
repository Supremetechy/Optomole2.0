# Optimole Repository Layout

Optimole is organized around the build flow for generated game projects:

```text
User
  -> NestJS API Gateway
  -> LLM-generated Game Specification JSON
  -> Save spec
  -> Publish build job to RabbitMQ
  -> Optimole Build Worker
  -> Validate spec, generate project, invoke Unreal/Unity tools
  -> Upload artifacts to S3/MinIO
  -> API updates job status
  -> Client downloads the build from CDN/Object Storage
```

## Canonical Folders

```text
api/          NestJS API Gateway
frontend/     User-facing build console
worker/       Build worker runtime and engine service adapters
browser-engine/ Full browser playable runtime served by the API
shared/       DTOs, types, and interfaces shared across services
spec-engine/  JSON schemas for generated game specifications
templates/    Browser, Unreal, and Unity project templates
docker/       Local infrastructure compose files
scripts/      Repository maintenance and workflow scripts
```

## Infrastructure Shape

```text
Internet
  -> Cloudflare / Load Balancer
  -> Optimole API Gateway (NestJS)
  -> AI Generation Cluster + Build Queue Cluster
  -> Redis / RabbitMQ
  -> Unreal / Unity Workers
  -> Object Storage (S3/MinIO)
  -> CDN Download Server
```

## Local Service Commands

For the full local beta stack:

```bash
scripts/start-optomole.sh --install
```

After dependencies are installed, use:

```bash
scripts/start-optomole.sh
```

This starts Docker infrastructure, the API gateway, build worker, and frontend.
Open `http://localhost:3000` to use Optomole.

```bash
cd frontend
npm install
npm run dev
```

```bash
cd api
npm install
npm run start:dev
```

```bash
cd worker
npm install
npm start
```

```bash
docker compose -f docker/compose.dev.yml up --build
```

 ## Developer Rule Of Thumb

  Use:

  templates/

  for compiler-facing metadata.

  Use:

  browser-engine/templates/

  for actual gameplay code.

  A complete new browser template needs both.

## Deprecated Material

Older frontend/runtime experiments, generated build outputs, logs, cache folders, legacy API code, and archived docs were moved into `OptoDeprecated/`. Nothing was deleted during the cleanup.

1. TemplatesService.buildMappingManifest (templates.service.ts:188) flattens everything into a list of bindings. Structure is destroyed here: quests become loose objective and evidence bindings.
 builds.service.completeBrowserBuild (builds.service.ts:252) bolts world layers on as ad-hoc top-level keys. The manifest has 26 top-level keys, and 8 of them (analystChallenge, knowledgeGraph, runtimeContract, semanticExtraction, gameplayNormalization, preprocessing, experienceOutputType, outputExperience) are read by zero lines of runtime code. Three of the layers you listed — quests, characters, achievements — never reach the manifest at all, and inventory doesn't exist anywhere in the pipeline
 3. worker/project-generator.extractGameSpec (project-generator.js:31) re-derives a completely separate GameSpec for Unity/Unreal/Blender, reading pkg.blueprint.* directly. It gets quests and characters that the browser never sees, but misses storyboard, knowledge graph, and the analyst challenge.
 Components carry data, not just paths. The browser gets them inline in one fetch; the native generator writes each one to disk as the engine's data file. Same document, two serializations.

Optomole as the content to experience engines core function is to
assemble various values produced from the data sources, into an assembled composed result.

For USD
 Objects
 Stage
 Prims
 Properties
 Metadata 

For USDZ
Composition Operators
Layering
Inheritance
Variant Sets
Referencing
