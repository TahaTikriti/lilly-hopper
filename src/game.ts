/**
 * Rhythm core: a steady beat grid, landing judgment against it, combo /
 * score bookkeeping, and the chaos level that everything else reads.
 *
 * The clock is injected (the audio engine's clock once sound starts, so the
 * judgment grid and the music grid are literally the same timeline).
 */

export const BPM = 100;
export const BEAT = 60 / BPM;

export type Judgment = "perfect" | "good" | "miss";

const PERFECT_WIN = 0.085; // seconds either side of the beat
const GOOD_WIN = 0.18;

export interface HitResult {
  judgment: Judgment;
  combo: number;
  mult: number;
  gained: number;
  tier: number;
  tierChanged: boolean;
}

/** combo thresholds for audio/visual tiers 1..5 */
const TIERS = [2, 6, 10, 16, 24];

export function tierOf(combo: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (combo >= TIERS[i]) t = i + 1;
  return t;
}

export class Game {
  score = 0;
  high = 0;
  combo = 0;
  chaos = 0; // smoothed, 0..1 — read by water, weather, pads, music
  private anchor = 0; // beat-grid origin on the injected clock

  constructor(private readonly now: () => number) {
    this.anchor = now();
  }

  /** Re-anchor the grid (called once when the audio clock takes over). */
  rebase(anchor: number): void {
    this.anchor = anchor;
  }

  /** Continuous beat phase: 0 exactly on a beat, rising to 1 at the next. */
  phase(): number {
    const p = ((this.now() - this.anchor) / BEAT) % 1;
    return p < 0 ? p + 1 : p;
  }

  /** Judge a landing at clock time t against the nearest beat. */
  judge(t: number): HitResult {
    const p = ((t - this.anchor) / BEAT) % 1;
    const off = Math.min(p, 1 - p) * BEAT; // seconds from nearest beat

    const before = tierOf(this.combo);
    let judgment: Judgment;
    let gained = 0;
    if (off <= PERFECT_WIN) {
      judgment = "perfect";
      this.combo++;
      gained = 100 * this.mult;
    } else if (off <= GOOD_WIN) {
      judgment = "good";
      this.combo++;
      gained = 50 * this.mult;
    } else {
      judgment = "miss";
      this.combo = 0; // the storm exhales — chaos target drops with it
    }
    this.score += gained;
    if (this.score > this.high) this.high = this.score;

    const tier = tierOf(this.combo);
    return {
      judgment,
      combo: this.combo,
      mult: this.mult,
      gained,
      tier,
      tierChanged: tier !== before,
    };
  }

  get mult(): number {
    return 1 + Math.floor(this.combo / 5);
  }

  get chaosTarget(): number {
    return Math.min(1, this.combo / 24);
  }

  /** Smooth chaos toward its combo-driven target: slow build, gentle calm. */
  update(dt: number): void {
    const target = this.chaosTarget;
    const rate = target > this.chaos ? 0.45 : 1.1;
    this.chaos += (target - this.chaos) * Math.min(1, dt * rate);
    if (this.chaos < 0.001) this.chaos = 0;
  }
}
