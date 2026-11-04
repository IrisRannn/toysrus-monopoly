export type Cue = "reward" | "penalty" | "quiz" | "correct" | "finish";

// Original synthesized cues: no external sound downloads or licensed samples.
export class SoundEffects {
  private context = new AudioContext();
  private master = this.context.createGain();
  private voices = new Set<OscillatorNode>();
  private foot = false;
  constructor() {
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);
  }
  async unlock() {
    await this.context.resume();
  }
  volume(value: number) {
    this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.025);
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
    this.voices.add(voice);
    voice.onended = () => {
      this.voices.delete(voice);
      voice.disconnect();
      envelope.disconnect();
    };
    voice.start(at);
    voice.stop(at + duration + 0.02);
  }
  cue(kind: Cue) {
    const notes = kind === "penalty" ? [440, 349.23, 261.63]
      : kind === "quiz" ? [587.33, 783.99]
        : kind === "correct" || kind === "finish" ? [523.25, 659.25, 783.99, 1046.5]
          : [659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => this.note(frequency, index * 0.12, 0.2,
      kind === "penalty" ? "triangle" : "sine", 0.16));
  }
  step() {
    this.foot = !this.foot;
    this.note(this.foot ? 150 : 195, 0, 0.075, "triangle", 0.12);
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
