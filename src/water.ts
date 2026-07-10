import type { WaveField } from "./waves";

/**
 * Water renderer — every optical effect is driven by the live height field.
 *
 *  refraction   bottom texture sampled with a slope-proportional offset
 *  caustics     pond-floor light: a drifting ridged-noise web (the familiar
 *               dancing net of light) modulated by surface curvature, so a
 *               passing wave visibly focuses light (-∇²u > 0 under a concave
 *               lens of water) and defocuses it in troughs
 *  reflections  sky gradient plus a low-res reflection map of the lily pads
 *               and frog, both sampled through the wave gradient so they
 *               smear and wobble as ripples pass
 *  foam         whitecaps on steep crests: slope² + crest height threshold,
 *               broken up by animated speckle noise; the threshold drops as
 *               chaos rises, so calm water stays glassy and storm water froths
 *  grading      all palettes (bottom, sky, specular, foam) are lerped between
 *               a calm dusk set and a storm violet set by the chaos level
 *
 * Everything is written into an ImageData at simulation resolution and
 * upscaled with bilinear smoothing.
 */

type RGB = [number, number, number];

// ---- calm palette: cool dusk greens ----
const CALM_DEEP: RGB = [10, 40, 54];
const CALM_SHALLOW: RGB = [56, 112, 98];
const CALM_SKY: [RGB, RGB, RGB] = [
  [244, 172, 128],
  [196, 124, 140],
  [104, 96, 148],
];
const CALM_SPEC: RGB = [255, 238, 205];

// ---- storm palette: bruised teal / violet ----
const STORM_DEEP: RGB = [16, 14, 42];
const STORM_SHALLOW: RGB = [38, 66, 88];
const STORM_SKY: [RGB, RGB, RGB] = [
  [148, 128, 176],
  [96, 88, 150],
  [42, 36, 84],
];
const STORM_SPEC: RGB = [216, 234, 255];

const FOAM_CALM: RGB = [214, 238, 236];
const FOAM_STORM: RGB = [232, 240, 255];

// low light from the upper-left
const LX = -0.707;
const LY = -0.707;

const SHADE = 6.5; // diffuse strength
const CREST = 0.5; // raw height → brightness
const REFRACT = 14; // slope → bottom sample offset (cells)
const REFLECT = 22; // slope → reflection-map sample offset (cells)
const NSIZE = 256; // tileable noise texture side (power of two)
const NMASK = NSIZE - 1;

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number, wrap: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const x0 = ((xi % wrap) + wrap) % wrap;
  const y0 = ((yi % wrap) + wrap) % wrap;
  const x1 = (x0 + 1) % wrap;
  const y1 = (y0 + 1) % wrap;
  const a = hash(x0, y0);
  const b = hash(x1, y0);
  const c = hash(x0, y1);
  const d = hash(x1, y1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export class WaterRenderer {
  private readonly off: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private readonly img: ImageData;

  // static per-cell pond-bottom colours, one set per palette
  private readonly botCalm: Float32Array;
  private readonly botStorm: Float32Array;
  // per-row reflected-sky colours, one set per palette + a working buffer
  private readonly skyCalm: Float32Array;
  private readonly skyStorm: Float32Array;
  private readonly skyNow: Float32Array;
  // tileable ridged noise: caustic web + foam speckle
  private readonly ridge: Float32Array;

  // scrolling offsets for the two caustic layers and the foam speckle
  private c1x = 0;
  private c1y = 0;
  private c2x = 71;
  private c2y = 130;
  private fx = 37;
  private fy = 200;

  constructor(private readonly field: WaveField) {
    const { w, h } = field;
    this.off = document.createElement("canvas");
    this.off.width = w;
    this.off.height = h;
    this.octx = this.off.getContext("2d")!;
    this.img = this.octx.createImageData(w, h);

    // --- pond bottom: deeper in the middle, mottled; built for both palettes
    this.botCalm = new Float32Array(w * h * 3);
    this.botStorm = new Float32Array(w * h * 3);
    const cx = w / 2;
    const cy = h / 2;
    const maxD = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const dn = Math.hypot(x - cx, y - cy) / maxD;
        const broad = vnoise(x * 0.02 + 7.3, y * 0.02 + 3.1, 1024);
        const fine =
          vnoise(x * 0.08, y * 0.08, 1024) * 0.7 + vnoise(x * 0.17 + 41, y * 0.17 + 17, 1024) * 0.3;
        let depth = (1.1 - dn) * 0.82 + broad * 0.28;
        depth = Math.min(1, Math.max(0, depth));
        const dap = 0.86 + 0.3 * fine;
        for (let c = 0; c < 3; c++) {
          this.botCalm[i + c] = mix(CALM_SHALLOW[c], CALM_DEEP[c], depth) * dap;
          this.botStorm[i + c] = mix(STORM_SHALLOW[c], STORM_DEEP[c], depth) * dap;
        }
      }
    }

    // --- reflected sky rows for both palettes
    this.skyCalm = new Float32Array(h * 3);
    this.skyStorm = new Float32Array(h * 3);
    this.skyNow = new Float32Array(h * 3);
    const buildSky = (dst: Float32Array, pal: [RGB, RGB, RGB]) => {
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        const [p, q, k] = t < 0.5 ? [pal[0], pal[1], t * 2] : [pal[1], pal[2], (t - 0.5) * 2];
        dst[y * 3] = mix(p[0], q[0], k);
        dst[y * 3 + 1] = mix(p[1], q[1], k);
        dst[y * 3 + 2] = mix(p[2], q[2], k);
      }
    };
    buildSky(this.skyCalm, CALM_SKY);
    buildSky(this.skyStorm, STORM_SKY);

    // --- tileable ridged noise: 1-|2n-1| turns smooth noise into thin
    // bright filaments; two drifting samples multiplied give the classic
    // caustic web
    this.ridge = new Float32Array(NSIZE * NSIZE);
    for (let y = 0; y < NSIZE; y++) {
      for (let x = 0; x < NSIZE; x++) {
        const n =
          vnoise(x * 0.055, y * 0.055, Math.round(NSIZE * 0.055)) * 0.65 +
          vnoise(x * 0.11 + 9, y * 0.11 + 5, Math.round(NSIZE * 0.11)) * 0.35;
        const r = 1 - Math.abs(2 * n - 1);
        this.ridge[y * NSIZE + x] = r * r;
      }
    }
  }

  /**
   * @param chaos    0 calm … 1 storm; grades colours, foam and caustics
   * @param dt       frame delta, drives caustic drift speed
   * @param wind     wind vector (unit-ish · strength), biases caustic drift
   * @param refl     RGBA reflection map at grid resolution (pads + frog)
   */
  render(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    chaos: number,
    dt: number,
    wind: { x: number; y: number },
    refl: Uint8ClampedArray,
  ): void {
    const { w, h } = this.field;
    const u = this.field.curr;
    const d = this.img.data;
    const bc = this.botCalm;
    const bs = this.botStorm;
    const ridge = this.ridge;

    // advance caustic / speckle drift (wind visibly drags the light web)
    const drift = (9 + chaos * 26) * dt;
    this.c1x += drift * (0.6 + wind.x * 0.8);
    this.c1y += drift * (0.35 + wind.y * 0.8);
    this.c2x -= drift * (0.45 + wind.x * 0.5);
    this.c2y += drift * (0.55 + wind.y * 0.4);
    this.fx += (20 + chaos * 60) * dt;
    this.fy += (14 + chaos * 40) * dt;

    // per-frame graded constants
    const skyN = this.skyNow;
    const skC = this.skyCalm;
    const skS = this.skyStorm;
    for (let i = 0; i < skyN.length; i++) skyN[i] = skC[i] + (skS[i] - skC[i]) * chaos;
    const specR = mix(CALM_SPEC[0], STORM_SPEC[0], chaos);
    const specG = mix(CALM_SPEC[1], STORM_SPEC[1], chaos);
    const specB = mix(CALM_SPEC[2], STORM_SPEC[2], chaos);
    const foamR = mix(FOAM_CALM[0], FOAM_STORM[0], chaos);
    const foamG = mix(FOAM_CALM[1], FOAM_STORM[1], chaos);
    const foamB = mix(FOAM_CALM[2], FOAM_STORM[2], chaos);

    const causGain = 0.55 + chaos * 0.5; // web brightness
    const focusGain = 5.5 - chaos * 2.0; // live curvature focusing (storm waves are huge — rein it in)
    // foam: high threshold when calm (glassy), lower when stormy — but it
    // must stay an accent on crests, never a flood fill
    const foamSlope = 20 + chaos * 18;
    const foamCrest = 0.5 + chaos * 0.5;
    const foamThresh = 0.55 - chaos * 0.22;
    const specT = 0.055;

    const o1x = this.c1x | 0;
    const o1y = this.c1y | 0;
    const o2x = this.c2x | 0;
    const o2y = this.c2y | 0;
    const ofx = this.fx | 0;
    const ofy = this.fy | 0;

    let j = 0;
    for (let y = 0; y < h; y++) {
      const yn = y > 0 ? y - 1 : 0;
      const ys = y < h - 1 ? y + 1 : y;
      const skyR = skyN[y * 3];
      const skyG = skyN[y * 3 + 1];
      const skyB = skyN[y * 3 + 2];
      const r1row = ((y + o1y) & NMASK) * NSIZE;
      const r2row = ((y + o2y) & NMASK) * NSIZE;
      const frow = ((y + ofy) & NMASK) * NSIZE;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const xw = x > 0 ? i - 1 : i;
        const xe = x < w - 1 ? i + 1 : i;
        const un = u[yn * w + x];
        const us = u[ys * w + x];
        const gx = (u[xe] - u[xw]) * 0.5;
        const gy = (us - un) * 0.5;
        const lap = u[xw] + u[xe] + un + us - 4 * u[i];

        // ---- refraction: bend the view ray to the bottom ----
        let ox = gx * REFRACT;
        let oy = gy * REFRACT;
        if (ox > 3.5) ox = 3.5;
        else if (ox < -3.5) ox = -3.5;
        if (oy > 3.5) oy = 3.5;
        else if (oy < -3.5) oy = -3.5;
        let sx = (x + ox) | 0;
        let sy = (y + oy) | 0;
        if (sx < 0) sx = 0;
        else if (sx >= w) sx = w - 1;
        if (sy < 0) sy = 0;
        else if (sy >= h) sy = h - 1;
        const bi = (sy * w + sx) * 3;

        // ---- caustics on the refracted floor point ----
        const web =
          ridge[r1row + ((sx + o1x) & NMASK)] * ridge[r2row + ((sx + o2x) & NMASK)] * causGain;
        let focus = -lap * focusGain;
        if (focus < 0) focus = 0;
        else if (focus > 1.4) focus = 1.4;
        const caus = 1 + web + focus * (0.4 + web * 1.6);

        // ---- graded bottom colour, lit by the caustic field ----
        let r = (bc[bi] + (bs[bi] - bc[bi]) * chaos) * caus;
        let g = (bc[bi + 1] + (bs[bi + 1] - bc[bi + 1]) * chaos) * caus;
        let b = (bc[bi + 2] + (bs[bi + 2] - bc[bi + 2]) * chaos) * caus;

        // ---- diffuse slope lighting + crest/trough tint ----
        const ndl = gx * LX + gy * LY;
        let lum = 1 + ndl * SHADE + u[i] * CREST;
        if (lum < 0.22) lum = 0.22;
        else if (lum > 2.3) lum = 2.3;
        r *= lum;
        g *= lum;
        b *= lum;

        // ---- sky reflection on away-tilting slopes ----
        let f = 0.13 - gy * 2.4;
        if (f < 0.04) f = 0.04;
        else if (f > 0.62) f = 0.62;
        r += (skyR - r) * f;
        g += (skyG - g) * f;
        b += (skyB - b) * f;

        // ---- lily pad / frog reflections, wobbled by the wave gradient ----
        let rx = (x + gx * REFLECT) | 0;
        let ry = (y + gy * REFLECT) | 0;
        if (rx < 0) rx = 0;
        else if (rx >= w) rx = w - 1;
        if (ry < 0) ry = 0;
        else if (ry >= h) ry = h - 1;
        const ri = (ry * w + rx) * 4;
        const ra = refl[ri + 3];
        if (ra > 0) {
          const k = (ra / 255) * 0.42;
          r += (refl[ri] - r) * k;
          g += (refl[ri + 1] - g) * k;
          b += (refl[ri + 2] - b) * k;
        }

        // ---- foam on steep crests, speckled and chaos-gated ----
        const slope2 = gx * gx + gy * gy;
        let foam = slope2 * foamSlope + (u[i] > 0 ? u[i] * foamCrest : 0) - foamThresh;
        if (foam > 0) {
          foam *= ridge[frow + ((x + ofx) & NMASK)] * (1.0 + chaos * 0.8);
          if (foam > 1) foam = 1;
          r += (foamR - r) * foam;
          g += (foamG - g) * foam;
          b += (foamB - b) * foam;
        }

        // ---- specular glints ----
        const s = ndl - specT;
        if (s > 0) {
          let sp = s * s * 110;
          if (sp > 1) sp = 1;
          r += sp * (specR - r);
          g += sp * (specG - g) * 0.92;
          b += sp * (specB - b) * 0.85;
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
