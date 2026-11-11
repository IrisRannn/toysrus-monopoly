export type Cue = "reward" | "penalty" | "quiz" | "correct" | "finish";

// Original synthesized cues: no external sound downloads or licensed samples.
export class SoundEffects {
  private context = new AudioContext();
  private master = this.context.createGain();
  private voices = new Set<AudioScheduledSourceNode>();
  private noise: AudioBuffer | null = null;
  private foot = false;
  private diceClick = false;
  constructor() {
    this.master.gain.value = 0;
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    this.master.connect(limiter);
    limiter.connect(this.context.destination);
  }
  async unlock() {
    await this.context.resume();
  }
  volume(value: number) {
    this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.025);
  }
  private track(voice: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
    this.voices.add(voice);
    voice.onended = () => {
      this.voices.delete(voice);
      voice.disconnect();
      nodes.forEach((node) => node.disconnect());
    };
  }
  private note(frequency: number, delay: number, duration: number, type: OscillatorType, amplitude: number) {
    const at = this.context.currentTime + delay;
    const voice = this.context.createOscillator();
    const envelope = this.context.createGain();
    voice.type = type;
    voice.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(amplitude, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(envelope);
    envelope.connect(this.master);
    this.track(voice, envelope);
    voice.start(at);
    voice.stop(at + duration + 0.02);
  }
  private air(duration: number, from: number, to: number, amplitude: number) {
    if (!this.noise) {
      this.noise = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.8), this.context.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const at = this.context.currentTime;
    const voice = this.context.createBufferSource();
    voice.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(amplitude, at + Math.min(0.06, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    this.track(voice, filter, envelope);
    voice.start(at);
    voice.stop(at + duration + 0.02);
  }
  private whoosh() {
    this.air(0.65, 450, 4200, 0.85);
    const at = this.context.currentTime;
    const voice = this.context.createOscillator();
    const envelope = this.context.createGain();
    voice.type = "triangle";
    voice.frequency.setValueAtTime(330, at);
    voice.frequency.exponentialRampToValueAtTime(1760, at + 0.5);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.26, at + 0.08);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    voice.connect(envelope);
    envelope.connect(this.master);
    this.track(voice, envelope);
    voice.start(at);
    voice.stop(at + 0.62);
  }
  cue(kind: Cue) {
    const flying = ["reward", "correct", "finish"].includes(kind);
    if (flying) this.whoosh();
    const notes = kind === "penalty" ? [440, 349.23, 261.63]
      : kind === "quiz" ? [587.33, 783.99]
        : kind === "correct" || kind === "finish" ? [523.25, 659.25, 783.99, 1046.5]
          : [659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => this.note(frequency, (flying ? 0.3 : 0) + index * 0.12, 0.24,
      kind === "penalty" ? "triangle" : "sine", 0.32));
  }
  victory() {
    this.stop();
    const melody = [523.25, 523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5];
    const starts = [0, .18, .4, .64, 1, 1.48, 1.76];
    melody.forEach((frequency, i) => {
      this.note(frequency, starts[i], i === melody.length - 1 ? 1.2 : .28, "triangle", .3);
      this.note(frequency / 2, starts[i], .3, "sine", .16);
    });
    [523.25, 659.25, 783.99].forEach((frequency) => this.note(frequency, 1.8, 1.15, "sine", .13));
  }
  roll() {
    this.diceClick = !this.diceClick;
    this.air(0.055, 1800, 900, 0.65);
    this.note(this.diceClick ? 780 : 920, 0, 0.055, "triangle", 0.32);
    this.note(420, 0.035, 0.045, "triangle", 0.22);
  }
  step() {
    this.foot = !this.foot;
    this.note(this.foot ? 150 : 195, 0, 0.12, "triangle", 0.4);
    this.note(this.foot ? 600 : 720, 0.015, 0.06, "sine", 0.16);
  }
  stop() {
    for (const voice of this.voices) {
      try { voice.stop(); } catch { /* A completed note may already be stopping. */ }
    }
  }
  close() {
    this.stop();
    void this.context.close();
  }
}
