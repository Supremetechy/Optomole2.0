/**
 * The HTTP the seven asset providers share.
 *
 * Each vendor reports failure differently — a JSON `error`, a JSON `detail`, a
 * plain-text body, or an empty 402 — and a build that dies with "Request
 * failed" tells nobody which key expired. These helpers normalize that into one
 * readable message and keep timeouts consistent, so a hung vendor cannot hang a
 * compile.
 */

/** Providers get one minute per HTTP call; polling loops bound total wait separately. */
const DEFAULT_TIMEOUT_MS = 60_000;

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderHttpError';
  }
}

async function withTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the most specific message a provider offered out of an error body. */
function errorMessage(body: unknown, status: number): string {
  if (typeof body === 'string' && body.trim()) return `${status} ${body.slice(0, 300)}`;
  if (body && typeof body === 'object') {
    const record = body as Record<string, any>;
    const candidate =
      record.error?.message
      ?? record.error
      ?? record.detail
      ?? record.message
      ?? record.title;
    if (typeof candidate === 'string' && candidate) return `${status} ${candidate}`;
  }
  return `${status} request failed`;
}

/** POST JSON, expect JSON back. */
export async function postJson<T = any>(input: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const response = await withTimeout(
    input.url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...input.headers },
      body: JSON.stringify(input.body),
    },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const parsed = await readBody(response);
  if (!response.ok) throw new ProviderHttpError(input.provider, response.status, errorMessage(parsed, response.status));
  return parsed as T;
}

/** GET JSON. */
export async function getJson<T = any>(input: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}): Promise<T> {
  const response = await withTimeout(
    input.url,
    { method: 'GET', headers: input.headers },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const parsed = await readBody(response);
  if (!response.ok) throw new ProviderHttpError(input.provider, response.status, errorMessage(parsed, response.status));
  return parsed as T;
}

/**
 * POST JSON, expect BYTES back. Hugging Face returns the image/audio itself
 * rather than a URL, so the orchestrator never has to fetch a second time — but
 * an error still arrives as JSON, which is why the content type is inspected.
 */
export async function postForBytes(input: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await withTimeout(
    input.url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...input.headers },
      body: JSON.stringify(input.body),
    },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (!response.ok || contentType.includes('application/json')) {
    const parsed = await readBody(response);
    if (!response.ok) throw new ProviderHttpError(input.provider, response.status, errorMessage(parsed, response.status));
    // A 200 carrying JSON where bytes were promised means the model is still
    // loading or the request was rejected in-band.
    throw new ProviderHttpError(input.provider, response.status, errorMessage(parsed, response.status));
  }
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
}

/** Download a provider's result URL into bytes we can store ourselves. */
export async function fetchBytes(input: {
  provider: string;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await withTimeout(
    input.url,
    { method: 'GET', headers: input.headers || {} },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new ProviderHttpError(input.provider, response.status, `could not download result (${response.status})`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
