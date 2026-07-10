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
/*  Lily pad — floats on the height field: bobs, tilts and drifts     */
/* ------------------------------------------------------------------ */

export class LilyPad {
  /** normalized home position and radius (survive window resizes) */
  readonly nx: number;
  readonly ny: number;
  private readonly nr: number;
  r = 0;
  private readonly notch: number; // angle of the leaf's split
  private readonly veins: number;
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

  update(dt: number, field: WaveField, toCell: number): void {
    const cx = this.pos.x * toCell;
    const cy = this.pos.y * toCell;
    const h = field.sample(cx, cy);
    const { gx, gy } = field.gradient(cx, cy);

    // vertical bob and visual tilt follow the local surface
    this.bob += (h * 7 - this.bob) * Math.min(1, dt * 10);
    this.tiltX += (gx - this.tiltX) * Math.min(1, dt * 8);
    this.tiltY += (gy - this.tiltY) * Math.min(1, dt * 8);

    // waves push the pad downhill; a soft spring pulls it home
    const PUSH = 300;
    const SPRING = 2.6;
    const DRAG = 2.0;
    this.vel.x += (-gx * PUSH - (this.pos.x - this.home.x) * SPRING - this.vel.x * DRAG) * dt;
    this.vel.y += (-gy * PUSH - (this.pos.y - this.home.y) * SPRING - this.vel.y * DRAG) * dt;
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

    // warm rim light from the sunset, upper-left arc
    ctx.strokeStyle = "rgba(242, 193, 132, 0.4)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, Math.PI * 0.85, Math.PI * 1.6);
    ctx.stroke();

    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/*  Frog — parabolic hops with squash & stretch                       */
/* ------------------------------------------------------------------ */

type FrogState = "idle" | "crouch" | "air" | "land";

export interface JumpEvents {
  onTakeoff(pos: Vec, power: number): void;
  onLand(pos: Vec, power: number): void;
}

export class Frog {
  padIndex: number;
  pos: Vec = { x: 0, y: 0 };
  private heading = -Math.PI / 2;
  private state: FrogState = "idle";
  private t = 0;
  private airDur = 0;
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

  constructor(padIndex: number) {
    this.padIndex = padIndex;
  }

  get busy(): boolean {
    return this.state !== "idle";
  }

  jumpTo(padIndex: number, pads: LilyPad[]): void {
    // landing recovery may be interrupted by the next hop; flight may not
    if (this.state === "crouch" || this.state === "air") return;
    this.targetPad = padIndex;
    this.from = { ...this.pos };
    const to = pads[padIndex].pos;
    const dist = Math.hypot(to.x - this.from.x, to.y - this.from.y);
    this.heading = dist > 4 ? Math.atan2(to.y - this.from.y, to.x - this.from.x) : this.heading;
    this.airDur = 0.42 + Math.min(0.55, dist * 0.0011);
    this.apex = 36 + dist * 0.24;
    this.power = 0.45 + Math.min(1.25, dist / 250);
    this.state = "crouch";
    this.t = 0;
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
        if (this.t >= 0.13) {
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
      const k = Math.min(1, this.t / 0.13);
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

    const lift = 1 + this.altitude * 0.011; // closer to camera when airborne

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
}

/* ------------------------------------------------------------------ */
/*  Dragonfly — wanders above the surface, occasionally dips its tail */
/* ------------------------------------------------------------------ */

type Ripple = (x: number, y: number, radiusPx: number, amp: number) => void;

export class Dragonfly {
  private pos: Vec;
  private vel: Vec = { x: 0, y: 0 };
  private readonly seed = rand(0, 100);
  private t = rand(0, 100);
  private hoverH = 16;
  private dipIn = rand(4, 10);
  private dip = -1; // <0: not dipping; else 0..1 phase
  private dipped = false;

  constructor(W: number, H: number) {
    this.pos = { x: rand(0.2, 0.8) * W, y: rand(0.2, 0.8) * H };
  }

  update(dt: number, W: number, H: number, ripple: Ripple): void {
    this.t += dt;

    // meandering steering from layered sines
    const a =
      Math.sin(this.t * 0.31 + this.seed) * 1.8 +
      Math.sin(this.t * 0.117 + this.seed * 2.7) * 2.6;
    const speed = this.dip >= 0 ? 14 : 34 + 18 * Math.sin(this.t * 0.21 + this.seed);
    let ax = Math.cos(a) * speed - this.vel.x;
    let ay = Math.sin(a) * speed - this.vel.y;
    // steer back toward the pond when near an edge
    const M = 70;
    if (this.pos.x < M) ax += 40;
    if (this.pos.x > W - M) ax -= 40;
    if (this.pos.y < M) ay += 40;
    if (this.pos.y > H - M) ay -= 40;
    this.vel.x += ax * dt * 1.6;
    this.vel.y += ay * dt * 1.6;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // occasional tail-dip that pricks the water
    this.dipIn -= dt;
    if (this.dipIn <= 0 && this.dip < 0) {
      this.dip = 0;
      this.dipped = false;
      this.dipIn = rand(6, 14);
    }
    if (this.dip >= 0) {
      this.dip += dt / 1.4;
      const k = Math.sin(Math.min(1, this.dip) * Math.PI);
      this.hoverH = 16 - 14 * k;
      if (k > 0.96 && !this.dipped) {
        this.dipped = true;
        ripple(this.pos.x, this.pos.y, 4, 0.07);
      }
      if (this.dip >= 1) {
        this.dip = -1;
        this.hoverH = 16;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { x, y } = this.pos;
    const ang = Math.atan2(this.vel.y, this.vel.x);

    // shadow-dot on the water
    ctx.fillStyle = `rgba(8, 20, 28, ${0.18 * (1 - this.hoverH / 40)})`;
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 6 + this.hoverH * 0.4, 5, 2.5, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y - this.hoverH);
    ctx.rotate(ang);

    // wings — fluttering translucency
    const flut = 0.14 + 0.14 * Math.abs(Math.sin(this.t * 68 + this.seed));
    ctx.fillStyle = `rgba(212, 232, 240, ${flut})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(2, side * 6, 9, 2.6, side * 0.5, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-2, side * 6, 8, 2.3, side * 0.75, 0, TAU);
      ctx.fill();
    }

    // slender body
    ctx.strokeStyle = "#b4543c";
    ctx.lineWidth = 2.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-12, 0);
    ctx.stroke();
    ctx.fillStyle = "#8e3c2c";
    ctx.beginPath();
    ctx.arc(6, 0, 2.6, 0, TAU);
    ctx.fill();

    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/*  Fish — a dark shape gliding beneath, nudging the surface          */
/* ------------------------------------------------------------------ */

export class Fish {
  private t = 0;
  private readonly dur: number;
  private readonly p0: Vec;
  private readonly p1: Vec;
  private readonly cp: Vec;
  private rippleIn = 0.3;
  done = false;

  constructor(W: number, H: number) {
    const side = Math.floor(rand(0, 4));
    const edge = (s: number): Vec => {
      if (s === 0) return { x: rand(0.15, 0.85) * W, y: 0.12 * H };
      if (s === 1) return { x: rand(0.15, 0.85) * W, y: 0.88 * H };
      if (s === 2) return { x: 0.1 * W, y: rand(0.2, 0.8) * H };
      return { x: 0.9 * W, y: rand(0.2, 0.8) * H };
    };
    this.p0 = edge(side);
    this.p1 = edge((side + 2) % 4);
    const mx = (this.p0.x + this.p1.x) / 2;
    const my = (this.p0.y + this.p1.y) / 2;
    const dx = this.p1.x - this.p0.x;
    const dy = this.p1.y - this.p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = rand(-0.35, 0.35) * len;
    this.cp = { x: mx - (dy / len) * bend, y: my + (dx / len) * bend };
    this.dur = rand(4.5, 7);
  }

  private at(k: number): Vec {
    const m = 1 - k;
    return {
      x: m * m * this.p0.x + 2 * m * k * this.cp.x + k * k * this.p1.x,
      y: m * m * this.p0.y + 2 * m * k * this.cp.y + k * k * this.p1.y,
    };
  }

  update(dt: number, ripple: Ripple, plip: (vol: number, pitch: number) => void): void {
    this.t += dt / this.dur;
    if (this.t >= 1 && !this.done) {
      // departing tail-flick breaks the surface
      const p = this.at(1);
      ripple(p.x, p.y, 9, 0.5);
      plip(0.45, 1.35);
      this.done = true;
      return;
    }
    this.rippleIn -= dt;
    if (this.rippleIn <= 0) {
      this.rippleIn = 0.42;
      const p = this.at(this.t);
      ripple(p.x, p.y, 7, 0.11); // the moving bulge of water above its back
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.done) return;
    const k = Math.min(1, this.t);
    const p = this.at(k);
    const ahead = this.at(Math.min(1, k + 0.02));
    const ang = Math.atan2(ahead.y - p.y, ahead.x - p.x);
    const alpha = 0.26 * Math.pow(Math.sin(Math.PI * k), 0.6);
    const wig = Math.sin(this.t * this.dur * 7) * 3;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.fillStyle = `rgba(12, 30, 38, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 7, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-19, wig, 8, 4.4, wig * 0.04, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
