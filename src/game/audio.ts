/* Procedural WebAudio SFX — no assets, everything synthesized. */

export class SFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("gs-muted") === "1";
    } catch {
      this.muted = false;
    }
  }

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
    try {
      localStorage.setItem("gs-muted", m ? "1" : "0");
    } catch {
      /* noop */
    }
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, gain: number, freq: number, q = 1, delay = 0, type: BiquadFilterType = "lowpass") {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  /* ---- weapons ---- */
  pistol() {
    this.burst(0.09, 0.5, 3200, 0.8);
    this.tone("square", 340, 90, 0.08, 0.25);
  }
  smg() {
    this.burst(0.06, 0.34, 3800, 0.7);
    this.tone("square", 420, 140, 0.05, 0.16);
  }
  shotgun() {
    this.burst(0.22, 0.7, 2400, 0.6);
    this.burst(0.32, 0.4, 700, 0.5, 0.02);
    this.tone("square", 190, 50, 0.18, 0.3);
  }
  rifle() {
    this.burst(0.14, 0.5, 5200, 1.4, 0, "bandpass");
    this.tone("sawtooth", 900, 120, 0.16, 0.22);
  }
  dryFire() {
    this.tone("square", 900, 700, 0.03, 0.12);
  }
  reload() {
    this.burst(0.04, 0.25, 2500, 2, 0, "highpass");
    this.tone("square", 500, 320, 0.05, 0.15, 0.08);
    this.burst(0.05, 0.3, 2000, 2, 0.35, "highpass");
  }

  /* ---- combat feedback ---- */
  hit() {
    this.burst(0.05, 0.3, 1400, 1);
    this.tone("triangle", 260, 120, 0.06, 0.2);
  }
  splat() {
    this.burst(0.12, 0.42, 900, 0.7);
    this.tone("sine", 160, 50, 0.12, 0.3);
  }
  crit() {
    this.tone("square", 720, 1400, 0.07, 0.14);
  }
  hurt() {
    this.tone("sawtooth", 220, 70, 0.25, 0.4);
    this.burst(0.18, 0.3, 500, 0.6);
  }
  dash() {
    this.burst(0.12, 0.2, 3000, 0.8, 0, "highpass");
  }
  down() {
    this.tone("sawtooth", 260, 42, 0.7, 0.45);
    this.burst(0.5, 0.4, 600, 0.5);
  }
  respawn() {
    this.tone("triangle", 300, 900, 0.3, 0.38);
    this.burst(0.25, 0.3, 2400, 0.7, 0, "highpass");
  }
  tick() {
    this.tone("square", 660, 660, 0.06, 0.22);
  }
  explode() {
    this.burst(0.5, 0.8, 900, 0.4);
    this.tone("sine", 120, 28, 0.5, 0.6);
    this.burst(0.3, 0.4, 3000, 0.5, 0.02, "highpass");
  }
  bombPin() {
    this.tone("square", 1200, 900, 0.04, 0.14);
    this.burst(0.05, 0.2, 2600, 1.5, 0, "highpass");
  }
  bombBlast() {
    this.tone("sine", 150, 22, 0.85, 0.75);
    this.burst(0.75, 0.85, 1100, 0.35);
    this.burst(0.45, 0.5, 4200, 0.5, 0.02, "highpass");
    this.tone("sawtooth", 90, 30, 0.6, 0.35, 0.03);
  }
  spit() {
    this.tone("sine", 500, 180, 0.12, 0.2);
  }
  acid() {
    this.burst(0.1, 0.25, 1800, 2, 0, "bandpass");
  }
  zdie() {
    this.tone("sawtooth", 140 + Math.random() * 60, 40, 0.3, 0.22);
  }

  /* ---- game flow ---- */
  pickup() {
    this.tone("triangle", 520, 520, 0.07, 0.22);
    this.tone("triangle", 780, 780, 0.09, 0.22, 0.07);
  }
  medkit() {
    this.tone("sine", 400, 800, 0.18, 0.25);
  }
  nuke() {
    this.tone("sine", 1400, 60, 0.7, 0.5);
    this.burst(0.8, 0.7, 2000, 0.3, 0.05);
  }
  waveHorn() {
    this.tone("sawtooth", 110, 110, 0.32, 0.3);
    this.tone("sawtooth", 165, 165, 0.32, 0.22, 0.02);
    this.tone("sawtooth", 220, 108, 0.5, 0.28, 0.36);
  }
  waveClear() {
    this.tone("triangle", 392, 392, 0.1, 0.25);
    this.tone("triangle", 494, 494, 0.1, 0.25, 0.1);
    this.tone("triangle", 587, 587, 0.2, 0.28, 0.2);
  }
  gameOver() {
    this.tone("sawtooth", 220, 55, 1.1, 0.4);
    this.tone("sawtooth", 165, 41, 1.3, 0.3, 0.15);
    this.burst(0.9, 0.3, 400, 0.5, 0.1);
  }
  uiClick() {
    this.tone("square", 640, 480, 0.05, 0.15);
  }
  heart() {
    this.tone("sine", 70, 45, 0.12, 0.3);
  }
}
