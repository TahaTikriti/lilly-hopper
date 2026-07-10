import type { WaveField } from "./waves";

/**
 * Renders the wave height field as water.
 *
 * Per cell, the surface gradient (∂u/∂x, ∂u/∂y) drives four optical effects:
 *  - refraction: the pond-bottom texture is sampled with an offset
 *    proportional to the slope, so the bottom visibly warps under waves
 *  - diffuse shading: slopes facing the low sun brighten, opposite darken
 *  - sky reflection: slopes tilting away mix in a dusk-sky gradient
 *  - specular: steep sun-facing slopes catch a warm glint
 * Crests additionally lighten and troughs darken with raw height.
 *
 * Everything is written into an ImageData at simulation resolution, then
 * scaled up with bilinear smoothing — cheap and soft, like real water.
 */

const DEEP: [number, number, number] = [10, 38, 52];
const SHALLOW: [number, number, number] = [58, 110, 96];

// dusk sky, top → bottom, reflected in the surface
const SKY_TOP: [number, number, number] = [250, 176, 130];
const SKY_MID: [number, number, number] = [203, 126, 138];
const SKY_BOT: [number, number, number] = [108, 96, 146];

// low evening sun from the upper-left
const LX = -0.707;
const LY = -0.707;

const SHADE = 6.5; // diffuse strength
const CREST = 0.5; // direct height → brightness
const REFRACT = 14; // slope → bottom sample offset (cells)
const SPEC_T = 0.055; // specular threshold

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export class WaterRenderer {
  private readonly off: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly bottomR: Float32Array;
  private readonly bottomG: Float32Array;
  private readonly bottomB: Float32Array;
  private readonly skyRow: Float32Array; // 3 floats per row

  constructor(private readonly field: WaveField) {
    const { w, h } = field;
    this.off = document.createElement("canvas");
    this.off.width = w;
    this.off.height = h;
    this.octx = this.off.getContext("2d")!;
    this.img = this.octx.createImageData(w, h);

    // --- static pond bottom: deeper (darker) in the middle, mottled with
    // two octaves of value noise for sunken-leaf dapple ---
    this.bottomR = new Float32Array(w * h);
    this.bottomG = new Float32Array(w * h);
    this.bottomB = new Float32Array(w * h);
    const cx = w / 2;
    const cy = h / 2;
    const maxD = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const dn = Math.hypot(x - cx, y - cy) / maxD;
        const broad = vnoise(x * 0.02 + 7.3, y * 0.02 + 3.1);
        const fine = vnoise(x * 0.08, y * 0.08) * 0.7 + vnoise(x * 0.17 + 41, y * 0.17 + 17) * 0.3;
        let depth = (1.1 - dn * 1.0) * 0.82 + broad * 0.28;
        depth = Math.min(1, Math.max(0, depth));
        const dap = 0.86 + 0.3 * fine;
        this.bottomR[i] = (SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * depth) * dap;
        this.bottomG[i] = (SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * depth) * dap;
        this.bottomB[i] = (SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * depth) * dap;
      }
    }

    // --- reflected dusk sky, one colour per row ---
    this.skyRow = new Float32Array(h * 3);
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      let r: number, g: number, b: number;
      if (t < 0.5) {
        const k = t / 0.5;
        r = SKY_TOP[0] + (SKY_MID[0] - SKY_TOP[0]) * k;
        g = SKY_TOP[1] + (SKY_MID[1] - SKY_TOP[1]) * k;
        b = SKY_TOP[2] + (SKY_MID[2] - SKY_TOP[2]) * k;
      } else {
        const k = (t - 0.5) / 0.5;
        r = SKY_MID[0] + (SKY_BOT[0] - SKY_MID[0]) * k;
        g = SKY_MID[1] + (SKY_BOT[1] - SKY_MID[1]) * k;
        b = SKY_MID[2] + (SKY_BOT[2] - SKY_MID[2]) * k;
      }
      this.skyRow[y * 3] = r;
      this.skyRow[y * 3 + 1] = g;
      this.skyRow[y * 3 + 2] = b;
    }
  }

  render(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const { w, h } = this.field;
    const u = this.field.curr;
    const d = this.img.data;
    const bR = this.bottomR;
    const bG = this.bottomG;
    const bB = this.bottomB;
    const sky = this.skyRow;

    let j = 0;
    for (let y = 0; y < h; y++) {
      const yn = y > 0 ? y - 1 : 0;
      const ys = y < h - 1 ? y + 1 : y;
      const skyR = sky[y * 3];
      const skyG = sky[y * 3 + 1];
      const skyB = sky[y * 3 + 2];
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const xw = x > 0 ? i - 1 : i;
        const xe = x < w - 1 ? i + 1 : i;
        const gx = (u[xe] - u[xw]) * 0.5;
        const gy = (u[ys * w + x] - u[yn * w + x]) * 0.5;

        // refraction — bend the line of sight to the bottom by the slope
        let ox = gx * REFRACT;
        let oy = gy * REFRACT;
        if (ox > 3.5) ox = 3.5;
        else if (ox < -3.5) ox = -3.5;
        if (oy > 3.5) oy = 3.5;
        else if (oy < -3.5) oy = -3.5;
        let sx = (x + ox) | 0;
        let sy2 = (y + oy) | 0;
        if (sx < 0) sx = 0;
        else if (sx >= w) sx = w - 1;
        if (sy2 < 0) sy2 = 0;
        else if (sy2 >= h) sy2 = h - 1;
        const bi = sy2 * w + sx;

        // diffuse lighting + crest/trough tint
        const ndl = gx * LX + gy * LY;
        let lum = 1 + ndl * SHADE + u[i] * CREST;
        if (lum < 0.25) lum = 0.25;
        else if (lum > 2.2) lum = 2.2;

        // fresnel-ish sky reflection on slopes tilting away from the viewer
        let f = 0.13 - gy * 2.4;
        if (f < 0.04) f = 0.04;
        else if (f > 0.62) f = 0.62;

        let r = bR[bi] * lum * (1 - f) + skyR * f;
        let g = bG[bi] * lum * (1 - f) + skyG * f;
        let b = bB[bi] * lum * (1 - f) + skyB * f;

        // warm specular glint on steep sun-facing slopes
        const s = ndl - SPEC_T;
        if (s > 0) {
          let sp = s * s * 110;
          if (sp > 1) sp = 1;
          r += sp * (255 - r);
          g += sp * (238 - g) * 0.92;
          b += sp * (205 - b) * 0.8;
        }

        d[j] = r;
        d[j + 1] = g;
        d[j + 2] = b;
        d[j + 3] = 255;
        j += 4;
      }
    }

    this.octx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.off, 0, 0, W, H);
  }
}
