/**
 * AudioManager — sound for the runtime.
 *
 * Prefers Howler when a binding supplies a real audio URL; otherwise it
 * synthesizes short procedural cues with the Web Audio API so every game has
 * feedback sounds (pickup, success, failure, unlock, talk, reward) without any
 * bundled MP3s. This closes the "pickup_sound -> actual MP3" gap for defaults.
 *
 * All playback is best-effort and gated on a user gesture (browsers block audio
 * until the first interaction); call `unlock()` from a pointer/key handler.
 */
const Howl = window.Howl;

const CUES = {
  pickup: { freq: 660, ramp: 990, dur: 0.14, type: 'triangle' },
  success: { freq: 523, ramp: 784, dur: 0.22, type: 'sine' },
  failure: { freq: 220, ramp: 110, dur: 0.28, type: 'sawtooth' },
  unlock: { freq: 392, ramp: 659, dur: 0.3, type: 'square' },
  talk: { freq: 340, ramp: 300, dur: 0.08, type: 'sine' },
  reward: { freq: 587, ramp: 1175, dur: 0.4, type: 'triangle' },
  step: { freq: 180, ramp: 160, dur: 0.05, type: 'sine' },
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.howls = new Map();
    this.music = null;
    this._musicPlaying = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.startMusic();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) this.ctx = new AC();
    this.startMusic();
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  /** Register a real sound file for a cue name (overrides the procedural cue). */
  register(name, url) {
    if (!url || !Howl) return;
    this.howls.set(name, new Howl({ src: [url], preload: true, volume: 0.7 }));
  }

  /**
   * Register a looping background track. Kept separate from `register` because
   * a cue is a one-shot fired by gameplay while music is a lifecycle the
   * runtime owns: it cannot start until the autoplay gesture lands, so
   * `unlock()` is what actually plays it.
   */
  registerMusic(url) {
    if (!url || !Howl) return;
    this.music = new Howl({ src: [url], preload: true, loop: true, volume: 0.35 });
    if (this.ctx) this.startMusic();
  }

  startMusic() {
    if (!this.music || !this.enabled || this._musicPlaying) return;
    try {
      this.music.play();
      this._musicPlaying = true;
    } catch (_) {
      /* autoplay still blocked; the next unlock retries */
    }
  }

  play(name) {
    if (!this.enabled) return;
    const howl = this.howls.get(name);
    if (howl) {
      try {
        howl.play();
        return;
      } catch (_) {
        /* fall through to procedural */
      }
    }
    this._blip(CUES[name] || CUES.talk);
  }

  _blip({ freq, ramp, dur, type }) {
    if (!this.ctx) this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, ramp), now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }
}