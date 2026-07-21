# Optimole API Gateway

Standalone NestJS gateway for the Optimole Experience Fabric.

## Role

```text
Internet
  -> Cloudflare / Load Balancer
  -> Optimole API Gateway
  -> AI Generation Cluster
  -> Build Queue Cluster
  -> Redis / RabbitMQ
  -> Unreal / Unity / Godot Workers
  -> Object Storage
  -> CDN / Playable Launch URL
```

The gateway is responsible for:

- Accepting customer content and generation requests
- Calling the AI generation cluster or legacy local Optomole API during migration
- Creating build jobs
- Resolving genre templates and semantic mapping manifests
- Publishing engine build commands to Redis, RabbitMQ, or local memory
- Receiving worker callbacks
- Recording artifacts
- Returning launchable playable URLs to the Optomole app

The customer-facing result is a playable session, not a folder or manual export.

## API Shape

- `GET /v1/health`
- `POST /v1/experiences/compile`
- `POST /v1/experiences/launch`
- `POST /v1/gdp/create`
- `POST /v1/gdp/manifest`
- `POST /v1/irx/normalize`
- `POST /v1/compiler/experience-manifest`
- `POST /v1/transcription/audio`
- `POST /v1/builds`
- `GET /v1/builds`
- `GET /v1/builds/:id`
- `GET /v1/templates`
- `GET /v1/templates/:id`
- `POST /v1/templates/register`
- `POST /v1/templates/resolve`
- `GET /v1/templates/:id/compatibility?target=unreal`
- `POST /v1/templates/:id/validate-package`
- `POST /v1/workers/:engine/callback`
- `GET /v1/artifacts`
- `GET /v1/artifacts/:id`
- `GET /v1/objects/:key`
- `GET /docs`

## Local Start

```bash
cd api
npm install
npm run start:dev
```

Copy `.env.example` to `.env` or set env vars through your deployment platform.

## Audio Transcription

Audio uploads are transcribed by the API before they enter the IRX compiler path.
Provider order:

1. `whisper-1` through OpenAI audio transcriptions.
2. Azure Speech REST, when `AZURE_SPEECH_KEY` plus `AZURE_SPEECH_REGION` or `AZURE_SPEECH_ENDPOINT` are configured.
3. OpenAI transcription fallback model, defaulting to `gpt-4o-mini-transcribe`.

Required environment variables:

```bash
OPENAI_API_KEY=...
WHISPER_MODEL=whisper-1
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_LANGUAGE=en-US
```

## AI Experience Compiler

The gateway can compile IRX-backed ingested content into `ExperienceManifest.json`
with user-provided provider keys. Keys are sent per request and are not persisted.

Supported request providers:

- `openai`
- `claude`
- `gemini`

The compiler prompt loads these repository references:

- `Optomole.md`
- `ExperienceCompiler.md`
- `spec-engine/schemas/experience-manifest.schema.json`
- `optomoleIRX.md`

The output is parsed as JSON, normalized into an `ExperienceManifest`, and then
adapted into the existing `ExperiencePackage` used by browser, Unity, and Unreal
build flows.

## Docker

```bash
docker build -t optimole-api-gateway .
docker run --env-file .env -p 8080:8080 optimole-api-gateway
```

For a local infrastructure-shaped stack:

```bash
docker compose -f docker/compose.dev.yml up --build
```

The compose stack starts the gateway, RabbitMQ, Redis, and MinIO. The gateway uses in-memory object storage by default for local browser launch. Unreal/Unity workers should upload compiled builds to MinIO/S3/CDN and report `launchUrl`, `artifactUrl`, and `storageKey` in their callback.

## Request Example

```bash
curl -X POST http://localhost:8080/v1/experiences/launch \
  -H "Content-Type: application/json" \
  -d '{
    "target": "browser",
    "source": {
      "sourceType": "course",
      "title": "AWS Fundamentals",
      "text": "IAM, VPCs, encryption, and monitoring become mission objectives."
    },
    "options": {
      "genre": "mission-rpg",
      "worldTitle": "Cloud District"
    }
  }'
```

Response:

```json
{
  "ok": true,
  "playable": {
    "url": "http://localhost:8080/v1/objects/exp-cloud-district/build_x/index.html",
    "jobId": "build_...",
    "target": "browser"
  }
}
```

## Unreal Worker Contract

The gateway publishes this command to the build queue:

```json
{
  "jobId": "build_...",
  "target": "unreal",
  "experienceId": "exp_...",
  "package": {},
  "template": {},
  "mappingManifest": {},
  "callbackUrl": "https://gateway.example.com/v1/workers/unreal/callback",
  "requestedAt": "2026-07-18T00:00:00.000Z"
}
```

The Unreal worker:

1. Pulls the build command from Redis/RabbitMQ.
2. Selects the engine skeleton from `template.engineSkeletons.unreal`.
3. Imports `mappingManifest.bindings` into Unreal Primary Data Assets / Blueprint-readable data.
4. Populates asset slots, room/entity/objective bindings, and runtime rules.
5. Cooks/packages/deploys the playable build.
6. Uploads build output to S3/MinIO.
7. Calls back:

```bash
curl -X POST https://gateway.example.com/v1/workers/unreal/callback \
  -H "Authorization: Bearer $WORKER_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "build_...",
    "status": "succeeded",
    "workerId": "unreal-worker-1",
    "launchUrl": "https://play.optimole.com/session/abc",
    "artifactUrl": "https://cdn.optimole.com/builds/abc.zip",
    "storageKey": "builds/abc.zip"
  }'
```

## Deployment Notes

For production:

- Set `BUILD_QUEUE_MODE=rabbitmq` or `BUILD_QUEUE_MODE=redis`.
- Put Cloudflare or a load balancer in front of the gateway.
- Mount the root `templates/` catalog and set `TEMPLATE_REGISTRY_PATH`.
- Use a real object storage adapter for S3/MinIO in `ObjectStorageService`.
- Put Unreal/Unity workers on isolated build nodes with engine licenses and cached templates.
- Treat `/v1/experiences/launch` as the customer path.
- Keep downloadable artifacts behind authenticated developer or enterprise routes.
