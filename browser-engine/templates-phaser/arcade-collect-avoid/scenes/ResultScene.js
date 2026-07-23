/**
 * ResultScene (Phaser arcade) — the win/lose screen.
 *
 * Reports the outcome and final score/level (read from the shared StateStore),
 * then replays from wave 0 on Space / Enter / tap. Exported as a factory so the
 * `Phaser` global is only referenced after the library has loaded.
 */
export function makeResultScene(Phaser) {
  return class ResultScene extends Phaser.Scene {
    constructor() {
      super('Result');
    }

    init(data) {
      this.win = !!data.win;
      this.waveCount = data.waveCount || 1;
    }

    create() {
      const flow = this.registry.get('flow');
      const state = flow.ctx.state;
      const { width, height } = this.scale;
      const cx = width / 2;

      const accent = this.win ? '#34d399' : '#fb7185';
      state.set({ hint: '' });

      this.add
        .text(cx, height * 0.32, this.win ? 'Cleared!' : 'Run Failed', {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.min(56, width * 0.1),
          fontStyle: '800',
          color: accent,
          align: 'center',
        })
        .setOrigin(0.5);

      this.add
        .text(
          cx,
          height * 0.46,
          this.win
            ? `All ${this.waveCount} wave${this.waveCount === 1 ? '' : 's'} cleared.`
            : 'Integrity or the clock ran out.',
          {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 18,
            color: '#94a3b8',
            align: 'center',
            wordWrap: { width: width * 0.8 },
          },
        )
        .setOrigin(0.5);

      this.add
        .text(
          cx,
          height * 0.56,
          `Score ${state.get('xp')}   ·   Level ${state.get('level')}   ·   Coins ${state.get('currency')}`,
          {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 16,
            color: '#e5f4ff',
            align: 'center',
          },
        )
        .setOrigin(0.5);

      const prompt = this.add
        .text(cx, height * 0.76, 'Press Space / Enter — or tap — to play again', {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 16,
          color: '#e5f4ff',
          align: 'center',
        })
        .setOrigin(0.5);
      this.tweens.add({ targets: prompt, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

      const again = () => {
        flow.resetState();
        this.scene.start('Arena', { waveIndex: 0, waveCount: flow.waveCount });
      };
      this.input.keyboard.once('keydown-SPACE', again);
      this.input.keyboard.once('keydown-ENTER', again);
      this.input.once('pointerdown', again);
    }
  };
}
