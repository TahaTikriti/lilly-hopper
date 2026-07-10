/**
 * Fully synthesized sound — no audio assets. A "plip" is a sine with a fast
 * downward pitch sweep plus a tiny band-passed noise burst; the ambience is
 * a quiet loop of low-passed noise, slowly breathing via an LFO.
 * The context is created lazily on the first user gesture (autoplay rules).
 */
export class SoundScape {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;

  /** Call from any user-gesture handler before making sound. */
  ensure(): void {
    if (!this.ac) {
      this.ac = new AudioContext();
      this.master = this.ac.createGain();
      this.master.gain.value = this.enabled ? 0.85 : 0;
      this.master.connect(this.ac.destination);
      this.startAmbience();
    }
    if (this.ac.state === "suspended") void this.ac.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ac && this.master) {
      this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ac.currentTime, 0.1);
    }
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ac = this.ac!;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
    const d = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < d.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.996;
      d[i] = brown * 12;
    }
    return buf;
  }

  private startAmbience(): void {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer(3);
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 340;
    const g = ac.createGain();
    g.gain.value = 0.016;
    // slow swell, like air moving over water
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 0.007;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    lfo.start();
  }

  /** Small water droplet. vol 0..1, pitch multiplier around 1. */
  plip(vol = 1, pitch = 1): void {
    if (!this.ac || !this.master || !this.enabled) return;
    const ac = this.ac;
    const t = ac.currentTime;

    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(560 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(170 * pitch, t + 0.16);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42 * vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.26);

    const n = ac.createBufferSource();
    n.buffer = this.noiseBuffer(0.09);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1100 * pitch;
    bp.Q.value = 3;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.14 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t);
  }

  /** Heavier landing splash: low plip plus a longer washed noise burst. */
  splash(vol = 1): void {
    if (!this.ac || !this.master || !this.enabled) return;
    this.plip(vol, 0.72);
    const ac = this.ac;
    const t = ac.currentTime;
    const n = ac.createBufferSource();
    n.buffer = this.noiseBuffer(0.35);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.22 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t);
  }
}
