/**
 * BootScene (Phaser arcade) — the pre-wave briefing.
 *
 * Shows the experience title, subtitle, and coach briefing, then starts wave 0
 * on Space / Enter / tap. Exported as a factory so the `Phaser` global is only
 * touched after the library has finished loading.
 */
export function makeBootScene(Phaser) {
  return class BootScene extends Phaser.Scene {
    constructor() {
      super('Boot');
    }

    create() {
      const flow = this.registry.get('flow');
      const { meta, waveModel, coachLine } = flow;
      const { width, height } = this.scale;
      const cx = width / 2;

      const briefing =
        [meta.briefing, coachLine].filter(Boolean).join(' ') ||
        'Grab the correct concepts, dodge the decoys, and clear every wave before the clock runs out.';

      this.add
        .text(cx, height * 0.3, meta.title || waveModel.title || 'Optomole Arcade', {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.min(48, width * 0.08),
          fontStyle: '800',
          color: '#e5f4ff',
          align: 'center',
          wordWrap: { width: width * 0.8 },
        })
        .setOrigin(0.5);

      this.add
        .text(cx, height * 0.42, meta.subtitle || 'Arcade · Collect & Avoid · Phaser build', {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 16,
          fontStyle: '800',
          color: '#67e8f9',
          align: 'center',
        })
        .setOrigin(0.5);

      this.add
        .text(cx, height * 0.55, briefing, {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.min(18, width * 0.04),
          color: '#94a3b8',
          align: 'center',
          wordWrap: { width: Math.min(560, width * 0.82) },
          lineSpacing: 6,
        })
        .setOrigin(0.5);

      const prompt = this.add
        .text(cx, height * 0.78, 'Press Space / Enter — or tap — to start', {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 16,
          color: '#e5f4ff',
          align: 'center',
        })
        .setOrigin(0.5);
      this.tweens.add({ targets: prompt, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

      const begin = () => this.scene.start('Arena', { waveIndex: 0, waveCount: flow.waveCount });
      this.input.keyboard.once('keydown-SPACE', begin);
      this.input.keyboard.once('keydown-ENTER', begin);
      this.input.once('pointerdown', begin);
    }
  };
}
