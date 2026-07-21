/**
 * boot.js — browser-engine entry point.
 *
 * Loads a Semantic Mapping Manifest (from window.OPTOMOLE_MANIFEST, a ?manifest=
 * URL, or the bundled sample), spins up the OptomoleRuntime, mounts the HUD, and
 * hands control to the action-adventure-key-lock template runtime.
 *
 *   manifest -> OptomoleRuntime + HUD -> KeyLockTemplateRuntime -> playable game
 */
import { OptomoleRuntime } from './runtime/OptomoleRuntime.js';
import { mountHud } from './runtime/Hud.js';
import { createKeyLockRuntime } from './templates/action-adventure-key-lock/template-runtime.js';
import { createArcadeRuntime } from './templates/arcade-collect-avoid/template-runtime.js';
import { createIdleRuntime } from './templates/idle-progress/template-runtime.js';
import { createBoardRuntime } from './templates/board-resource-sim/template-runtime.js';
import { createMemoryPalaceRuntime } from './templates/memory-palace/template-runtime.js';
import { createQuestRpgRuntime } from './templates/quest-rpg-progression/template-runtime.js';
import { createFpsGalleryRuntime } from './templates/fps-target-gallery/template-runtime.js';
import { createCourierRuntime } from './templates/open-world-courier/template-runtime.js';
import { createSandboxRuntime } from './templates/sandbox-craft-build/template-runtime.js';
import { createRunnerRuntime } from './templates/runner-gauntlet/template-runtime.js';
import { createRouterFailoverRuntime } from './templates/router-failover-defense/template-runtime.js';

/**
 * Template registry. A manifest declares which genre runtime plays it via
 * `templateId` (e.g. "arcade-collect-avoid.v1"); we match on the prefix before
 * the version. `?template=<id>` overrides for quick testing. New genres register
 * one line here.
 */
const TEMPLATES = {
    'action-adventure-key-lock': createKeyLockRuntime,
    'arcade-collect-avoid': createArcadeRuntime,
    'idle-progress': createIdleRuntime,
    'board-resource-sim': createBoardRuntime,
    'memory-palace': createMemoryPalaceRuntime,
    'quest-rpg-progression': createQuestRpgRuntime,
    'fps-target-gallery': createFpsGalleryRuntime,
    'open-world-courier': createCourierRuntime,
    'sandbox-craft-build': createSandboxRuntime,
    'runner-gauntlet': createRunnerRuntime,
    'router-failover-defense': createRouterFailoverRuntime,
  };

function selectTemplate(manifest) {
  const override = new URL(location.href).searchParams.get('template');
  const id = String(override || manifest.templateId || 'action-adventure-key-lock');
  const key = Object.keys(TEMPLATES).find((k) => id.startsWith(k)) || 'action-adventure-key-lock';
  return TEMPLATES[key];
}

async function loadPayload() {
  if (window.OPTOMOLE_MANIFEST) return window.OPTOMOLE_MANIFEST;
  const url = new URL(location.href).searchParams.get('manifest') || './sample-manifest.json';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load manifest (${res.status}) from ${url}`);
  return res.json();
}

function ensureLibs() {
  const missing = ['PIXI', 'Matter'].filter((g) => !window[g]);
  if (missing.length) {
    throw new Error(`Required libraries did not load: ${missing.join(', ')}. Check your network / CDN access.`);
  }
}

async function main() {
  ensureLibs();
  const payload = await loadPayload();
  // Accept either a raw manifest or a { manifest, meta } envelope.
  const manifest = payload.manifest || payload;
  const meta = payload.meta || { title: manifest.title || 'Optomole Experience' };

  const runtime = new OptomoleRuntime();
  await runtime.init('#game');
  mountHud(runtime.services.state);

  const createTemplate = selectTemplate(manifest);
  const template = createTemplate(manifest, meta);
  await runtime.start(template);

  // Debug handle for automated testing / dev-tools inspection. Harmless in prod.
  window.__optomole = { runtime, template, services: runtime.services };

  document.body.classList.add('ready');
}

main().catch((err) => {
  console.error('[Optomole] boot failed', err);
  const el = document.getElementById('boot-error');
  if (el) {
    el.style.display = 'grid';
    el.querySelector('p').textContent = String(err.message || err);
  }
});
