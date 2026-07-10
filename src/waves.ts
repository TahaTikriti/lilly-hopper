/**
 * Discretized 2D wave equation on a height-field grid.
 *
 *   u_next = (2·u − u_prev + c²·∇²u) · damping · sponge
 *
 * Two history buffers (curr/prev) give the leapfrog integration; because the
 * equation is linear, overlapping ripples superpose with correct
 * interference (crests add, crest+trough cancels). A "sponge" band of extra
 * attenuation near the borders soaks up most outgoing energy so edges give
 * back a soft, partial reflection instead of a hard mirror bounce.
 */
export class WaveField {
  readonly w: number;
  readonly h: number;
  curr: Float32Array;
  prev: Float32Array;
  private next: Float32Array;
  private readonly sponge: Float32Array;

  /** per-step global energy loss; chaos-driven (calm ↔ stormy) */
  damping = 0.9945;
  /** c² — wave speed squared; chaos raises it. Kept ≤ 0.45 for stability. */
  c2 = 0.28;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.curr = new Float32Array(w * h);
    this.prev = new Float32Array(w * h);
    this.next = new Float32Array(w * h);

    // Sponge layer: attenuation ramps from strong at the border to none
    // MARGIN cells inward. A wave crossing it twice (in + out) keeps only a
    // small fraction of its amplitude — a soft, believable bank reflection.
    const MARGIN = 11;
    this.sponge = new Float32Array(w * h).fill(1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (d < MARGIN) {
          this.sponge[y * w + x] = 0.9 + 0.1 * (d / MARGIN);
        }
      }
    }
  }

  /** Advance the simulation by one fixed tick. */
  step(): void {
    const { w, h, c2, damping } = this;
    const u = this.curr;
    const p = this.prev;
    const n = this.next;
    const sp = this.sponge;

    // 9-point Laplacian: the diagonal terms make propagation isotropic, so
    // rings stay circular instead of drifting square with distance.
    const k = c2 / 6;
    for (let y = 1; y < h - 1; y++) {
      let i = y * w + 1;
      for (let x = 1; x < w - 1; x++, i++) {
        const lap =
          4 * (u[i - 1] + u[i + 1] + u[i - w] + u[i + w]) +
          u[i - w - 1] +
          u[i - w + 1] +
          u[i + w - 1] +
          u[i + w + 1] -
          20 * u[i];
        n[i] = (2 * u[i] - p[i] + k * lap) * damping * sp[i];
      }
    }

    // Neumann borders (zero normal derivative): waves meet the bank without
    // sign inversion; the sponge above decides how much survives the bounce.
    for (let x = 0; x < w; x++) {
      n[x] = n[x + w];
      n[(h - 1) * w + x] = n[(h - 2) * w + x];
    }
    for (let y = 0; y < h; y++) {
      n[y * w] = n[y * w + 1];
      n[y * w + w - 1] = n[y * w + w - 2];
    }

    // rotate buffers
    const old = this.prev;
    this.prev = this.curr;
    this.curr = this.next;
    this.next = old;
  }

  /** Inject a smooth gaussian displacement (a "drop") at grid coords. */
  drop(cx: number, cy: number, radius: number, amp: number): void {
    const { w, h } = this;
    const r = Math.max(1.5, radius);
    const x0 = Math.max(1, Math.floor(cx - r * 2));
    const x1 = Math.min(w - 2, Math.ceil(cx + r * 2));
    const y0 = Math.max(1, Math.floor(cy - r * 2));
    const y1 = Math.min(h - 2, Math.ceil(cy + r * 2));
    const inv = 1 / (r * r * 0.7);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const g = Math.exp(-(dx * dx + dy * dy) * inv);
        if (g > 0.01) this.curr[y * w + x] -= amp * g;
      }
    }
  }

  /** Bilinear height sample at fractional grid coords. */
  sample(fx: number, fy: number): number {
    const { w, h } = this;
    const x = Math.min(Math.max(fx, 0), w - 1.001);
    const y = Math.min(Math.max(fy, 0), h - 1.001);
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const u = this.curr;
    const i = yi * w + xi;
    const a = u[i] + (u[i + 1] - u[i]) * tx;
    const b = u[i + w] + (u[i + w + 1] - u[i + w]) * tx;
    return a + (b - a) * ty;
  }

  /** Central-difference surface gradient at fractional grid coords. */
  gradient(fx: number, fy: number): { gx: number; gy: number } {
    return {
      gx: (this.sample(fx + 1, fy) - this.sample(fx - 1, fy)) * 0.5,
      gy: (this.sample(fx, fy + 1) - this.sample(fx, fy - 1)) * 0.5,
    };
  }

  clear(): void {
    this.curr.fill(0);
    this.prev.fill(0);
    this.next.fill(0);
  }
}
