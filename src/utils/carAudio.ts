/**
 * High-fidelity, synthesized procedural supercar audio engine.
 * Synthesizes engine RPM, gear shifting, mechanical turbo whistle, drifting tire squeal and nitro combustion flares
 * using raw Web Audio API oscillators and filters to guarantee zero network latency and no external assets.
 */
export class CarAudioSystem {
  private ctx: AudioContext | null = null;

  // Oscillators and gains
  private mainOsc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private lowpassFilter: BiquadFilterNode | null = null;

  // Noise synthesis for tires and nitro
  private noiseNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;
  private nitroFilter: BiquadFilterNode | null = null;
  private nitroGain: GainNode | null = null;

  private masterGain: GainNode | null = null;
  private active = false;
  private lastGear = 1;

  constructor() {}

  /**
   * Initializes raw synthesizer node assembly graph
   */
  public init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // 1. Create Master volume guard
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // 2. Main sawtooth exhaust growler
      this.mainOsc = this.ctx.createOscillator();
      this.mainOsc.type = "sawtooth";

      // 3. Sub frequency cylinder bass rumble
      this.subOsc = this.ctx.createOscillator();
      this.subOsc.type = "triangle";

      // 4. High-pitched supercharger/turbo spool whistling
      this.turboOsc = this.ctx.createOscillator();
      this.turboOsc.type = "sine";
      this.turboOsc.frequency.setValueAtTime(1000, this.ctx.currentTime);

      const turboGain = this.ctx.createGain();
      turboGain.gain.setValueAtTime(0.005, this.ctx.currentTime);
      this.turboOsc.connect(turboGain);

      // Lowpass exhaust filter
      this.lowpassFilter = this.ctx.createBiquadFilter();
      this.lowpassFilter.type = "lowpass";
      this.lowpassFilter.Q.value = 3.2;

      this.mainOsc.connect(this.lowpassFilter);
      this.subOsc.connect(this.lowpassFilter);

      const exhaustGain = this.ctx.createGain();
      exhaustGain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      this.lowpassFilter.connect(exhaustGain);
      exhaustGain.connect(this.masterGain);
      turboGain.connect(this.masterGain);

      // 5. Build drift white noise generator for squeal effects
      this.createNoiseGenerator();

      // Start all sound oscillators
      this.mainOsc.start(0);
      this.subOsc.start(0);
      this.turboOsc.start(0);

      this.active = true;
    } catch (err) {
      console.warn("Procedural Audio failed to initialize:", err);
    }
  }

  /**
   * Procedural noise generator node using ScriptProcessor for maximum backward browser and mobile compatibility
   */
  private createNoiseGenerator() {
    if (!this.ctx || !this.masterGain) return;

    try {
      // Create simple white noise buffer
      const bufferSize = 2 * this.ctx.sampleRate;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      // Filter noise for squealing tires (bandpass high resonance)
      this.tireFilter = this.ctx.createBiquadFilter();
      this.tireFilter.type = "bandpass";
      this.tireFilter.frequency.setValueAtTime(850, this.ctx.currentTime);
      this.tireFilter.Q.value = 4.5;

      this.tireGain = this.ctx.createGain();
      this.tireGain.gain.setValueAtTime(0, this.ctx.currentTime);

      // Filter noise for rocket nitro wind gusts (lowpass fluffy rumble)
      this.nitroFilter = this.ctx.createBiquadFilter();
      this.nitroFilter.type = "lowpass";
      this.nitroFilter.frequency.setValueAtTime(320, this.ctx.currentTime);

      this.nitroGain = this.ctx.createGain();
      this.nitroGain.gain.setValueAtTime(0, this.ctx.currentTime);

      // Build connections
      noiseSource.connect(this.tireFilter);
      this.tireFilter.connect(this.tireGain);
      this.tireGain.connect(this.masterGain);

      noiseSource.connect(this.nitroFilter);
      this.nitroFilter.connect(this.nitroGain);
      this.nitroGain.connect(this.masterGain);

      noiseSource.start(0);
    } catch (e) {
      console.warn("White noise synth connection failed:", e);
    }
  }

  /**
   * Refined audio ticks matching gears, speeds, nitro states, and drift slides.
   */
  public update(
    speed: number,
    isNitro: boolean,
    isDrifting: boolean,
    isPaused: boolean,
    soundEnabled: boolean,
    isPlaying: boolean,
  ) {
    if (!soundEnabled || isPaused || !isPlaying) {
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08); // quiet fade out
      }
      return;
    }

    if (!this.ctx) {
      this.init();
    }

    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    if (!this.active || !this.ctx || !this.masterGain) return;

    const absSpeed = Math.abs(speed);
    const speedKmh = absSpeed * 3.6;
    const t = this.ctx.currentTime;

    // --- 1. MULTI-GEAR TRANSMISSION RATIOS ---
    let gear = 1;
    let minG = 0;
    let maxG = 40;

    if (speedKmh > 215) {
      gear = 6;
      minG = 215;
      maxG = 340;
    } else if (speedKmh > 165) {
      gear = 5;
      minG = 165;
      maxG = 215;
    } else if (speedKmh > 115) {
      gear = 4;
      minG = 115;
      maxG = 165;
    } else if (speedKmh > 75) {
      gear = 3;
      minG = 75;
      maxG = 115;
    } else if (speedKmh > 40) {
      gear = 2;
      minG = 40;
      maxG = 75;
    }

    // Play slight transmission layout dip on Gear shift update to simulate gear changes!
    if (gear !== this.lastGear) {
      this.lastGear = gear;
      // Instant exhaust frequency dip and slow recovery
      if (this.mainOsc) {
        this.mainOsc.frequency.setValueAtTime(65, t);
      }
    }

    const ratio = Math.max(0, Math.min(1.0, (speedKmh - minG) / (maxG - minG)));
    const rpm = 800 + ratio * 6400; // 800 to 7200 RPM

    // Base exhaust ignition frequency
    const baseExhaustFreq = (rpm / 60) * 1.55;

    if (this.mainOsc) {
      this.mainOsc.frequency.setTargetAtTime(baseExhaustFreq, t, 0.07);
    }
    if (this.subOsc) {
      this.subOsc.frequency.setTargetAtTime(baseExhaustFreq * 0.5, t, 0.07);
    }

    // Lowpass filter muffles or sweeps based on throttle RPM
    if (this.lowpassFilter) {
      const lpfFreq = 160 + (rpm / 7200) * 1450 + (isNitro ? 650 : 0);
      this.lowpassFilter.frequency.setTargetAtTime(lpfFreq, t, 0.06);
    }

    // --- 2. TURBO/SUPERCHARGER WHISTLE (SPOOLING) ---
    if (this.turboOsc) {
      // Spools proportionally to gear RPM, up to 1500Hz
      const turboPitch = 850 + (rpm / 7200) * 1100 + (isNitro ? 400 : 0);
      this.turboOsc.frequency.setTargetAtTime(turboPitch, t, 0.12);
    }

    // --- 3. DYNAMIC LEVEL MIXING (VOLUME CONTROLS) ---
    let masterVol = 0.065 + (rpm / 7200) * 0.125;
    if (isNitro) masterVol *= 1.45;
    this.masterGain.gain.setTargetAtTime(masterVol, t, 0.04);

    // --- 4. TIRE SQUEAL White Noise Mix (Drifting) ---
    if (this.tireGain) {
      const isSideSlopSqueal = isDrifting && speedKmh > 30;
      const targetTireVol = isSideSlopSqueal ? Math.min(0.042, 0.015 + (speedKmh / 300) * 0.03) : 0;
      this.tireGain.gain.setTargetAtTime(targetTireVol, t, 0.08);

      if (this.tireFilter && isSideSlopSqueal) {
        // Drifting tires squeal at slightly higher pitch at high speeds
        const tireFreq = 780 + (speedKmh / 300) * 450 + Math.sin(Date.now() * 0.05) * 50;
        this.tireFilter.frequency.setTargetAtTime(tireFreq, t, 0.05);
      }
    }

    // --- 5. NITRO combustion winds noise boost ---
    if (this.nitroGain) {
      const targetNitroVol = isNitro ? 0.055 : 0;
      this.nitroGain.gain.setTargetAtTime(targetNitroVol, t, 0.08);
    }
  }

  /**
   * Securely disposes of the Audio Context to release hardware channels
   */
  public dispose() {
    this.active = false;
    try {
      if (this.ctx) {
        this.ctx.close();
      }
    } catch (e) {}
  }
}
export default CarAudioSystem;
