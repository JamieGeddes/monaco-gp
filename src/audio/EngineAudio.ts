import { IDLE_RPM, LIMITER_RPM } from '../car/Drivetrain';

const TAU = 0.025; // setTargetAtTime smoothing

/**
 * Fully synthesized V6-turbo engine: detuned saws + harmonic square through a tanh
 * waveshaper and throttle-tracked lowpass, plus exhaust rasp, turbo whine, and
 * wind/road noise. Firing frequency f0 = RPM/60 * 3 (six cylinders, four-stroke).
 */
export class EngineAudio {
  private ctx: AudioContext;
  private master: GainNode;

  private osc1: OscillatorNode;
  private osc2: OscillatorNode;
  private osc3: OscillatorNode;
  private engineGain: GainNode;
  private shaper: WaveShaperNode;
  private lowpass: BiquadFilterNode;

  private raspGain: GainNode;
  private raspFilter: BiquadFilterNode;
  private whineOsc: OscillatorNode;
  private whineGain: GainNode;
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private noiseBuffer: AudioBuffer;

  private muted = true;

  constructor() {
    this.ctx = new AudioContext();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // --- noise buffer (shared)
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // --- engine core: osc mix -> waveshaper -> lowpass -> master
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this.makeShaperCurve(3);
    this.shaper.oversample = '2x';
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 800;
    this.lowpass.Q.value = 0.8;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.5;
    this.shaper.connect(this.lowpass);
    this.lowpass.connect(this.engineGain);
    this.engineGain.connect(this.master);

    const mkOsc = (type: OscillatorType, gain: number, detune: number): [OscillatorNode, GainNode] => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(this.shaper);
      o.start();
      return [o, g];
    };
    [this.osc1] = mkOsc('sawtooth', 0.45, 0);
    [this.osc2] = mkOsc('sawtooth', 0.3, 9);
    [this.osc3] = mkOsc('square', 0.18, -7);

    // --- exhaust rasp: bandpass noise, throttle-gated
    const rasp = ctx.createBufferSource();
    rasp.buffer = this.noiseBuffer;
    rasp.loop = true;
    this.raspFilter = ctx.createBiquadFilter();
    this.raspFilter.type = 'bandpass';
    this.raspFilter.frequency.value = 900;
    this.raspFilter.Q.value = 1.4;
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0;
    rasp.connect(this.raspFilter);
    this.raspFilter.connect(this.raspGain);
    this.raspGain.connect(this.master);
    rasp.start();

    // --- turbo whine
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'sine';
    this.whineOsc.frequency.value = 3000;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain);
    this.whineGain.connect(this.master);
    this.whineOsc.start();

    // --- wind/road noise
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    wind.playbackRate.value = 0.7;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    wind.start();
  }

  private makeShaperCurve(drive: number): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }

  /** Must be called from a user gesture (autoplay policy). */
  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** Debug probe for automated tests. */
  probe(): { state: string; master: number; f0: number; lowpass: number } {
    return {
      state: this.ctx.state,
      master: +this.master.gain.value.toFixed(3),
      f0: +this.osc1.frequency.value.toFixed(1),
      lowpass: +this.lowpass.frequency.value.toFixed(0),
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : 0.9, t, 0.08);
  }

  /** Per-frame parameter update from physics state. */
  update(rpm: number, throttle: number, speedMs: number): void {
    if (this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const f0 = (rpm / 60) * 3; // V6 four-stroke firing frequency
    const rpmNorm = Math.min((rpm - IDLE_RPM) / (LIMITER_RPM - IDLE_RPM), 1);

    this.osc1.frequency.setTargetAtTime(f0, t, TAU);
    this.osc2.frequency.setTargetAtTime(f0 / 2, t, TAU);
    this.osc3.frequency.setTargetAtTime(f0 * 2, t, TAU);
    this.lowpass.frequency.setTargetAtTime(600 + 5500 * throttle + 2500 * rpmNorm, t, TAU);
    this.engineGain.gain.setTargetAtTime(0.34 + 0.2 * throttle + 0.12 * rpmNorm, t, TAU);

    this.raspFilter.frequency.setTargetAtTime(Math.min(2 * f0, 4000), t, TAU);
    this.raspGain.gain.setTargetAtTime(0.16 * throttle, t, TAU);

    this.whineOsc.frequency.setTargetAtTime(2600 + 6500 * rpmNorm, t, TAU);
    this.whineGain.gain.setTargetAtTime(0.014 * rpmNorm * (0.4 + 0.6 * throttle), t, TAU);

    const windNorm = Math.min(speedMs / 85, 1);
    this.windFilter.frequency.setTargetAtTime(280 + 900 * windNorm, t, TAU);
    this.windGain.gain.setTargetAtTime(windNorm * windNorm * 0.4, t, TAU);

    // overrun crackle on closed throttle at high rpm
    if (throttle < 0.05 && rpm > 8800 && Math.random() < 0.12) this.pop(0.25 + Math.random() * 0.3);
  }

  /** Gear-shift effect: short torque-cut dip + crack. */
  shift(): void {
    if (this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const g = this.engineGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.12, t + 0.02);
    g.setValueAtTime(0.12, t + 0.07);
    g.linearRampToValueAtTime(0.55, t + 0.1);
    this.pop(0.5);
  }

  /** Short highpassed noise burst (shift crack / overrun pop). */
  private pop(amp: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.5;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 1.5, 0.08);
  }
}
