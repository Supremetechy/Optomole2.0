/**
 * ArenaScene (Phaser arcade) — one wave of the collect-and-avoid loop.
 *
 * GOOD orbs are the "correct concepts" (walk over to collect → XP + objective
 * done); BAD orbs are decoys that home in and drain integrity (focus) on contact;
 * POWER orbs grant a brief shield. Clear every GOOD orb to advance; let integrity
 * or the wave timer hit zero and the run fails.
 *
 * Rendering + movement + collision use Phaser's arcade physics. Progression is
 * routed through the SAME shared services as the Pixi build — ctx.state
 * (StateStore), ctx.quests (QuestEngine), ctx.audio — so the DOM HUD shows
 * score (xp), concepts (keys), and integrity (focus) with zero HUD changes.
 */
export function makeArenaScene(Phaser) {
  const HUD_MARGIN = 96; // keep play area clear of the top HUD panels

  return class ArenaScene extends Phaser.Scene {
    constructor() {
      super('Arena');
    }

    init(data) {
      this.waveIndex = data.waveIndex || 0;
      this.waveCount = data.waveCount || 1;
      this.flow = this.registry.get('flow');
      this.ctx = this.flow.ctx;
      this.wave = this.flow.waveModel.waves[this.waveIndex];
      this.remaining = this.wave.timeLimit;
      this.shieldUntil = 0;
      this.goodLeft = 0;
      this._ended = false;
    }

    create() {
      const { width, height } = this.scale;
      this.bounds = { x: 0, y: HUD_MARGIN, w: width, h: height - HUD_MARGIN };
      this.physics.world.setBounds(this.bounds.x, this.bounds.y, this.bounds.w, this.bounds.h);

      this._makeTextures();
      this._setupInput();

      // One player + one set of groups + one set of overlaps for the scene's life.
      // Later waves swap the orbs INSIDE these groups (see _startWave/_clearEntities)
      // rather than restarting the scene — restarting a scene from inside its own
      // delayedCall races Phaser's scene manager and freezes the update loop.
      this._spawn = { x: width / 2, y: HUD_MARGIN + (height - HUD_MARGIN) / 2 };
      this.player = this.physics.add.image(this._spawn.x, this._spawn.y, 'oe-player');
      this.player.setCircle(16).setCollideWorldBounds(true).setDamping(true).setDrag(0.0008);
      this.playerSpeed = 260;

      this.goodGroup = this.physics.add.group();
      this.badGroup = this.physics.add.group();
      this.powerGroup = this.physics.add.group();

      this.physics.add.overlap(this.player, this.goodGroup, (_p, orb) => this._collectGood(orb));
      this.physics.add.overlap(this.player, this.badGroup, (_p, orb) => this._hitBad(orb));
      this.physics.add.overlap(this.player, this.powerGroup, (_p, orb) => this._collectPower(orb));

      this._startWave();
    }

    /** Load (or reload) the current wave's orbs + objectives in place. */
    _startWave() {
      this.wave = this.flow.waveModel.waves[this.waveIndex];
      this.remaining = this.wave.timeLimit;
      this.shieldUntil = 0;
      this.goodLeft = 0;
      this._ended = false;

      this.player.setPosition(this._spawn.x, this._spawn.y);
      this.player.setVelocity(0, 0);
      this.player.clearTint();

      this._setupHud();
      this._spawnWave(this._spawn);
      this._syncHud();
    }

    /** Destroy every orb (and its label) from the previous wave. */
    _clearEntities() {
      [this.goodGroup, this.badGroup, this.powerGroup].forEach((group) => {
        group.getChildren().slice().forEach((orb) => {
          orb.getData('label')?.destroy();
        });
        group.clear(true, true); // remove from scene + destroy
      });
    }

    // --- setup helpers -----------------------------------------------------

    _makeTextures() {
      const disc = (key, color, r = 18) => {
        if (this.textures.exists(key)) return;
        const g = this.make.graphics({ add: false });
        g.fillStyle(color, 1);
        g.fillCircle(r, r, r);
        g.lineStyle(3, 0xffffff, 0.55);
        g.strokeCircle(r, r, r);
        g.generateTexture(key, r * 2, r * 2);
        g.destroy();
      };
      disc('oe-player', 0x67e8f9, 16);
      disc('oe-good', 0x34d399, 18);
      disc('oe-bad', 0xfb7185, 16);
      disc('oe-power', 0xfbbf24, 18);
    }

    _setupInput() {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.keys = this.input.keyboard.addKeys('W,A,S,D');
    }

    _setupHud() {
      const s = this.ctx.state;
      s.set({
        currentRoom: {
          id: this.wave.id,
          index: this.waveIndex,
          count: this.waveCount,
          title: `${this.wave.title} — collect the concepts`,
          summary: 'Grab every green concept. Dodge the red decoys. Beat the clock.',
        },
      });
      // Register each GOOD orb as a HUD objective (completed on pickup).
      this.wave.goods.forEach((spec) => {
        this.ctx.quests.register(this.wave.id, {
          id: `${this.wave.id}:${spec.id}`,
          label: spec.label,
          kind: 'collect',
          reward: spec.reward || {},
        });
      });
    }

    // --- spawning ----------------------------------------------------------

    _rand(min, max) {
      return Phaser.Math.Between(min, max);
    }

    _scatterPoint(avoid, minDist = 130) {
      const b = this.bounds;
      for (let i = 0; i < 40; i++) {
        const x = b.x + 40 + Math.random() * (b.w - 80);
        const y = b.y + 40 + Math.random() * (b.h - 80);
        if (!avoid || Phaser.Math.Distance.Between(x, y, avoid.x, avoid.y) > minDist) {
          return { x, y };
        }
      }
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }

    _spawnWave(spawn) {
      // GOOD orbs — stationary targets with a concept label.
      this.wave.goods.forEach((spec) => {
        const p = this._scatterPoint(spawn);
        const orb = this.physics.add.image(p.x, p.y, 'oe-good').setCircle(18);
        orb.setData('spec', spec);
        orb.setData('objId', `${this.wave.id}:${spec.id}`);
        this.goodGroup.add(orb);
        const label = this.add
          .text(p.x, p.y - 30, this._short(spec.label), {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 13,
            color: '#d1fae5',
            align: 'center',
            backgroundColor: 'rgba(5,12,24,0.6)',
            padding: { x: 5, y: 2 },
          })
          .setOrigin(0.5);
        orb.setData('label', label);
        this.goodLeft++;
        this.tweens.add({ targets: orb, scale: 1.12, duration: 900, yoyo: true, repeat: -1 });
      });

      // BAD orbs — drift + (from wave 2) home in on the player.
      this.wave.bads.forEach((spec) => {
        const p = this._scatterPoint(spawn, 180);
        const orb = this.physics.add.image(p.x, p.y, 'oe-bad').setCircle(16);
        orb.setData('spec', spec);
        orb.setCollideWorldBounds(true).setBounce(1);
        const a = Math.random() * Math.PI * 2;
        orb.setVelocity(Math.cos(a) * this.wave.badSpeed, Math.sin(a) * this.wave.badSpeed);
        this.badGroup.add(orb);
      });

      // POWER orb (optional) — one per wave when present.
      if (this.wave.power) {
        const p = this._scatterPoint(spawn, 150);
        const orb = this.physics.add.image(p.x, p.y, 'oe-power').setCircle(18);
        orb.setData('spec', this.wave.power);
        this.powerGroup.add(orb);
        this.tweens.add({ targets: orb, angle: 360, duration: 2600, repeat: -1 });
      }
    }

    // --- interactions ------------------------------------------------------

    _collectGood(orb) {
      if (!orb.active) return;
      const objId = orb.getData('objId');
      this.ctx.quests.complete(objId); // xp/currency + success cue + HUD update
      orb.getData('label')?.destroy();
      orb.destroy();
      this.goodLeft--;
      this._syncHud();
      if (this.goodLeft <= 0) this._win();
    }

    _hitBad(orb) {
      if (!orb.active || this._ended) return;
      if (this.time.now < this.shieldUntil) return; // shielded by a power-up
      // Per-orb cooldown so a lingering overlap doesn't drain integrity every frame.
      const last = orb.getData('lastHit') || 0;
      if (this.time.now - last < 700) return;
      orb.setData('lastHit', this.time.now);

      this.ctx.state.damageFocus(12);
      this.ctx.audio?.play('failure');
      this.ctx.state.logEvent('⚠ Hit a decoy');
      this._flashPlayer(0xfb7185);
      this._syncHud();
      if (this.ctx.state.get('focus') <= 0) this._lose();
    }

    _collectPower(orb) {
      if (!orb.active) return;
      orb.destroy();
      this.shieldUntil = this.time.now + 5000;
      this.ctx.state.addXp(10);
      this.ctx.audio?.play('reward');
      this.ctx.state.logEvent('★ Shield — decoys can’t hurt you for 5s');
      this._flashPlayer(0xfbbf24);
      this._syncHud();
    }

    _flashPlayer(tint) {
      this.player.setTint(tint);
      this.time.delayedCall(180, () => this.player.clearTint());
    }

    // --- loop --------------------------------------------------------------

    update(_time, delta) {
      if (this._ended) return;
      const dt = delta / 1000;

      // --- movement: keyboard, plus touch steer toward an active pointer ---
      let vx = 0;
      let vy = 0;
      if (this.cursors.left.isDown || this.keys.A.isDown) vx -= 1;
      if (this.cursors.right.isDown || this.keys.D.isDown) vx += 1;
      if (this.cursors.up.isDown || this.keys.W.isDown) vy -= 1;
      if (this.cursors.down.isDown || this.keys.S.isDown) vy += 1;

      const p = this.input.activePointer;
      if (vx === 0 && vy === 0 && p.isDown) {
        const dx = p.worldX - this.player.x;
        const dy = p.worldY - this.player.y;
        if (Math.hypot(dx, dy) > 6) {
          vx = dx;
          vy = dy;
        }
      }
      const len = Math.hypot(vx, vy) || 1;
      this.player.setVelocity((vx / len) * this.playerSpeed, (vy / len) * this.playerSpeed);

      // --- bad-orb homing ramps up with wave difficulty ---
      if (this.wave.badHoming > 0) {
        this.badGroup.getChildren().forEach((orb) => {
          if (!orb || !orb.active || !orb.body) return;
          const ang = Phaser.Math.Angle.Between(orb.x, orb.y, this.player.x, this.player.y);
          const target = new Phaser.Math.Vector2(
            Math.cos(ang) * this.wave.badSpeed,
            Math.sin(ang) * this.wave.badSpeed,
          );
          orb.body.velocity.lerp(target, Math.min(1, this.wave.badHoming * dt * 2));
        });
      }

      // --- wave timer ---
      this.remaining -= dt;
      const shielded = this.time.now < this.shieldUntil;
      this.ctx.state.set({
        hint: `${this.wave.title} · ${Math.ceil(Math.max(0, this.remaining))}s · ${this.goodLeft} concept${this.goodLeft === 1 ? '' : 's'} left${shielded ? ' · SHIELDED' : ''}`,
      });
      if (this.remaining <= 0) this._lose();
    }

    _syncHud() {
      // StateStore already emits on its own mutations; this is a hook for future
      // arena-only HUD fields. Kept explicit so the flow reads clearly.
      this.ctx.state.set({});
    }

    // --- outcomes ----------------------------------------------------------

    _win() {
      if (this._ended) return;
      this._ended = true;
      this.ctx.state.clearRoom(this.wave.id);
      this.ctx.state.logEvent(`✓ ${this.wave.title} cleared`);
      this.ctx.audio?.play('unlock');
      const next = this.waveIndex + 1;
      const hasNext = !!this.flow.waveModel.waves[next];
      this.time.delayedCall(350, () => {
        if (hasNext) {
          // Swap wave contents in place — the scene keeps running.
          this._clearEntities();
          this.waveIndex = next;
          this._startWave();
        } else {
          this.scene.start('Result', { win: true, waveCount: this.waveCount });
        }
      });
    }

    _lose() {
      if (this._ended) return;
      this._ended = true;
      this.ctx.state.set({ hint: '' });
      this.time.delayedCall(250, () =>
        this.scene.start('Result', { win: false, waveCount: this.waveCount }),
      );
    }

    _short(text, max = 26) {
      const t = String(text || '').replace(/\s+/g, ' ').trim();
      return t.length > max ? `${t.slice(0, max - 1)}…` : t;
    }
  };
}
