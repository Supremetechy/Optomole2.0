/**
 * Vehicle (open-world-courier) — the courier car.
 *
 * Unlike the twin-stick players in the other genres, this one drives: the input
 * axis maps to throttle (y) and steering (x), steering only bites while the car
 * is moving, and the body carries momentum through corners. That handling model
 * is what makes the city feel like a place you travel through rather than a
 * board you slide around.
 *
 * A Matter body handles building collisions; the sprite is rotated to the
 * heading. Cargo currently carried is drawn as a small tag above the roof.
 */
const PIXI = window.PIXI;
const Matter = window.Matter;

export const CAR_W = 26;
export const CAR_H = 46;

const MAX_SPEED = 7.2;
const ACCEL = 12;
const REVERSE_ACCEL = 7;
const BRAKE = 14;
const TURN_RATE = 3.1;
const DRAG = 1.6;

export class Vehicle {
  constructor(ctx, { x = 0, y = 0 } = {}) {
    this.ctx = ctx;
    this.heading = -Math.PI / 2; // pointing "north" up the screen
    this.speed = 0;

    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;

    this.sprite = new PIXI.Sprite(ctx.assets.get('vehicle'));
    this.sprite.anchor.set(0.5);
    this.sprite.width = CAR_W;
    this.sprite.height = CAR_H;
    this.container.addChild(this.sprite);

    this.cargoTag = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Inter, system-ui, sans-serif', fill: 0x34d399, fontSize: 11, fontWeight: '900' },
    });
    this.cargoTag.anchor.set(0.5, 1);
    this.cargoTag.y = -CAR_H / 2 - 6;
    this.container.addChild(this.cargoTag);

    this.body = Matter.Bodies.rectangle(x, y, CAR_W, CAR_H, {
      frictionAir: 0.06,
      label: 'vehicle',
      restitution: 0.15,
      inertia: Infinity, // we drive the rotation ourselves
    });
    this.body.plugin = { prefab: this };

    this._flash = 0;
  }

  addTo(container, world) {
    container.addChild(this.container);
    Matter.Composite.add(world, this.body);
  }

  get position() {
    return this.body.position;
  }

  setCargo(label) {
    this.cargoTag.text = label ? `📦 ${shorten(label)}` : '';
  }

  flash() {
    this._flash = 0.35;
  }

  /**
   * Called inside the fixed physics step.
   * axis.y < 0 (W / stick up) is throttle; axis.y > 0 brakes then reverses.
   */
  drive(axis, dt) {
    const throttle = -axis.y;

    if (throttle > 0.05) {
      this.speed += ACCEL * throttle * dt;
    } else if (throttle < -0.05) {
      this.speed += (this.speed > 0 ? -BRAKE : REVERSE_ACCEL * throttle) * dt * Math.abs(throttle);
    } else {
      // Coast: bleed speed toward zero without snapping.
      const drag = DRAG * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    this.speed = clamp(this.speed, -MAX_SPEED * 0.45, MAX_SPEED);

    // Steering authority scales with speed — you cannot pivot a parked car.
    const grip = Math.min(1, Math.abs(this.speed) / 2.2);
    this.heading += axis.x * TURN_RATE * grip * dt * Math.sign(this.speed || 1);

    Matter.Body.setVelocity(this.body, {
      x: Math.cos(this.heading) * this.speed,
      y: Math.sin(this.heading) * this.speed,
    });
    Matter.Body.setAngle(this.body, this.heading + Math.PI / 2);
  }

  sync(dt) {
    this.container.x = this.body.position.x;
    this.container.y = this.body.position.y;
    this.sprite.rotation = this.heading + Math.PI / 2;

    // A hard shunt into a building scrubs speed, so collisions have a cost.
    const actual = Math.hypot(this.body.velocity.x, this.body.velocity.y);
    if (actual < Math.abs(this.speed) * 0.45) this.speed *= 0.6;

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt);
      this.sprite.tint = 0xfb7185;
    } else {
      this.sprite.tint = 0xffffff;
    }
  }

  halt() {
    this.speed = 0;
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
  }

  destroy(world) {
    if (world) Matter.Composite.remove(world, this.body);
    this.container.destroy({ children: true });
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function shorten(text, max = 20) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
