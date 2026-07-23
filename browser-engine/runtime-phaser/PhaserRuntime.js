/**
 * PhaserRuntime — the browser game host for the **Phaser build**.
 *
 * The parallel of runtime/OptomoleRuntime.js (which hosts PixiJS), this owns a
 * `Phaser.Game` and its frame loop instead. It wires the same genre-agnostic
 * services a template needs — StateStore, AudioManager — so a Phaser template can
 * reuse the DOM HUD and the pure engines (Mapping/Quest/Rpg) unchanged. Phaser
 * brings its own renderer, scene manager, input, and (arcade) physics, so those
 * runtime/ services have no Phaser equivalent — the Phaser scenes use Phaser's.
 *
 *   manifest -> template.start(runtime) -> Phaser scenes -> playable game
 *
 * Rendering + physics: Phaser 4 (global `Phaser`, arcade physics built in).
 */
import { StateStore } from '../runtime/StateStore.js';
import { AudioManager } from '../runtime/AudioManager.js';

export class PhaserRuntime {
  constructor(options = {}) {
    this.options = options;
    this.game = null;
    this.services = null;
    this._onResizeHandlers = new Set();
  }

  size() {
    const scale = this.game?.scale;
    return {
      width: scale?.width || window.innerWidth,
      height: scale?.height || window.innerHeight,
    };
  }

  async init(mount) {
    const host = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!host) throw new Error('PhaserRuntime: mount element not found');
    // Read the global lazily: the Phaser lib is injected just before init() runs,
    // so capturing it at module-import time would see `undefined`.
    const Phaser = window.Phaser;
    if (!Phaser) throw new Error('PhaserRuntime: global `Phaser` not loaded');

    // Boot the game with no scenes; the template registers and starts them.
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      transparent: true, // let the #game gradient show through the canvas
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      },
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      physics: {
        default: 'arcade',
        arcade: { gravity: { x: 0, y: 0 }, debug: false },
      },
      scene: [],
    });

    // Match the Pixi host: fill the viewport, no touch scrolling on the canvas.
    const canvas = this.game.canvas;
    if (canvas) {
      canvas.style.display = 'block';
      canvas.style.touchAction = 'none';
    }

    const state = new StateStore(this.options.initialState);
    const audio = new AudioManager();

    this.services = { runtime: this, state, audio, game: this.game };

    // Unlock audio on the first interaction (browser autoplay policy).
    const unlockOnce = () => audio.unlock();
    window.addEventListener('pointerdown', unlockOnce, { once: true });
    window.addEventListener('keydown', unlockOnce, { once: true });

    this.game.scale.on('resize', (gameSize) => {
      for (const fn of this._onResizeHandlers) fn(gameSize.width, gameSize.height);
    });

    return this;
  }

  onResize(fn) {
    this._onResizeHandlers.add(fn);
    return () => this._onResizeHandlers.delete(fn);
  }

  /** Hand the runtime to a template runtime, which registers + starts scenes. */
  async start(template) {
    if (!template || typeof template.start !== 'function') {
      throw new Error('PhaserRuntime.start: template must expose start(runtime)');
    }
    return template.start(this);
  }

  destroy() {
    this.game?.destroy(true);
    this.game = null;
  }
}
