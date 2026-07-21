const DEFAULT_API_BASE = 'http://localhost:8080/v1';

export const API_BASE = (import.meta.env.VITE_OPTOMOLE_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error || `Request failed with ${response.status}`;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }

  return data;
}

export function getHealth() {
  return request('/health');
}

export function listTemplates() {
  return request('/templates');
}

export function compileExperience(payload) {
  return request('/experiences/compile', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function normalizeIrx(payload) {
  return request('/irx/normalize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function runPreprocessing(payload) {
  return request('/preprocessing/run', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function transcribeAudio(payload) {
  return request('/transcription/audio', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function connectEmailInbox(payload) {
  return request('/email/inbox/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function launchExperience(payload) {
  return request('/experiences/launch', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listBuilds() {
  return request('/builds');
}

export function getBuild(id) {
  return request(`/builds/${encodeURIComponent(id)}`);
}

export function listArtifacts() {
  return request('/artifacts');
}

export function getArtifact(id) {
  return request(`/artifacts/${encodeURIComponent(id)}`);
}
