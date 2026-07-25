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
import { attachSignalEmitter } from './runtime/SignalEmitter.js';
import { resolveTheme } from './runtime/theme.js';
import { PALETTE } from './runtime/AssetLoader.js';
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

/**
 * Pick the rendering build. Default is the bundled PixiJS runtime; a manifest can
 * opt into the Phaser build with `engine: "phaser"`, and `?engine=phaser` forces
 * it for quick testing. Any unknown value falls back to Pixi.
 */
function selectEngine(manifest) {
  const override = new URL(location.href).searchParams.get('engine');
  const id = String(override || manifest.engine || 'pixi').toLowerCase();
  return id === 'phaser' ? 'phaser' : 'pixi';
}

async function main() {
  const payload = await loadPayload();
  // Accept either a raw manifest or a { manifest, meta } envelope.
  const manifest = payload.manifest || payload;
  const meta = payload.meta || { title: manifest.title || 'Optomole Experience' };

  // Engine dispatch: the Phaser build lives behind a lazy import so the Pixi path
  // never loads Phaser (and vice-versa). Only the selected stack is fetched.
  if (selectEngine(manifest) === 'phaser') {
    const { bootPhaser } = await import('./runtime-phaser/boot-phaser.js');
    return bootPhaser(manifest, meta);
  }

  ensureLibs();
  // Content + engine driven theme: domain picks the palette, Pixi picks the neon style.
  const theme = resolveTheme(PALETTE, { manifest, meta, engine: 'pixi' });
  const runtime = new OptomoleRuntime();
  await runtime.init('#game', theme);
  mountHud(runtime.services.state);

  const createTemplate = selectTemplate(manifest);
  const template = createTemplate(manifest, meta);
  await runtime.start(template);

  // Return edge of the Experience Engine loop: emit player observation signals
  // back to the gateway so the Data Node keeps growing as the person plays.
  const signals = attachSignalEmitter(runtime, manifest, meta, 'pixi');

  // Debug handle for automated testing / dev-tools inspection. Harmless in prod.
  window.__optomole = { runtime, template, services: runtime.services, signals, theme };

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
