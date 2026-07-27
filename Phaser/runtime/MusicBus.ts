/**
 * MusicBus — what `SetMusicIntensity` actually moves.
 *
 * The pacing director has always computed a loudness for every region, and the
 * adapters have always thrown it away, so a tense region and a calm one sounded
 * identical: silent. This is the smallest honest consumer of that number.
 *
 * It synthesizes rather than plays files, for two reasons: a compiled experience
 * has no audio assets (the compiler emits sprite specs, not stems), and a drone
 * built from the intensity itself cannot fall out of sync with it the way a
 * pre-mixed layer set can.
 *
 * Three layers, faded in by intensity:
 *   root      always present — the bed
 *   fifth     from ~0.25    — the region has weight
 *   tension   from ~0.6     — a detuned semitone above the root, which is what
 *                             makes a peak audibly uncomfortable rather than
 *                             merely louder
 *
 * Everything is guarded: with no WebAudio (node, tests, an old browser) every
 * method is a no-op, because audio must never be the reason a game fails to run.
 */

export interface MusicBusOptions {
  /** Ceiling on the master gain, so a compiled 1.0 is still comfortable. */
  maxGain?: number;
  /** Root pitch of the bed, in Hz. */
  rootHz?: number;
}

/** How long the bus takes to reach a newly set intensity, in seconds. */
const RAMP_SECONDS = 1.5;

type Ctx = AudioContext;

interface Layer {
  osc: OscillatorNode;
  gain: GainNode;
  /** Intensity at which this layer starts being heard. */
  threshold: number;
  /** Intensity at which it is fully in. */
  full: number;
  /** Share of the master gain this layer takes at full. */
  weight: number;
}

export class MusicBus {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private layers: Layer[] = [];
  private started = false;
  private disposed = false;
  private intensity = 0;
  private readonly maxGain: number;
  private readonly rootHz: number;

  constructor(options: MusicBusOptions = {}) {
    this.maxGain = options.maxGain ?? 0.14;
    this.rootHz = options.rootHz ?? 55;
  }

  /** True when audio is actually available; false everywhere else. */
  get available(): boolean {
    return typeof globalThis !== "undefined" && typeof (globalThis as any).AudioContext === "function";
  }

  /**
   * Set the region's current loudness, 0..1. Safe to call every director tick:
   * the value is ramped, not stepped, so pacing reads as a swell rather than a
   * series of jumps.
   */
  setIntensity(value: number): void {
    if (this.disposed) return;
    const intensity = Math.max(0, Math.min(1, Number(value) || 0));
    this.intensity = intensity;
    if (!this.start()) return;
    this.applyIntensity(intensity);
  }

  /**
   * Browsers refuse to start audio without a gesture. The game already has key
   * input, so an adapter calls this on the first one and the bus catches up to
   * whatever intensity the director has been setting in the meantime.
   */
  resume(): void {
    if (this.disposed || !this.start()) return;
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
    this.applyIntensity(this.intensity);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const layer of this.layers) {
      try {
        layer.osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.layers = [];
    try {
      void this.ctx?.close();
    } catch {
      /* nothing to close */
    }
    this.ctx = null;
  }

  // ---- internals ----

  /** Build the graph on first use. Returns false when audio is unavailable. */
  private start(): boolean {
    if (this.started) return this.ctx !== null;
    this.started = true;
    if (!this.available) return false;

    try {
      const ctx = new (globalThis as any).AudioContext() as Ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 300;
      filter.Q.value = 0.7;
      filter.connect(master);
      master.connect(ctx.destination);

      const specs: Array<{ hz: number; type: OscillatorType; threshold: number; full: number; weight: number }> = [
        { hz: this.rootHz, type: "sine", threshold: 0, full: 0.35, weight: 0.55 },
        { hz: this.rootHz * 1.5, type: "sine", threshold: 0.25, full: 0.7, weight: 0.3 },
        // A semitone above the root: the beat frequency between them is the
        // unease a peak is supposed to carry.
        { hz: this.rootHz * 1.06, type: "triangle", threshold: 0.6, full: 1, weight: 0.15 },
      ];

      this.layers = specs.map(spec => {
        const osc = ctx.createOscillator();
        osc.type = spec.type;
        osc.frequency.value = spec.hz;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(filter);
        osc.start();
        return { osc, gain, threshold: spec.threshold, full: spec.full, weight: spec.weight };
      });

      this.ctx = ctx;
      this.master = master;
      this.filter = filter;
      return true;
    } catch {
      // A blocked or unavailable AudioContext is not a game-stopping problem.
      this.ctx = null;
      return false;
    }
  }

  private applyIntensity(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.filter) return;
    const at = ctx.currentTime;
    const ramp = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(at);
      param.setValueAtTime(param.value, at);
      param.linearRampToValueAtTime(value, at + RAMP_SECONDS);
    };

    ramp(this.master.gain, this.maxGain * (0.25 + intensity * 0.75));
    // Opening the filter is most of what "louder" actually sounds like.
    ramp(this.filter.frequency, 220 + intensity * 1600);
    for (const layer of this.layers) {
      const span = Math.max(0.001, layer.full - layer.threshold);
      const presence = Math.max(0, Math.min(1, (intensity - layer.threshold) / span));
      ramp(layer.gain.gain, presence * layer.weight);
    }
  }
}
