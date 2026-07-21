/**
 * CityScene — the free-roam city, and the whole of this genre's play.
 *
 * Unlike the other templates, the world here is larger than the viewport: the
 * camera follows the vehicle with a soft lag, buildings are solid Matter bodies,
 * and the player chooses their own route and their own order of work. That
 * choice is the point — the content becomes a set of jobs on a map rather than a
 * fixed sequence.
 *
 * Loop:
 *   - Drive to a green pickup, enter the ring to load the cargo (the task).
 *   - The matching purple drop-off lights up; drive it there to deliver.
 *   - Delivering pays a fare and reveals the "why" from the evidence binding.
 *   - Patrols chase on sight; contact raises HEAT. Max heat ends the run.
 *   - Every contract delivered clears the city.
 *
 * Fares, heat, and per-contract objectives all flow through the shared
 * StateStore / QuestEngine so the existing HUD renders them unchanged.
 */
import { createVehicle, createWaypoint, createPatrol, TILE } from '../entity-factory.js';

const PIXI = window.PIXI;
const Matter = window.Matter;

const STEP = 1 / 60;
const HEAT_PER_CONTACT = 18;
const CONTACT_COOLDOWN = 1.6;
const CAMERA_LAG = 5.5;

export class CityScene {
  constructor(ctx, { model, onComplete, onBusted }) {
    this.ctx = ctx;
    this.model = model;       // { city, contracts, patrols, districts }
    this.city = model.city;
    this.onComplete = onComplete;
    this.onBusted = onBusted;

    this.container = new PIXI.Container();
    this.world = new PIXI.Container();   // camera-transformed
    this.hudLayer = new PIXI.Container(); // screen-space
    this.container.addChild(this.world, this.hudLayer);

    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    this._acc = 0;

    this.waypoints = new Map(); // contractId -> { pickup, dropoff }
    this.patrols = [];
    this.carrying = null;       // the contract currently in the boot
    this.delivered = 0;
    this._contactCooldown = 0;
    this._done = false;
    this.camera = { x: 0, y: 0 };
    this.elapsed = 0;
  }

  enter(ctx) {
    const size = ctx.runtime.size();

    this._buildCity();
    this._spawn();
    this._registerObjectives();
    this._buildHud(size);

    ctx.state.set({
      heat: 0,
      currentRoom: {
        id: 'city',
        title: `${this.model.title} — ${this.model.contracts.length} contract${this.model.contracts.length === 1 ? '' : 's'}`,
        index: 0,
        count: 1,
        summary: 'Drive to a green marker to load, then run it to the purple drop-off.',
      },
      hint: 'W/S throttle · A/D steer · drive into a marker to load and deliver.',
    });
    ctx.state.logEvent(`${this.model.contracts.length} contracts on the board`);
  }

  // ---- World construction ---------------------------------------------------

  _buildCity() {
    const { cols, rows, tiles } = this.city;

    // Roads as one tiling sprite under everything, blocks drawn on top.
    const road = new PIXI.TilingSprite({
      texture: this.ctx.assets.get('tile-road'),
      width: this.city.width,
      height: this.city.height,
    });
    this.world.addChild(road);

    const blockTex = this.ctx.assets.get('tile-block');
    const blocks = new PIXI.Container();
    const bodies = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (tiles[r][c] !== 'block') continue;
        const sprite = new PIXI.Sprite(blockTex);
        sprite.width = TILE;
        sprite.height = TILE;
        sprite.x = c * TILE;
        sprite.y = r * TILE;
        blocks.addChild(sprite);
        bodies.push(Matter.Bodies.rectangle(
          c * TILE + TILE / 2, r * TILE + TILE / 2, TILE, TILE,
          { isStatic: true, label: 'building' },
        ));
      }
    }
    this.world.addChild(blocks);

    // Map boundary so the car cannot drive off the world.
    const t = 40;
    bodies.push(
      Matter.Bodies.rectangle(this.city.width / 2, -t / 2, this.city.width, t, { isStatic: true, label: 'edge' }),
      Matter.Bodies.rectangle(this.city.width / 2, this.city.height + t / 2, this.city.width, t, { isStatic: true, label: 'edge' }),
      Matter.Bodies.rectangle(-t / 2, this.city.height / 2, t, this.city.height, { isStatic: true, label: 'edge' }),
      Matter.Bodies.rectangle(this.city.width + t / 2, this.city.height / 2, t, this.city.height, { isStatic: true, label: 'edge' }),
    );

    Matter.Composite.add(this.engine.world, bodies);
  }

  _spawn() {
    // Waypoints first, so the spawn can be placed away from the nearest pickup.
    for (const contract of this.model.contracts) {
      const pickup = createWaypoint(this.ctx, contract.spec, {
        ...contract.pickup, kind: 'pickup',
      });
      const dropoff = createWaypoint(this.ctx, contract.spec, {
        ...contract.dropoff,
        kind: 'dropoff',
        label: `Deliver: ${contract.spec.label}`,
      });
      pickup.addTo(this.world);
      dropoff.addTo(this.world);
      dropoff.setActive(false); // only lights up while carrying this contract
      this.waypoints.set(contract.id, { pickup, dropoff });
    }

    for (const p of this.model.patrols) {
      const patrol = createPatrol(this.ctx, p.spec, {
        x: p.x, y: p.y, axis: p.axis, range: p.range, speed: p.speed,
      });
      patrol.addTo(this.world);
      this.patrols.push(patrol);
    }

    const start = this.model.spawn;
    this.vehicle = createVehicle(this.ctx, start);
    this.vehicle.addTo(this.world, this.engine.world);
    this.camera = { x: start.x, y: start.y };
  }

  _registerObjectives() {
    const q = this.ctx.quests;
    for (const contract of this.model.contracts) {
      q.register('city', {
        id: `contract:${contract.id}`,
        label: `Deliver: ${contract.spec.label}`,
        kind: 'deliver',
        reward: { xp: contract.fare, currency: contract.currency },
      });
    }
  }

  // ---- HUD ------------------------------------------------------------------

  _buildHud({ width, height }) {
    this.hudLayer.removeChildren();

    this.heatBar = new PIXI.Graphics();
    this.hudLayer.addChild(this.heatBar);

    this.status = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0xe5f4ff, fontSize: 13, fontWeight: '800' },
    });
    this.status.anchor.set(0.5, 0);
    this.hudLayer.addChild(this.status);

    // Compass arrow to the active objective — essential in an open map.
    this.arrow = new PIXI.Graphics();
    this.hudLayer.addChild(this.arrow);

    this.minimap = new PIXI.Graphics();
    this.hudLayer.addChild(this.minimap);

    this._layoutHud({ width, height });
  }

  _layoutHud({ width, height }) {
    this.status?.position.set(width / 2, 16);
    this._hudGeom = {
      width,
      height,
      heat: { x: width / 2 - 110, y: 40, w: 220, h: 10 },
      // Minimap sits bottom-right, clear of the HUD panels on the left.
      map: { x: width - 150, y: height - 150, size: 134 },
      arrow: { x: width / 2, y: height / 2 },
    };
  }

  _drawHeat() {
    if (!this._hudGeom) return;
    const { x, y, w, h } = this._hudGeom.heat;
    const heat = this.ctx.state.get('heat') || 0;
    const frac = Math.min(1, heat / 100);
    const color = frac > 0.75 ? 0xfb7185 : frac > 0.4 ? 0xfbbf24 : 0x67e8f9;
    this.heatBar.clear();
    this.heatBar.roundRect(x, y, w, h, 5).fill({ color: 0x050c18, alpha: 0.85 }).stroke({ width: 1, color: 0x334155 });
    if (frac > 0) this.heatBar.roundRect(x + 1, y + 1, (w - 2) * frac, h - 2, 4).fill(color);
  }

  _drawMinimap() {
    if (!this._hudGeom) return;
    const { x, y, size } = this._hudGeom.map;
    const sx = size / this.city.width;
    const sy = size / this.city.height;

    this.minimap.clear();
    this.minimap.roundRect(x, y, size, size, 8)
      .fill({ color: 0x050c18, alpha: 0.86 })
      .stroke({ width: 1, color: 0x334155 });

    // Undelivered pickups (or the live drop-off) as bright dots.
    for (const contract of this.model.contracts) {
      if (contract.state === 'delivered') continue;
      const target = contract.state === 'carrying' ? contract.dropoff : contract.pickup;
      const color = contract.state === 'carrying' ? 0xa78bfa : 0x34d399;
      this.minimap.circle(x + target.x * sx, y + target.y * sy, 2.5).fill(color);
    }

    for (const p of this.patrols) {
      this.minimap.circle(x + p.position.x * sx, y + p.position.y * sy, 2).fill({ color: 0xfb7185, alpha: 0.9 });
    }

    const v = this.vehicle.position;
    this.minimap.circle(x + v.x * sx, y + v.y * sy, 3.5).fill(0x67e8f9);
  }

  /** Screen-center arrow pointing at whatever the player should drive to next. */
  _drawArrow() {
    if (!this._hudGeom) return;
    this.arrow.clear();
    const target = this._activeTarget();
    if (!target) return;

    const v = this.vehicle.position;
    const ang = Math.atan2(target.y - v.y, target.x - v.x);
    const { x: cx, y: cy } = this._hudGeom.arrow;
    const r = 74;
    const px = cx + Math.cos(ang) * r;
    const py = cy + Math.sin(ang) * r;
    const color = this.carrying ? 0xa78bfa : 0x34d399;

    // Small triangle pointing outward from the car toward the objective.
    const a1 = ang;
    const a2 = ang + 2.5;
    const a3 = ang - 2.5;
    this.arrow.poly([
      px + Math.cos(a1) * 12, py + Math.sin(a1) * 12,
      px + Math.cos(a2) * 9, py + Math.sin(a2) * 9,
      px + Math.cos(a3) * 9, py + Math.sin(a3) * 9,
    ]).fill({ color, alpha: 0.9 });
  }

  /** The point the player is currently working toward. */
  _activeTarget() {
    if (this.carrying) return this.carrying.dropoff;
    // Nearest available pickup, so the arrow respects the player's own routing.
    const v = this.vehicle.position;
    let best = null;
    let bestD = Infinity;
    for (const c of this.model.contracts) {
      if (c.state !== 'available') continue;
      const d = Math.hypot(c.pickup.x - v.x, c.pickup.y - v.y);
      if (d < bestD) { bestD = d; best = c.pickup; }
    }
    return best;
  }

  // ---- Frame ----------------------------------------------------------------

  update(dt) {
    if (this._done) return;
    this.elapsed += dt;

    // --- Fixed-step driving ---
    this._acc += dt;
    let guard = 0;
    const axis = this.ctx.input.getAxis();
    while (this._acc >= STEP && guard < 5) {
      this.vehicle.drive(axis, STEP);
      Matter.Engine.update(this.engine, STEP * 1000);
      this._acc -= STEP;
      guard++;
    }
    this.vehicle.sync(dt);
    const vpos = this.vehicle.position;

    // --- World actors ---
    for (const { pickup, dropoff } of this.waypoints.values()) {
      pickup.update(dt);
      dropoff.update(dt);
    }
    for (const p of this.patrols) p.update(dt, vpos);

    // --- Pickup / delivery ---
    this._checkWaypoints(vpos);

    // --- Patrol contact raises heat ---
    if (this._contactCooldown > 0) this._contactCooldown = Math.max(0, this._contactCooldown - dt);
    if (this._contactCooldown === 0) {
      for (const p of this.patrols) {
        if (p.touches(vpos)) {
          this._contactCooldown = CONTACT_COOLDOWN;
          const heat = Math.min(100, (this.ctx.state.get('heat') || 0) + HEAT_PER_CONTACT);
          this.ctx.state.set({ heat, hint: `⚠ ${p.spec.description || p.spec.label}` });
          this.ctx.state.damageFocus(8);
          this.vehicle.flash();
          this.ctx.audio?.play('failure');
          this.ctx.state.logEvent(`⚠ ${p.spec.label} (heat ${heat})`);
          break;
        }
      }
    }

    // --- Camera follows with lag ---
    this.camera.x += (vpos.x - this.camera.x) * Math.min(1, CAMERA_LAG * dt);
    this.camera.y += (vpos.y - this.camera.y) * Math.min(1, CAMERA_LAG * dt);
    this._applyCamera();

    // --- HUD ---
    this._drawHeat();
    this._drawMinimap();
    this._drawArrow();
    this._updateStatus();

    // --- Resolution ---
    if ((this.ctx.state.get('heat') || 0) >= 100) {
      this.ctx.state.set({ hint: 'Busted — heat maxed out.' });
      this._finish(false);
    } else if (this.delivered >= this.model.contracts.length && this.model.contracts.length > 0) {
      this._finish(true);
    }
  }

  _checkWaypoints(vpos) {
    if (!this.carrying) {
      for (const contract of this.model.contracts) {
        if (contract.state !== 'available') continue;
        const wp = this.waypoints.get(contract.id);
        if (wp.pickup.isInside(vpos)) {
          contract.state = 'carrying';
          this.carrying = contract;
          wp.pickup.consume();
          wp.dropoff.setActive(true);
          this.vehicle.setCargo(contract.spec.label);
          this.ctx.audio?.play('pickup');
          this.ctx.state.set({ hint: `📦 Loaded: ${contract.spec.description || contract.spec.label}` });
          this.ctx.state.logEvent(`📦 Picked up ${contract.spec.label}`);
          break;
        }
      }
      return;
    }

    const wp = this.waypoints.get(this.carrying.id);
    if (!wp.dropoff.isInside(vpos)) return;

    const contract = this.carrying;
    contract.state = 'delivered';
    wp.dropoff.consume();
    this.delivered++;
    this.carrying = null;
    this.vehicle.setCargo(null);

    this.ctx.state.addXp(contract.fare);
    this.ctx.state.addCurrency(contract.currency);
    this.ctx.state.addKey(`contract:${contract.id}`, {
      id: contract.id, label: contract.spec.label, icon: 'waypoint-dropoff',
    });
    this.ctx.quests.complete(`contract:${contract.id}`);
    this.ctx.audio?.play('reward');

    // Delivering is where the "why" lands — the evidence binding pays off here.
    const why = contract.brief?.description || contract.spec.description || '';
    this.ctx.state.set({ hint: `✓ Delivered ${contract.spec.label}. ${why}`.trim() });
    this.ctx.state.logEvent(`✓ Delivered ${contract.spec.label} (+${contract.fare})`);

    // Each clean delivery bleeds a little heat — the fence for a long run.
    const heat = Math.max(0, (this.ctx.state.get('heat') || 0) - 8);
    this.ctx.state.set({ heat });
  }

  _applyCamera() {
    const { width, height } = this.ctx.runtime.size();
    // Clamp so the camera never shows past the city edge.
    const x = clamp(this.camera.x, width / 2, Math.max(width / 2, this.city.width - width / 2));
    const y = clamp(this.camera.y, height / 2, Math.max(height / 2, this.city.height - height / 2));
    this.world.x = width / 2 - x;
    this.world.y = height / 2 - y;
  }

  _updateStatus() {
    if (!this.status) return;
    const left = this.model.contracts.length - this.delivered;
    this.status.text = this.carrying
      ? `📦 Carrying: ${shorten(this.carrying.spec.label, 34)}  →  drop-off marked`
      : `${left} contract${left === 1 ? '' : 's'} remaining  ·  drive to a green marker`;
  }

  _finish(win) {
    if (this._done) return;
    this._done = true;
    this.vehicle.halt();
    if (win) {
      this.ctx.state.clearRoom('city');
      this.ctx.audio?.play('reward');
      // Speed bonus: a tight run pays more than a leisurely one.
      const bonus = Math.max(0, Math.round((this.model.contracts.length * 45) - this.elapsed * 2));
      if (bonus > 0) {
        this.ctx.state.addXp(bonus);
        this.ctx.state.logEvent(`🏁 All contracts delivered · speed bonus +${bonus}`);
      }
      this.onComplete?.({ delivered: this.delivered, elapsed: this.elapsed, heat: this.ctx.state.get('heat') || 0 });
    } else {
      this.onBusted?.({ delivered: this.delivered, elapsed: this.elapsed, heat: 100 });
    }
  }

  resize(w, h) {
    this._layoutHud({ width: w, height: h });
    this._applyCamera();
  }

  exit() {
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function shorten(text, max = 26) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
