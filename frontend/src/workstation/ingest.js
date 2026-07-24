/**
 * ingest.js — self-contained ingestion + launch helpers for the Workstation UI.
 *
 * These are deliberately a small, standalone copy of the pieces the classic
 * Console (src/main.jsx) uses, so the alternate UI reuses only the shared
 * `api.js` transport and never forces a refactor of the working Console.
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { API_BASE, transcribeAudio } from '../api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Read one uploaded file into a normalized source item (PDF, audio, or text). */
export async function extractFileText(file) {
  const lowerName = file.name.toLowerCase();

  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    return {
      sourceType: 'manual',
      title: file.name,
      text: pages.join('\n\n').trim() || `PDF uploaded: ${file.name}`,
      origin: 'pdf-upload',
      metadata: { fileName: file.name, mimeType: file.type, pages: pdf.numPages },
    };
  }

  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name)) {
    return transcribeAudioFile(file);
  }

  const text = await file.text();
  return {
    sourceType: inferFileSourceType(file),
    title: file.name,
    text: text.trim() || `File uploaded: ${file.name}`,
    origin: 'file-upload',
    metadata: { fileName: file.name, mimeType: file.type },
  };
}

async function transcribeAudioFile(file) {
  try {
    const dataBase64 = await fileToBase64(file);
    const result = await transcribeAudio({
      fileName: file.name,
      mimeType: file.type || inferAudioMimeType(file.name),
      dataBase64,
    });
    const transcription = result.transcription;
    return {
      sourceType: 'audio',
      title: file.name,
      text: transcription.text,
      origin: `${transcription.provider}-transcription`,
      metadata: { fileName: file.name, mimeType: file.type, provider: transcription.provider },
    };
  } catch (error) {
    return {
      sourceType: 'audio',
      title: file.name,
      text: `Audio file uploaded: ${file.name}. Automatic transcription failed: ${error.message}. Paste a transcript so the engine can build objectives, evidence, and achievements.`,
      origin: 'audio-upload',
      metadata: { fileName: file.name, mimeType: file.type, requiresTranscription: true },
    };
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read audio file.'));
    reader.readAsDataURL(file);
  });
}

function inferAudioMimeType(fileName) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName.endsWith('.m4a')) return 'audio/mp4';
  if (lowerName.endsWith('.ogg')) return 'audio/ogg';
  if (lowerName.endsWith('.webm')) return 'audio/webm';
  return 'audio/wav';
}

function inferFileSourceType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.epub')) return 'ebook';
  if (name.endsWith('.csv') || name.endsWith('.json')) return 'tasklist';
  if (name.endsWith('.vtt') || name.endsWith('.srt')) return 'audio';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'newsletter';
  return 'manual';
}

/** Merge ingested items + a draft text blob into one combined source string. */
export function buildCombinedText(items, draftText) {
  const itemText = items.map((item) => `# ${item.title}\n${item.text || item.uri || ''}`).join('\n\n');
  return [itemText, draftText].filter(Boolean).join('\n\n');
}

function isLocalOrPrivateHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname.startsWith('192.168.')
    || hostname.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

/** Gateway origin (API_BASE minus the /v1 suffix). */
export function publicGatewayBase() {
  try {
    const url = new URL(API_BASE);
    url.pathname = url.pathname.replace(/\/v1\/?$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return API_BASE.replace(/\/v1\/?$/, '');
  }
}

/**
 * Rewrite a gateway launch URL into a same-origin URL the Workstation can embed.
 * The engine page and its manifest are both re-pointed at the console origin,
 * where the Vite dev proxy forwards `/v1/browser-engine` and `/v1/objects` to the
 * gateway. Same-origin framing satisfies the engine's frame-ancestors/XFO headers.
 * Falls back to the raw URL (opens fine in a new tab) if anything is unparseable.
 */
export function toEmbeddableUrl(rawUrl) {
  if (!rawUrl || typeof window === 'undefined') return rawUrl || '';
  try {
    const origin = window.location.origin;
    const launch = new URL(rawUrl, origin);
    const params = new URLSearchParams();

    const manifest = launch.searchParams.get('manifest');
    if (manifest) {
      let manifestValue = manifest;
      try {
        const m = new URL(manifest);
        // Only relativize gateway-hosted manifests; leave external URLs intact.
        if (m.pathname.startsWith('/v1/objects') || m.pathname.startsWith('/v1/browser-engine')) {
          manifestValue = m.pathname + m.search;
        }
      } catch (_) { /* relative already */ }
      params.set('manifest', manifestValue);
    }
    const template = launch.searchParams.get('template');
    if (template) params.set('template', template);
    const engine = launch.searchParams.get('engine');
    if (engine) params.set('engine', engine);

    const query = params.toString();
    return `${origin}${launch.pathname}${query ? `?${query}` : ''}`;
  } catch (_) {
    return rawUrl;
  }
}
