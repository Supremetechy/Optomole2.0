/**
 * boot-phaser.js — entry point for the **Phaser build** of the browser engine.
 *
 * boot.js dispatches here when the experience selects the Phaser engine
 * (`?engine=phaser`, or `manifest.engine === "phaser"`). We lazy-load the
 * vendored Phaser library (so the default Pixi path never pays its ~1.3 MB
 * cost), spin up a PhaserRuntime, mount the shared DOM HUD, and hand control to
 * the matching Phaser genre template.
 *
 *   manifest -> PhaserRuntime + HUD -> <genre> Phaser template -> playable game
 */
import { PhaserRuntime } from './PhaserRuntime.js';
import { mountHud } from '../runtime/Hud.js';
import { createPhaserArcadeRuntime } from '../templates-phaser/arcade-collect-avoid/template-runtime.js';

/** Phaser-build template registry — mirrors the Pixi TEMPLATES map in boot.js. */
const PHASER_TEMPLATES = {
  'arcade-collect-avoid': createPhaserArcadeRuntime,
};

function selectPhaserTemplate(manifest) {
  const override = new URL(location.href).searchParams.get('template');
  const id = String(override || manifest.templateId || 'arcade-collect-avoid');
  const key =
    Object.keys(PHASER_TEMPLATES).find((k) => id.startsWith(k)) || 'arcade-collect-avoid';
  return PHASER_TEMPLATES[key];
}

/** Inject the vendored Phaser UMD build once and resolve when `Phaser` is ready. */
let _phaserLoad = null;
function loadPhaserLib() {
  if (window.Phaser) return Promise.resolve();
  if (_phaserLoad) return _phaserLoad;
  _phaserLoad = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = new URL('../vendor/phaser.min.js', import.meta.url).href;
    el.async = true;
    el.onload = () =>
      window.Phaser
        ? resolve()
        : reject(new Error('Phaser library loaded but global `Phaser` is missing'));
    el.onerror = () =>
      reject(new Error('Failed to load vendored Phaser (./vendor/phaser.min.js)'));
    document.head.appendChild(el);
  });
  return _phaserLoad;
}

/**
 * Boot the Phaser build. Called by boot.js with the already-parsed manifest/meta
 * so engine dispatch happens without loading two rendering stacks.
 */
export async function bootPhaser(manifest, meta) {
  await loadPhaserLib();

  const runtime = new PhaserRuntime();
  await runtime.init('#game');
  mountHud(runtime.services.state);

  const createTemplate = selectPhaserTemplate(manifest);
  const template = createTemplate(manifest, meta);
  await runtime.start(template);

  // Debug handle, parallel to the Pixi path's window.__optomole.
  window.__optomole = { engine: 'phaser', runtime, template, services: runtime.services };
  document.body.classList.add('ready');
  return template;
}

export default bootPhaser;
