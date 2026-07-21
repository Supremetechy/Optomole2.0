import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { gatewayConfig } from '../shared/config';

export interface TranscribeAudioRequest {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  language?: string;
}

interface TranscriptionResult {
  provider: 'whisper' | 'azure-speech' | 'openai-transcribe';
  model?: string;
  text: string;
  raw?: unknown;
}

@Injectable()
export class TranscriptionService {
  async transcribeAudio(input: TranscribeAudioRequest) {
    if (!input?.fileName || !input.mimeType || !input.dataBase64) {
      throw new BadRequestException('fileName, mimeType, and dataBase64 are required.');
    }

    const audio = Buffer.from(input.dataBase64, 'base64');
    if (!audio.length) throw new BadRequestException('Audio payload is empty.');

    const attempts: string[] = [];
    const providers = [
      () => this.transcribeWithOpenAi(audio, input, 'whisper', gatewayConfig().whisperModel),
      () => this.transcribeWithAzureSpeech(audio, input),
      () => this.transcribeWithOpenAi(audio, input, 'openai-transcribe', gatewayConfig().openaiTranscribeModel),
    ];

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result?.text?.trim()) {
          return {
            ok: true,
            transcription: {
              ...result,
              text: result.text.trim(),
              fileName: input.fileName,
              mimeType: input.mimeType,
              transcribedAt: new Date().toISOString(),
            },
          };
        }
      } catch (error) {
        attempts.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new ServiceUnavailableException({
      message: 'No transcription provider completed successfully.',
      attempts,
    });
  }

  private async transcribeWithOpenAi(
    audio: Buffer,
    input: TranscribeAudioRequest,
    provider: 'whisper' | 'openai-transcribe',
    model: string,
  ): Promise<TranscriptionResult> {
    const config = gatewayConfig();
    if (!config.openaiApiKey) throw new Error(`${provider} skipped: OPENAI_API_KEY is not configured.`);
    if (!model) throw new Error(`${provider} skipped: transcription model is not configured.`);

    const form = new FormData();
    form.set('model', model);
    if (input.language) form.set('language', input.language);
    form.set('file', new Blob([this.toArrayBuffer(audio)], { type: input.mimeType }), input.fileName);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: form,
    });

    const data = await this.readResponse(response);
    if (!response.ok) throw new Error(`${provider} failed: ${this.errorMessage(data, response.status)}`);

    return {
      provider,
      model,
      text: typeof data === 'object' && data && 'text' in data ? String((data as { text: unknown }).text) : '',
      raw: data,
    };
  }

  private async transcribeWithAzureSpeech(audio: Buffer, input: TranscribeAudioRequest): Promise<TranscriptionResult> {
    const config = gatewayConfig();
    if (!config.azureSpeechKey) throw new Error('azure-speech skipped: AZURE_SPEECH_KEY is not configured.');
    const endpoint = config.azureSpeechEndpoint || (config.azureSpeechRegion
      ? `https://${config.azureSpeechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`
      : '');
    if (!endpoint) throw new Error('azure-speech skipped: AZURE_SPEECH_ENDPOINT or AZURE_SPEECH_REGION is required.');

    const url = new URL(endpoint);
    if (!url.searchParams.has('language')) url.searchParams.set('language', input.language || config.azureSpeechLanguage);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.azureSpeechKey,
        'Content-Type': input.mimeType || 'audio/wav',
        Accept: 'application/json',
      },
      body: this.toArrayBuffer(audio),
    });

    const data = await this.readResponse(response);
    if (!response.ok) throw new Error(`azure-speech failed: ${this.errorMessage(data, response.status)}`);

    const text = typeof data === 'object' && data && 'DisplayText' in data
      ? String((data as { DisplayText: unknown }).DisplayText)
      : '';

    return {
      provider: 'azure-speech',
      text,
      raw: data,
    };
  }

  private async readResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return { text };
    }
  }

  private errorMessage(data: unknown, status: number) {
    if (typeof data === 'object' && data && 'error' in data) {
      const error = (data as { error?: { message?: string } }).error;
      if (error?.message) return error.message;
    }
    return `HTTP ${status}`;
  }

  private toArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }
}
