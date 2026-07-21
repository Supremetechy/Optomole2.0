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
  templateRegistryPath: string;
  browserEnginePath: string;
  browserEngineUrl: string;
  gatewayHttps: boolean;
  tlsCertPath: string;
  tlsKeyPath: string;
  localObjectStorePath: string;
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
    templateRegistryPath: value('TEMPLATE_REGISTRY_PATH', '../templates/registry.json'),
    browserEnginePath: value('BROWSER_ENGINE_PATH', '../browser-engine'),
    // Base URL where the playable browser-engine is actually served. Set this
    // when the engine runs standalone (e.g. `serve.py` at https://localhost:8777)
    // instead of being served by the gateway at /v1/browser-engine. Empty =
    // legacy gateway-served engine.
    browserEngineUrl: value('BROWSER_ENGINE_URL', ''),
    gatewayHttps,
    tlsCertPath: value('TLS_CERT_PATH', '../browser-engine/.certs/localhost.pem'),
    tlsKeyPath: value('TLS_KEY_PATH', '../browser-engine/.certs/localhost-key.pem'),
    localObjectStorePath: value('LOCAL_OBJECT_STORE_PATH', '../.optomole-data/objects'),
    openaiApiKey: value('OPENAI_API_KEY', ''),
    whisperModel: value('WHISPER_MODEL', 'whisper-1'),
    openaiTranscribeModel: value('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
    azureSpeechKey: value('AZURE_SPEECH_KEY', ''),
    azureSpeechRegion: value('AZURE_SPEECH_REGION', ''),
    azureSpeechEndpoint: value('AZURE_SPEECH_ENDPOINT', ''),
    azureSpeechLanguage: value('AZURE_SPEECH_LANGUAGE', 'en-US'),
  };
}
