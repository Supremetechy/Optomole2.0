import { AssetKind, AssetProvider, AssetRequest, ProviderJob } from '../asset.types';
import { postForBytes, postJson } from '../provider-http';

/**
 * OpenAI — images, speech, and code.
 *
 *   POST https://api.openai.com/v1/images/generations
 *        { model: "gpt-image-1", prompt, size, n }  -> { data: [{ b64_json }] }
 *   POST https://api.openai.com/v1/audio/speech
 *        { model, voice, input }                    -> raw audio bytes
 *   POST https://api.openai.com/v1/chat/completions  -> code as text
 *
 * This is the only provider covering `voice` and `code`, which is why the
 * registry can advertise all seven asset kinds. Note gpt-image-1 returns base64
 * in JSON rather than a URL, so bytes come back inline like Hugging Face —
 * a second shape the shared job model absorbs.
 */

const BASE = 'https://api.openai.com/v1';

export class OpenAiAssetProvider implements AssetProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI (images, speech, code)';
  readonly kinds: AssetKind[] = ['sprite', 'texture', 'voice', 'code'];

  constructor(
    private readonly apiKey: () => string,
    private readonly speechModel: () => string,
    private readonly codeModel: () => string,
  ) {}

  configured(): boolean {
    return Boolean(this.apiKey());
  }

  private headers() {
    return { Authorization: `Bearer ${this.apiKey()}` };
  }

  async submit(request: AssetRequest): Promise<ProviderJob> {
    const base: ProviderJob = {
      providerId: this.id, requestId: request.id, kind: request.kind, externalId: null, status: 'queued',
    };

    if (request.kind === 'voice') return { ...base, ...(await this.speech(request)) };
    if (request.kind === 'code') return { ...base, ...(await this.code(request)) };
    return { ...base, ...(await this.image(request)) };
  }

  /** Synchronous across all three routes. */
  async poll(job: ProviderJob): Promise<ProviderJob> {
    return job;
  }

  private async image(request: AssetRequest): Promise<Partial<ProviderJob>> {
    const result = await postJson<any>({
      provider: this.id,
      url: `${BASE}/images/generations`,
      headers: this.headers(),
      body: {
        model: String(request.providerOptions?.model || 'gpt-image-1'),
        prompt: request.prompt,
        n: 1,
        size: imageSize(request.width, request.height),
        ...(request.providerOptions || {}),
      },
    });
    const entry = result?.data?.[0];
    if (entry?.b64_json) {
      return { status: 'succeeded', output: { bytes: Buffer.from(entry.b64_json, 'base64'), contentType: 'image/png' } };
    }
    if (entry?.url) return { status: 'succeeded', output: { url: entry.url, contentType: 'image/png' } };
    return { status: 'failed', error: 'openai returned no image payload', raw: result };
  }

  private async speech(request: AssetRequest): Promise<Partial<ProviderJob>> {
    const { bytes, contentType } = await postForBytes({
      provider: this.id,
      url: `${BASE}/audio/speech`,
      headers: this.headers(),
      body: {
        model: this.speechModel(),
        voice: String(request.providerOptions?.voice || 'alloy'),
        input: request.prompt,
        response_format: 'mp3',
      },
    });
    return { status: 'succeeded', output: { bytes, contentType: contentType || 'audio/mpeg' } };
  }

  /**
   * Code generation completes the "one pipeline" claim: the same registry that
   * makes a sprite can emit a gameplay script. It is returned as UTF-8 text and
   * stored like any other asset, so a build references it by url.
   */
  private async code(request: AssetRequest): Promise<Partial<ProviderJob>> {
    const result = await postJson<any>({
      provider: this.id,
      url: `${BASE}/chat/completions`,
      headers: this.headers(),
      body: {
        model: this.codeModel(),
        messages: [
          {
            role: 'system',
            content:
              'You write small, dependency-free game scripts. Reply with source code only — no prose, no markdown fences.',
          },
          { role: 'user', content: request.prompt },
        ],
        temperature: 0.2,
      },
    });
    const text = result?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      return { status: 'failed', error: 'openai returned no code', raw: result };
    }
    return {
      status: 'succeeded',
      output: { bytes: Buffer.from(stripFences(text), 'utf8'), contentType: 'text/plain; charset=utf-8' },
    };
  }
}

/** Models reject arbitrary sizes, so snap to the supported set by aspect. */
function imageSize(width?: number, height?: number): string {
  if (!width || !height || width === height) return '1024x1024';
  return width > height ? '1536x1024' : '1024x1536';
}

/** Models wrap code in fences despite instructions; store the code, not the fence. */
function stripFences(text: string): string {
  const fenced = /^\s*```[a-zA-Z0-9]*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  return (fenced ? fenced[1] : text).trim();
}

export const __test = { imageSize, stripFences };
