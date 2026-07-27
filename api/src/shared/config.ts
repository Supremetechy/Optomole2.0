export type QueueMode = 'memory' | 'rabbitmq' | 'redis';
export type ObjectStorageMode = 'memory' | 's3' | 'minio';

export interface GatewayConfig {
  port: number;
  bodyLimit: string;
  nodeEnv: string;
  corsOrigin: string;
  aiGenerationUrl: string;
  legacyOptomoleApiUrl: string;
  buildQueueMode: QueueMode;
  buildQueueName: string;
  redisUrl: string;
  rabbitmqUrl: string;
  publicGatewayUrl: string;
  cdnBaseUrl: string;
  objectStorageMode: ObjectStorageMode;
  workerCallbackToken: string;
  internalApiToken: string;
  adminApiToken: string;
  accountStorePath: string;
  gameReferenceStorePath: string;
  signalStorePath: string;
  experimentStorePath: string;
  personNodeModulePath: string;
  personNodeSchemaPath: string;
  templateRegistryPath: string;
  browserEnginePath: string;
  gameDuplicatorPath: string;
  browserEngineUrl: string;
  gatewayHttps: boolean;
  tlsCertPath: string;
  tlsKeyPath: string;
  localObjectStorePath: string;
  localAiBaseUrl: string;
  localAiModel: string;
  openaiApiKey: string;
  whisperModel: string;
  openaiTranscribeModel: string;
  azureSpeechKey: string;
  azureSpeechRegion: string;
  azureSpeechEndpoint: string;
  azureSpeechLanguage: string;
  // ---- asset generation providers (see api/src/assets) ----
  meshyApiKey: string;
  lumaApiKey: string;
  sketchfabApiToken: string;
  falApiKey: string;
  replicateApiKey: string;
  huggingfaceApiKey: string;
  openaiSpeechModel: string;
  openaiCodeModel: string;
  falModels: string;
  replicateModels: string;
  huggingfaceModels: string;
  assetProviderOrder: string;
  assetGenerationEnabled: boolean;
  assetJobTimeoutMs: number;
}

function value(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function gatewayConfig(): GatewayConfig {
  const gatewayHttps = value('GATEWAY_HTTPS', 'false') === 'true';
  const localScheme = gatewayHttps ? 'https' : 'http';
  return {
    port: Number(value('PORT', '8080')),
    // Safety net for large ingests (multi-file uploads, base64 audio for
    // transcription). The compiler now normalizes IRX server-side, so normal
    // compile/launch bodies are small; this headroom only matters for raw
    // source/asset uploads. Override with API_BODY_LIMIT if needed.
    bodyLimit: value('API_BODY_LIMIT', '200mb'),
    nodeEnv: value('NODE_ENV', 'development'),
    corsOrigin: value('CORS_ORIGIN', '*'),
    aiGenerationUrl: value('AI_GENERATION_URL', 'http://ai-generation:8081'),
    legacyOptomoleApiUrl: value('LEGACY_OPTOMOLE_API_URL', ''),
    buildQueueMode: value('BUILD_QUEUE_MODE', 'memory') as QueueMode,
    buildQueueName: value('BUILD_QUEUE_NAME', 'optimole.build.jobs'),
    redisUrl: value('REDIS_URL', 'redis://redis:6379'),
    rabbitmqUrl: value('RABBITMQ_URL', 'amqp://rabbitmq:5672'),
    publicGatewayUrl: value('PUBLIC_GATEWAY_URL', `${localScheme}://localhost:8080`),
    cdnBaseUrl: value('CDN_BASE_URL', `${localScheme}://localhost:8080`),
    objectStorageMode: value('OBJECT_STORAGE_MODE', 'memory') as ObjectStorageMode,
    workerCallbackToken: value('WORKER_CALLBACK_TOKEN', 'dev-worker-token'),
    internalApiToken: value('INTERNAL_API_TOKEN', 'dev-internal-token'),
    // Admin console backend access. The AdminConsole sends this as `x-admin-token`
    // (or `Authorization: Bearer …`) to reach the account-management endpoints.
    adminApiToken: value('ADMIN_API_TOKEN', 'dev-admin-token'),
    accountStorePath: value('ACCOUNT_STORE_PATH', '../.optomole-data/accounts'),
    // Imported GameDuplicator user games, persisted one JSON per game so the
    // "model off a favorite" catalog survives gateway restarts.
    gameReferenceStorePath: value('GAME_REFERENCE_STORE_PATH', '../.optomole-data/game-references'),
    // Player-interaction signals emitted by the playable runtime (the return edge
    // of the Person → Data → KG → World → Experience loop). One JSON log per
    // person, mirroring accountStorePath. The World Model / Reflection layers
    // (steps #3-#6) read this accumulating stream.
    signalStorePath: value('SIGNAL_STORE_PATH', '../.optomole-data/signals'),
    // Experiment ledger (loop #5): each World-Model-directed experience records the
    // hypothesis it was built to test, so Reflection (#6) can later score it against
    // the signals that experience produced.
    experimentStorePath: value('EXPERIMENT_STORE_PATH', '../.optomole-data/experiments'),
    // The shared, framework-free Person Node contract both AdminConsole and the
    // api import. Resolved from the api's cwd, like templateRegistryPath.
    personNodeModulePath: value('PERSON_NODE_MODULE_PATH', '../shared/person-node/person-node.mjs'),
    personNodeSchemaPath: value('PERSON_NODE_SCHEMA_PATH', '../shared/person-node/person-node.schema.json'),
    templateRegistryPath: value('TEMPLATE_REGISTRY_PATH', '../templates/registry.json'),
    browserEnginePath: value('BROWSER_ENGINE_PATH', '../browser-engine'),
    // GameDuplicator (root-level app) served at /v1/gameduplicator for standalone
    // / prod, so it can share the gateway origin when the console is gateway-hosted.
    gameDuplicatorPath: value('GAME_DUPLICATOR_PATH', '../GameDuplicator'),
    // Base URL where the playable browser-engine is actually served. Set this
    // when the engine runs standalone (e.g. `serve.py` at https://localhost:8777)
    // instead of being served by the gateway at /v1/browser-engine. Empty =
    // legacy gateway-served engine.
    browserEngineUrl: value('BROWSER_ENGINE_URL', ''),
    gatewayHttps,
    tlsCertPath: value('TLS_CERT_PATH', '../browser-engine/.certs/localhost.pem'),
    tlsKeyPath: value('TLS_KEY_PATH', '../browser-engine/.certs/localhost-key.pem'),
    localObjectStorePath: value('LOCAL_OBJECT_STORE_PATH', '../.optomole-data/objects'),
    // Local, offline LLM used by the compiler's `local` provider. Points at an
    // OpenAI-compatible endpoint (Ollama at :11434/v1, or LM Studio) so the
    // gateway never loads the GGUF in-process. LOCAL_AI_MODEL is the tag the
    // runtime exposes (e.g. the Ollama model created from the One Touch GGUF).
    // The default is a tag Ollama can actually serve; set LOCAL_AI_MODEL to
    // whatever `ollama list` shows on this machine.
    localAiBaseUrl: value('LOCAL_AI_BASE_URL', 'http://localhost:11434/v1'),
    localAiModel: value('LOCAL_AI_MODEL', 'llama3.2'),
    openaiApiKey: value('OPENAI_API_KEY', ''),
    whisperModel: value('WHISPER_MODEL', 'whisper-1'),
    openaiTranscribeModel: value('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
    azureSpeechKey: value('AZURE_SPEECH_KEY', ''),
    azureSpeechRegion: value('AZURE_SPEECH_REGION', ''),
    azureSpeechEndpoint: value('AZURE_SPEECH_ENDPOINT', ''),
    azureSpeechLanguage: value('AZURE_SPEECH_LANGUAGE', 'en-US'),
    // Asset providers. Every one is optional: with no keys the pipeline still
    // builds, falling back to the procedural placeholder art it has always
    // emitted. See AssetProviderRegistry for how routing degrades.
    meshyApiKey: value('MESHY_API_KEY', ''),
    lumaApiKey: value('LUMA_API_KEY', ''),
    sketchfabApiToken: value('SKETCHFAB_API_TOKEN', ''),
    falApiKey: value('FAL_KEY', ''),
    replicateApiKey: value('REPLICATE_API_TOKEN', ''),
    huggingfaceApiKey: value('HF_TOKEN', '') || value('HUGGINGFACE_API_KEY', ''),
    openaiSpeechModel: value('OPENAI_SPEECH_MODEL', 'gpt-4o-mini-tts'),
    openaiCodeModel: value('OPENAI_CODE_MODEL', 'gpt-4.1-mini'),
    // "sprite=owner/model,music=owner/other"
    falModels: value('FAL_MODELS', ''),
    replicateModels: value('REPLICATE_MODELS', ''),
    huggingfaceModels: value('HUGGINGFACE_MODELS', ''),
    // "sprite:fal,replicate;model3d:sketchfab"
    assetProviderOrder: value('ASSET_PROVIDER_ORDER', ''),
    // Generation costs money per call, so it is opt-in even when keys exist.
    assetGenerationEnabled: value('ASSET_GENERATION_ENABLED', 'false') === 'true',
    assetJobTimeoutMs: Number(value('ASSET_JOB_TIMEOUT_MS', '120000')),
  };
}
