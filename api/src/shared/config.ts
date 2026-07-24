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
}

function value(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function gatewayConfig(): GatewayConfig {
  const gatewayHttps = value('GATEWAY_HTTPS', 'false') === 'true';
  const localScheme = gatewayHttps ? 'https' : 'http';
  return {
    port: Number(value('PORT', '8080')),
    bodyLimit: value('API_BODY_LIMIT', '50mb'),
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
    localAiBaseUrl: value('LOCAL_AI_BASE_URL', 'http://localhost:11434/v1'),
    localAiModel: value('LOCAL_AI_MODEL', 'claude-sonnet-reasoning'),
    openaiApiKey: value('OPENAI_API_KEY', ''),
    whisperModel: value('WHISPER_MODEL', 'whisper-1'),
    openaiTranscribeModel: value('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
    azureSpeechKey: value('AZURE_SPEECH_KEY', ''),
    azureSpeechRegion: value('AZURE_SPEECH_REGION', ''),
    azureSpeechEndpoint: value('AZURE_SPEECH_ENDPOINT', ''),
    azureSpeechLanguage: value('AZURE_SPEECH_LANGUAGE', 'en-US'),
  };
}
