import { BEAT } from "./game";

/**
 * Fully synthesized, tempo-locked adaptive soundtrack. No audio files.
 *
 * A lookahead scheduler walks a 16th-note grid anchored to the
 * AudioContext clock — the same anchor the game judges landings against,
 * so what you hear IS the timing grid. Instrument layers (kick, hats,
 * bass, snare, arpeggio, chord pads) each sit behind their own GainNode;
 * combo tier ramps layers in, a combo break ramps them out, and only
 * audible layers get notes scheduled at all.
 *
 * Bar loop: Am — F — C — G.
 */

const S16 = BEAT / 4;

const BASS = [110, 87.31, 130.81, 98]; // A2 F2 C3 G2 per bar
const CHORDS: number[][] = [
  [220, 261.63, 329.63], // Am
  [174.61, 220, 261.63], // F
  [261.63, 329.63, 392], // C
  [196, 246.94, 293.66], // G
];

type LayerName = "tick" | "kick" | "hat" | "bass" | "snare" | "arp" | "pad";
const LAYER_LEVEL: Record<LayerName, number> = {
  tick: 0.05,
  kick: 0.5,
  hat: 0.3,
  bass: 0.34,
  snare: 0.3,
  arp: 0.2,
  pad: 0.16,
};
/** minimum combo tier at which each layer plays */
const LAYER_TIER: Record<LayerName, number> = {
  tick: 0,
  kick: 1,
  hat: 2,
  bass: 2,
  snare: 3,
  arp: 4,
  pad: 5,
};

export class Music {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private layers = {} as Record<LayerName, GainNode>;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private white!: AudioBuffer;
  private enabled = true;

  private anchor = 0;
  private next16 = 0;
  private tier = 0;
  private chaos = 0;

  get started(): boolean {
    return this.ac !== null;
  }

  /** Game/visual clock: audio time once running, wall time before. */
  time(): number {
    return this.ac ? this.ac.currentTime : performance.now() / 1000;
  }

  /** Create the context on the first user gesture. Returns the grid anchor. */
  start(): number {
    if (this.ac) {
      if (this.ac.state === "suspended") void this.ac.resume();
      return this.anchor;
    }
    const ac = new AudioContext();
    this.ac = ac;

    this.master = ac.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ac.destination);

    this.sfx = ac.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    for (const name of Object.keys(LAYER_LEVEL) as LayerName[]) {
      const g = ac.createGain();
      g.gain.value = name === "tick" ? LAYER_LEVEL.tick : 0;
      g.connect(this.master);
      this.layers[name] = g;
    }

    // shared noise source material
    this.white = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const wd = this.white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;

    this.startAmbience();

    this.anchor = ac.currentTime + 0.1;
    this.next16 = 0;
    window.setInterval(() => this.schedule(), 30);
    return this.anchor;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ac) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ac.currentTime, 0.08);
  }

  /** Combo tier 0..5 — ramps instrument layers in and out. */
  setTier(tier: number): void {
    if (tier === this.tier) return;
    const falling = tier < this.tier;
    this.tier = tier;
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (const name of Object.keys(LAYER_TIER) as LayerName[]) {
      const on = tier >= LAYER_TIER[name];
      const target = on ? LAYER_LEVEL[name] : 0;
      // build fast, exhale slowly — mirrors the visual calm-down
      this.layers[name].gain.setTargetAtTime(target, t, on ? 0.18 : falling ? 0.5 : 0.3);
    }
  }

  /** Chaos drives the wind bed's loudness and howl. Called per frame; cheap. */
  setChaos(c: number): void {
    this.chaos = c;
  }

  // ------------------------------------------------------------ ambience

  private startAmbience(): void {
    const ac = this.ac!;
    // water: brown noise, heavily low-passed
    const buf = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
    const d = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < d.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.996;
      d[i] = brown * 12;
    }
    const water = ac.createBufferSource();
    water.buffer = buf;
    water.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300;
    const wg = ac.createGain();
    wg.gain.value = 0.015;
    water.connect(lp).connect(wg).connect(this.master);
    water.start();

    // wind: band-passed noise; chaos opens it up into a howl
    const wind = ac.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    wind.playbackRate.value = 1.7;
    this.windFilter = ac.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.7;
    this.windGain = ac.createGain();
    this.windGain.gain.value = 0.008;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = ac.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(this.windFilter.frequency);
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
    lfo.start();
  }

  // ------------------------------------------------------------ scheduler

  private schedule(): void {
    const ac = this.ac!;
    // wind follows chaos (updated here, off the render loop)
    this.windGain.gain.setTargetAtTime(0.008 + this.chaos * 0.05, ac.currentTime, 0.25);
    this.windFilter.frequency.setTargetAtTime(380 + this.chaos * 420, ac.currentTime, 0.4);

    while (this.anchor + this.next16 * S16 < ac.currentTime + 0.16) {
      this.step(this.next16, this.anchor + this.next16 * S16);
      this.next16++;
    }
  }

  private on(layer: LayerName): boolean {
    return this.tier >= LAYER_TIER[layer];
  }

  /** One 16th-note slot. s = position within the 16-slot bar. */
  private step(n: number, t: number): void {
    const s = n % 16;
    const bar = Math.floor(n / 16) % 4;

    if (s % 4 === 0) this.tickVoice(t); // metronome, every beat
    if (this.on("kick") && s % 4 === 0) this.kick(t);
    if (this.on("hat")) {
      if (s % 2 === 0) this.hat(t, s % 4 === 2);
      else if (this.tier >= 5) this.hat(t, false, 0.5); // storm: full 16ths
    }
    if (this.on("snare") && (s === 4 || s === 12)) this.snare(t);
    if (this.on("bass")) {
      if (s === 0 || s === 8) this.bassNote(t, BASS[bar], 0.3);
      else if (this.tier >= 3 && (s === 6 || s === 11)) this.bassNote(t, BASS[bar] * 1.5, 0.2);
    }
    if (this.on("arp")) {
      const tones = CHORDS[bar];
      const seq = [0, 1, 2, 1];
      const oct = s % 8 < 4 ? 1 : 2;
      this.pluck(t, tones[seq[s % 4]] * oct);
    }
    if (this.on("pad") && s === 0) this.chordSwell(t, CHORDS[bar]);
  }

  // ------------------------------------------------------------ voices

  private tickVoice(t: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.value = 1850;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    o.connect(g).connect(this.layers.tick);
    o.start(t);
    o.stop(t + 0.05);
  }

  private kick(t: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = ac.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    o.connect(g).connect(this.layers.kick);
    o.start(t);
    o.stop(t + 0.2);
  }

  private hat(t: number, accent: boolean, vol = 1): void {
    const ac = this.ac!;
    const n = ac.createBufferSource();
    n.buffer = this.white;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6800;
    const g = ac.createGain();
    g.gain.setValueAtTime((accent ? 0.5 : 0.3) * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (accent ? 0.06 : 0.035));
    n.connect(hp).connect(g).connect(this.layers.hat);
    n.start(t, Math.random() * 0.5, 0.08);
  }

  private snare(t: number): void {
    const ac = this.ac!;
    const n = ac.createBufferSource();
    n.buffer = this.white;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1750;
    bp.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    n.connect(bp).connect(g).connect(this.layers.snare);
    n.start(t, Math.random() * 0.5, 0.2);

    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.value = 185;
    const og = ac.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(og).connect(this.layers.snare);
    o.start(t);
    o.stop(t + 0.08);
  }

  private bassNote(t: number, f: number, dur: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.012);
    g.gain.setTargetAtTime(0, t + dur * 0.6, 0.07);
    o.connect(lp).connect(g).connect(this.layers.bass);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  private pluck(t: number, f: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    const o2 = ac.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = f * 1.005;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(this.layers.arp);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.2);
    o2.stop(t + 0.2);
  }

  private chordSwell(t: number, tones: number[]): void {
    const ac = this.ac!;
    const barDur = BEAT * 4;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 950;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + barDur * 0.35);
    g.gain.setTargetAtTime(0, t + barDur * 0.7, 0.25);
    lp.connect(g).connect(this.layers.pad);
    for (const f of tones) {
      for (const det of [-6, 6]) {
        const o = ac.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + barDur + 0.5);
      }
    }
  }

  // ------------------------------------------------------------ SFX

  /** Takeoff chirp; brightens with combo tier. */
  jump(tier: number): void {
    if (!this.ac) return;
    const ac = this.ac;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = "sine";
    const base = 300 * (1 + tier * 0.07);
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.8, t + 0.08);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Landing plip (pitch rises with tier); perfect adds a bell sparkle. */
  land(judgment: "perfect" | "good" | "miss", tier: number): void {
    if (!this.ac) return;
    const ac = this.ac;
    const t = ac.currentTime;
    const pitch = 1 + tier * 0.09;

    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(540 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(165 * pitch, t + 0.15);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.24);

    const n = ac.createBufferSource();
    n.buffer = this.white;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1050 * pitch;
    bp.Q.value = 2.5;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.12, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(bp).connect(ng).connect(this.sfx);
    n.start(t, Math.random() * 0.5, 0.1);

    if (judgment === "perfect") {
      for (const [f, dt, v] of [
        [1318.5, 0, 0.07],
        [1975.5, 0.05, 0.05],
      ] as const) {
        const bo = ac.createOscillator();
        bo.type = "sine";
        bo.frequency.value = f * (1 + tier * 0.02);
        const bg = ac.createGain();
        bg.gain.setValueAtTime(0, t + dt);
        bg.gain.linearRampToValueAtTime(v, t + dt + 0.01);
        bg.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.35);
        bo.connect(bg).connect(this.sfx);
        bo.start(t + dt);
        bo.stop(t + dt + 0.4);
      }
    }
  }

  /** Combo break: a soft falling sigh, never a punishment buzzer. */
  miss(): void {
    if (!this.ac) return;
    const ac = this.ac;
    const t = ac.currentTime;
    for (const [f0, f1, dt] of [
      [392, 185, 0],
      [294, 147, 0.09],
    ] as const) {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f0, t + dt);
      o.frequency.exponentialRampToValueAtTime(f1, t + dt + 0.32);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.09, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.38);
      o.connect(g).connect(this.sfx);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
    }
  }
}
