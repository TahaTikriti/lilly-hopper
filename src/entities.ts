import type { WaveField } from "./waves";

export interface Vec {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/* ------------------------------------------------------------------ */
/*  Lily pad — floats on the height field; chaos makes it restless    */
/* ------------------------------------------------------------------ */

export class LilyPad {
  /** normalized home position and radius (survive window resizes) */
  readonly nx: number;
  readonly ny: number;
  private readonly nr: number;
  r = 0;
  private notch: number; // angle of the leaf's split
  private readonly veins: number;
  private readonly seed = rand(0, 100);
  private home: Vec = { x: 0, y: 0 };
  pos: Vec = { x: 0, y: 0 };
  private vel: Vec = { x: 0, y: 0 };

  /** live readings from the water under the pad */
  bob = 0;
  private tiltX = 0;
  private tiltY = 0;

  constructor(nx: number, ny: number, nr: number) {
    this.nx = nx;
    this.ny = ny;
    this.nr = nr;
    this.notch = rand(0, TAU);
    this.veins = 6 + Math.floor(rand(0, 3));
  }

  layout(W: number, H: number): void {
    this.r = this.nr * Math.min(W, H);
    this.home = { x: this.nx * W, y: this.ny * H };
    this.pos = { ...this.home };
    this.vel = { x: 0, y: 0 };
  }

  update(
    dt: number,
    t: number,
    field: WaveField,
    toCell: number,
    chaos: number,
    wind: Vec,
  ): void {
    const cx = this.pos.x * toCell;
    const cy = this.pos.y * toCell;
    const hgt = field.sample(cx, cy);
    const { gx, gy } = field.gradient(cx, cy);

    // vertical bob and visual tilt follow the local surface
    this.bob += (hgt * 7 - this.bob) * Math.min(1, dt * 10);
    this.tiltX += (gx - this.tiltX) * Math.min(1, dt * 8);
    this.tiltY += (gy - this.tiltY) * Math.min(1, dt * 8);

    // chaos makes the pad wander around home and spin its notch —
    // the real difficulty curve: targets drift faster as combo climbs
    const wob = 46 * chaos;
    const wx = this.home.x + Math.sin(t * (0.5 + chaos * 0.7) + this.seed * 2.1) * wob;
    const wy = this.home.y + Math.cos(t * (0.41 + chaos * 0.6) + this.seed * 3.7) * wob;
    this.notch += Math.sin(t * 0.8 + this.seed) * chaos * 1.1 * dt;

    // waves push it downhill, wind shoves it, a spring pulls it to the
    // (wandering) anchor point
    const PUSH = 300;
    const SPRING = 2.6;
    const DRAG = 2.0;
    const gust = 26 * chaos * chaos;
    this.vel.x += (-gx * PUSH + wind.x * gust - (this.pos.x - wx) * SPRING - this.vel.x * DRAG) * dt;
    this.vel.y += (-gy * PUSH + wind.y * gust - (this.pos.y - wy) * SPRING - this.vel.y * DRAG) * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { x, y } = this.pos;
    const r = this.r;
    const scale = 1 + this.bob * 0.012;
    const tx = this.tiltX;
    const ty = this.tiltY;

    // waterline shadow shifts with tilt — pad looks pressed into the surface
    ctx.save();
    ctx.translate(x + 3 + tx * 26, y + 5 + ty * 26);
    ctx.scale(scale, scale * 0.94);
    ctx.fillStyle = "rgba(8, 22, 30, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y - this.bob * 0.6);
    ctx.scale(scale, scale * 0.94);

    // leaf body with a wedge notch
    const a0 = this.notch + 0.26;
    const a1 = this.notch - 0.26 + TAU;
    const grad = ctx.createRadialGradient(
      -tx * r * 2 - r * 0.25,
      -ty * r * 2 - r * 0.3,
      r * 0.15,
      0,
      0,
      r,
    );
    grad.addColorStop(0, "#5c9150");
    grad.addColorStop(0.62, "#3f7442");
    grad.addColorStop(1, "#2b5a36");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0, a1);
    ctx.closePath();
    ctx.fill();

    // veins
    ctx.strokeStyle = "rgba(20, 52, 30, 0.35)";
    ctx.lineWidth = 1;
    for (let v = 0; v < this.veins; v++) {
      const a = a0 + ((a1 - a0) * (v + 0.5)) / this.veins;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.14, Math.sin(a) * r * 0.14);
      ctx.lineTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
      ctx.stroke();
    }

    // warm rim light, upper-left arc
    ctx.strokeStyle = "rgba(242, 193, 132, 0.4)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, Math.PI * 0.85, Math.PI * 1.6);
    ctx.stroke();

    ctx.restore();
  }

  /** Soft colour blob into the low-res reflection map (grid coords). */
  drawReflection(rctx: CanvasRenderingContext2D, toCell: number): void {
    const x = this.pos.x * toCell;
    const y = this.pos.y * toCell;
    const r = this.r * toCell * 1.35;
    const g = rctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, "rgba(86, 148, 92, 0.85)");
    g.addColorStop(1, "rgba(86, 148, 92, 0)");
    rctx.fillStyle = g;
    rctx.beginPath();
    rctx.arc(x, y, r, 0, TAU);
    rctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/*  Frog — beat-locked parabolic hops with squash & stretch           */
/* ------------------------------------------------------------------ */

type FrogState = "idle" | "crouch" | "air" | "land";

export interface JumpEvents {
  onTakeoff(pos: Vec, power: number): void;
  onLand(pos: Vec, power: number): void;
}

/** crouch + flight = exactly one beat, so a click on the pulse lands on it */
export const CROUCH_TIME = 0.12;

export class Frog {
  padIndex: number;
  pos: Vec = { x: 0, y: 0 };
  private heading = -Math.PI / 2;
  private state: FrogState = "idle";
  private t = 0;
  private airDur = 0.48;
  private from: Vec = { x: 0, y: 0 };
  private targetPad = 0;
  private apex = 0;
  private power = 0;
  private altitude = 0;
  // landing recovery spring
  private squash = 0;
  private squashV = 0;
  private breathe = rand(0, 10);
  private blinkIn = rand(2, 5);
  private blink = 0;

  readonly size = 15;

  constructor(padIndex: number, beatDur: number) {
    this.padIndex = padIndex;
    this.airDur = Math.max(0.3, beatDur - CROUCH_TIME);
  }

  get busy(): boolean {
    return this.state !== "idle";
  }

  jumpTo(padIndex: number, pads: LilyPad[]): boolean {
    // landing recovery may be interrupted by the next hop; flight may not
    if (this.state === "crouch" || this.state === "air") return false;
    this.targetPad = padIndex;
    this.from = { ...this.pos };
    const to = pads[padIndex].pos;
    const dist = Math.hypot(to.x - this.from.x, to.y - this.from.y);
    this.heading = dist > 4 ? Math.atan2(to.y - this.from.y, to.x - this.from.x) : this.heading;
    this.apex = 36 + dist * 0.24;
    this.power = 0.45 + Math.min(1.25, dist / 250);
    this.state = "crouch";
    this.t = 0;
    return true;
  }

  update(dt: number, pads: LilyPad[], ev: JumpEvents): void {
    this.breathe += dt;
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blink = 0.14;
      this.blinkIn = rand(2.5, 6);
    }
    if (this.blink > 0) this.blink -= dt;

    // landing-squash spring
    const K = 90;
    const C = 11;
    this.squashV += (-K * this.squash - C * this.squashV) * dt;
    this.squash += this.squashV * dt;

    switch (this.state) {
      case "idle": {
        const pad = pads[this.padIndex];
        this.pos = { x: pad.pos.x, y: pad.pos.y - pad.bob * 0.6 };
        this.altitude = 0;
        break;
      }
      case "crouch": {
        this.t += dt;
        const pad = pads[this.padIndex];
        this.pos = { x: pad.pos.x, y: pad.pos.y - pad.bob * 0.6 };
        if (this.t >= CROUCH_TIME) {
          this.state = "air";
          this.t = 0;
          ev.onTakeoff(this.pos, this.power * 0.35);
        }
        break;
      }
      case "air": {
        this.t += dt;
        const k = Math.min(1, this.t / this.airDur);
        // target pad keeps drifting during flight — track it live
        const to = pads[this.targetPad].pos;
        this.pos = {
          x: this.from.x + (to.x - this.from.x) * k,
          y: this.from.y + (to.y - this.from.y) * k,
        };
        this.altitude = 4 * this.apex * k * (1 - k);
        if (Math.hypot(to.x - this.from.x, to.y - this.from.y) > 4) {
          this.heading = Math.atan2(to.y - this.from.y, to.x - this.from.x);
        }
        if (k >= 1) {
          this.state = "land";
          this.t = 0;
          this.padIndex = this.targetPad;
          this.altitude = 0;
          this.squashV = -4.5; // impact kick into the recovery spring
          ev.onLand(this.pos, this.power);
        }
        break;
      }
      case "land": {
        this.t += dt;
        const pad = pads[this.padIndex];
        this.pos = { x: pad.pos.x, y: pad.pos.y - pad.bob * 0.6 };
        if (this.t >= 0.35) this.state = "idle";
        break;
      }
    }
  }

  /** Shadow is drawn separately so it stays on the water while airborne. */
  drawShadow(ctx: CanvasRenderingContext2D): void {
    const s = this.size;
    const shrink = 1 / (1 + this.altitude * 0.02);
    ctx.save();
    ctx.translate(this.pos.x + 3, this.pos.y + 5 + this.altitude * 0.08);
    ctx.rotate(this.heading + Math.PI / 2);
    ctx.fillStyle = `rgba(8, 20, 28, ${0.32 * shrink})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.1 * shrink, s * 1.35 * shrink, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.size;

    // squash & stretch: along = local -Y (direction of travel)
    let along = 1 + 0.02 * Math.sin(this.breathe * 2.1);
    let perp = 1 - 0.02 * Math.sin(this.breathe * 2.1);
    if (this.state === "crouch") {
      const k = Math.min(1, this.t / CROUCH_TIME);
      along = 1 - 0.22 * k;
      perp = 1 + 0.16 * k;
    } else if (this.state === "air") {
      const k = Math.min(1, this.t / this.airDur);
      const stretch = Math.sin(k * Math.PI) * 0.28;
      along = 1 + stretch;
      perp = 1 - stretch * 0.55;
    }
    along -= this.squash;
    perp += this.squash * 0.8;

    // closer to camera when airborne, capped so long hops stay frog-sized
    const lift = 1 + Math.min(this.altitude, 55) * 0.009;

    ctx.save();
    ctx.translate(this.pos.x, this.pos.y - this.altitude);
    ctx.rotate(this.heading + Math.PI / 2);
    ctx.scale(perp * lift, along * lift);

    // hind legs
    ctx.fillStyle = "#47813a";
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * s * 0.72, s * 0.55);
      ctx.rotate(side * 0.55);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.36, s * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      // hind feet
      ctx.beginPath();
      ctx.ellipse(side * s * 0.98, s * 1.02, s * 0.22, s * 0.13, side * 0.9, 0, TAU);
      ctx.fill();
    }

    // front feet
    ctx.fillStyle = "#4c8a3f";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * s * 0.48, -s * 0.72, s * 0.16, s * 0.11, side * 0.4, 0, TAU);
      ctx.fill();
    }

    // body
    const grad = ctx.createRadialGradient(-s * 0.2, -s * 0.35, s * 0.15, 0, 0, s * 1.25);
    grad.addColorStop(0, "#8fc25e");
    grad.addColorStop(0.6, "#619e48");
    grad.addColorStop(1, "#3e7a36");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.74, s * 0.95, 0, 0, TAU);
    ctx.fill();

    // back stripe + spots
    ctx.strokeStyle = "rgba(40, 84, 34, 0.55)";
    ctx.lineWidth = s * 0.09;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.55);
    ctx.quadraticCurveTo(s * 0.06, 0, 0, s * 0.7);
    ctx.stroke();
    ctx.fillStyle = "rgba(40, 84, 34, 0.4)";
    for (const [px, py, pr] of [
      [-0.34, 0.1, 0.09],
      [0.3, 0.28, 0.075],
      [-0.2, 0.52, 0.065],
      [0.36, -0.18, 0.06],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px * s, py * s, pr * s, 0, TAU);
      ctx.fill();
    }

    // eyes
    const open = this.blink > 0 ? 0.15 : 1;
    for (const side of [-1, 1]) {
      const ex = side * s * 0.4;
      const ey = -s * 0.78;
      ctx.fillStyle = "#548e42";
      ctx.beginPath();
      ctx.arc(ex, ey, s * 0.28, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#f4e6b0";
      ctx.beginPath();
      ctx.ellipse(ex, ey, s * 0.19, s * 0.19 * open, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#1c2416";
      ctx.beginPath();
      ctx.ellipse(ex, ey, s * 0.1, s * 0.12 * open, 0, 0, TAU);
      ctx.fill();
      if (open > 0.5) {
        ctx.fillStyle = "rgba(255,240,210,0.9)";
        ctx.beginPath();
        ctx.arc(ex - s * 0.04, ey - s * 0.05, s * 0.035, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  drawReflection(rctx: CanvasRenderingContext2D, toCell: number): void {
    const x = this.pos.x * toCell;
    const y = this.pos.y * toCell;
    const r = this.size * toCell * 1.6;
    const g = rctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, "rgba(126, 176, 96, 0.8)");
    g.addColorStop(1, "rgba(126, 176, 96, 0)");
    rctx.fillStyle = g;
    rctx.beginPath();
    rctx.arc(x, y, r, 0, TAU);
    rctx.fill();
  }
}
