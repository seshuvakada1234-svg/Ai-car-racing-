import { CarAudioSystem } from "../utils/carAudio";

export class EngineSoundSystem {
  private ctx: AudioContext | null = null;
  private mainOsc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private active = false;

  constructor() {}

  private init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // Main sawtooth growl Oscillator
      this.mainOsc = this.ctx.createOscillator();
      this.mainOsc.type = "sawtooth";

      // Sub frequency triangle Oscillator
      this.subOsc = this.ctx.createOscillator();
      this.subOsc.type = "triangle";

      // Dynamic lowpass filter to muffle or open exhaust tones
      this.lowpass = this.ctx.createBiquadFilter();
      this.lowpass.type = "lowpass";
      this.lowpass.Q.value = 3.5;

      // Master output volume gain
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);

      this.mainOsc.connect(this.lowpass);
      this.subOsc.connect(this.lowpass);
      this.lowpass.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);

      this.mainOsc.start(0);
      this.subOsc.start(0);

      this.active = true;
    } catch (err) {
      console.warn("Web Audio Engine failed to load:", err);
    }
  }

  public setSpeed(speed: number, isNitro: boolean, isPaused: boolean, soundEnabled: boolean, state: string) {
    if (!soundEnabled || isPaused || (state !== "racing" && state !== "countdown")) {
      if (this.gainNode && this.ctx) {
        this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08); // fade out
      }
      return;
    }

    if (!this.ctx) {
      this.init();
    }

    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    if (!this.active || !this.ctx) return;

    const absSpeed = Math.abs(speed);
    const speedKmh = absSpeed * 3.6;

    let gear = 1;
    let minG = 0;
    let maxG = 40;

    if (speedKmh > 210) {
      gear = 6;
      minG = 210;
      maxG = 340;
    } else if (speedKmh > 160) {
      gear = 5;
      minG = 160;
      maxG = 210;
    } else if (speedKmh > 115) {
      gear = 4;
      minG = 115;
      maxG = 160;
    } else if (speedKmh > 75) {
      gear = 3;
      minG = 75;
      maxG = 115;
    } else if (speedKmh > 40) {
      gear = 2;
      minG = 40;
      maxG = 75;
    }

    const ratio = Math.max(0, Math.min(1.0, (speedKmh - minG) / (maxG - minG)));
    const rpm = 800 + ratio * 6400; // 800 to 7200 RPM

    const fundamental = (rpm / 60) * 1.4;
    const t = this.ctx.currentTime;

    if (this.mainOsc) {
      this.mainOsc.frequency.setTargetAtTime(fundamental, t, 0.06);
    }
    if (this.subOsc) {
      this.subOsc.frequency.setTargetAtTime(fundamental * 0.5, t, 0.06);
    }

    if (this.lowpass) {
      const lpfFreq = 180 + (rpm / 7200) * 1600 + (isNitro ? 500 : 0);
      this.lowpass.frequency.setTargetAtTime(lpfFreq, t, 0.06);
    }

    if (this.gainNode) {
      let vol = 0.06 + (rpm / 7200) * 0.12;
      if (isNitro) vol *= 1.35;
      this.gainNode.gain.setTargetAtTime(vol, t, 0.04);
    }
  }

  public dispose() {
    this.active = false;
    try {
      if (this.ctx) {
        this.ctx.close();
      }
    } catch (e) {}
  }
}

export class AudioSystem {
  public static initialized = false;
  public engineSynth = new EngineSoundSystem();
  public sampleAudio: CarAudioSystem | null = null;

  constructor() {
    AudioSystem.initialized = true;
  }

  /**
   * Translates real-time speeds and telemetry filters to procedural oscillators.
   */
  public update(
    speed: number,
    isNitroActive: boolean,
    isDrifting: boolean,
    isPaused: boolean,
    soundEnabled: boolean,
    gameState: string,
  ): void {
    // 1. Update primary synthesizer volume/RPM curve
    this.engineSynth.setSpeed(speed, isNitroActive, isPaused, soundEnabled, gameState);

    // 2. Play telemetry-dependent skid or launch sample files
    if (!this.sampleAudio) {
      this.sampleAudio = new CarAudioSystem();
    }

    const isRacingActive = gameState === "racing" || gameState === "countdown";
    this.sampleAudio.update(speed, isNitroActive, isDrifting, isPaused, soundEnabled, isRacingActive);
  }

  public destroy(): void {
    this.engineSynth.dispose();
    if (this.sampleAudio) {
      this.sampleAudio.dispose();
      this.sampleAudio = null;
    }
  }
}
export default AudioSystem;
