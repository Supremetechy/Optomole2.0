/**
 * OptomoleRuntime — the browser game host.
 *
 * Owns the PixiJS Application and the frame loop, and wires together the shared
 * services every scene/engine needs: StateStore, AssetLoader, AudioManager,
 * InputController, SceneManager. A template (e.g. action-adventure-key-lock)
 * receives this runtime and drives the scene flow.
 *
 *   Context/GDP -> template.start(runtime) -> scenes -> playable game
 *
 * Rendering: PixiJS v8 (global `PIXI`). Physics is per-scene via Matter.js.
 */
import { StateStore } from './StateStore.js';
import { AssetLoader } from './AssetLoader.js';
import { AudioManager } from './AudioManager.js';
import { InputController } from './InputController.js';
import { SceneManager } from './SceneManager.js';

const PIXI = window.PIXI;

export class OptomoleRuntime {
  constructor(options = {}) {
    this.options = options;
    this.app = null;
    this.services = null;
    this._onResizeHandlers = new Set();
  }

  size() {
    return {
      width: this.app?.renderer?.width || window.innerWidth,
      height: this.app?.renderer?.height || window.innerHeight,
    };
  }

  async init(mount) {
    const host = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!host) throw new Error('OptomoleRuntime: mount element not found');

    this.app = new PIXI.Application();
    await this.app.init({
      background: 0x030712,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';

    const state = new StateStore(this.options.initialState);
    const assets = new AssetLoader(this.app.renderer).buildDefaultPack();
    const audio = new AudioManager();
    const input = new InputController(this.app.canvas);

    this.services = { runtime: this, state, assets, audio, input, scenes: null };
    const scenes = new SceneManager(this.services);
    this.services.scenes = scenes;
    this.app.stage.addChild(scenes.root);

    // Unlock audio on the first interaction (browser autoplay policy).
    const unlockOnce = () => audio.unlock();
    window.addEventListener('pointerdown', unlockOnce, { once: true });
    window.addEventListener('keydown', unlockOnce, { once: true });

    this.app.renderer.on('resize', (w, h) => {
      scenes.resize(w, h);
      for (const fn of this._onResizeHandlers) fn(w, h);
    });

    this.app.ticker.add((ticker) => {
      // Cap dt so a background tab that stalls doesn't tunnel physics.
      const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
      scenes.update(dt);
    });

    return this;
  }

  onResize(fn) {
    this._onResizeHandlers.add(fn);
    return () => this._onResizeHandlers.delete(fn);
  }

  /** Hand the runtime to a template runtime, which sets the first scene. */
  async start(template) {
    if (!template || typeof template.start !== 'function') {
      throw new Error('OptomoleRuntime.start: template must expose start(runtime)');
    }
    return template.start(this);
  }
}