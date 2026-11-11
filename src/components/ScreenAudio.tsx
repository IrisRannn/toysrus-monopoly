import { useEffect, useRef, useState } from "react";
import { SoundEffects } from "../audio/SoundEffects";
import type { GameState } from "../types";

export default function ScreenAudio({ state, offset, surface = "screen" }: {
  state: GameState; offset: number; surface?: "screen" | "player";
}) {
  const device = surface === "player" ? "手机" : "大屏";
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [victoryPlaying, setVictoryPlaying] = useState(false);
  const effects = useRef<SoundEffects | null>(null);
  const media = useRef<HTMLAudioElement>(null);
  const latest = useRef({ state, offset, enabled, muted });
  latest.current = { state, offset, enabled, muted };
  const lastPresentation = useRef<string | null>(null);
  const motion = useRef({ id: "", step: -1 });
  const seenVictory = useRef<string | null | undefined>(undefined);

  useEffect(() => () => effects.current?.close(), []);
  useEffect(() => {
    const id = state.victory?.id || null;
    if (seenVictory.current === undefined) { seenVictory.current = id; return; }
    if (seenVictory.current === id) return;
    seenVictory.current = id;
    if (!id || state.status !== "champion" || !enabled || muted || !state.audio.effectsEnabled) return;
    effects.current?.victory();
    setVictoryPlaying(true);
    const timer = setTimeout(() => setVictoryPlaying(false), 3200);
    return () => { clearTimeout(timer); setVictoryPlaying(false); };
  }, [state.victory?.id]);
  useEffect(() => {
    if (!enabled || muted || !state.audio.effectsEnabled || state.status !== "running" || state.phase !== "rolling") return;
    effects.current?.roll();
    const timer = setInterval(() => effects.current?.roll(), 95);
    return () => clearInterval(timer);
  }, [enabled, muted, state.audio.effectsEnabled, state.status, state.phase, state.dice?.at]);
  useEffect(() => {
    effects.current?.volume(enabled && !muted && state.audio.effectsEnabled ? state.audio.effectsVolume : 0);
    if (muted || !state.audio.effectsEnabled || state.status === "paused") effects.current?.stop();
  }, [enabled, muted, state.audio.effectsEnabled, state.audio.effectsVolume, state.status]);
  useEffect(() => {
    const event = state.presentation;
    if (!event || lastPresentation.current === event.id) return;
    lastPresentation.current = event.id;
    if (enabled && !muted && state.audio.effectsEnabled && state.status === "running" &&
        event.endsAt > Date.now() + offset) effects.current?.cue(event.kind);
  }, [state.presentation?.id, state.status, enabled, muted, state.audio.effectsEnabled]);
  useEffect(() => {
    const timer = setInterval(() => {
      const { state: s, offset: clock, enabled: on, muted: silent } = latest.current;
      const m = s.movement;
      if (!m || s.phase !== "moving" || s.status !== "running") return;
      const distance = Math.abs(m.to - m.from);
      const time = Date.now() + clock;
      if (!distance || time < m.startedAt || time >= m.startedAt + m.duration) return;
      const id = m.id || `${s.turnId}:${m.team}:${m.kind}:${s.dice?.at}`;
      const step = Math.min(distance - 1, Math.floor((time - m.startedAt) / m.duration * distance));
      const changed = motion.current.id !== id || step > motion.current.step;
      if (changed) motion.current = { id, step };
      if (changed && on && !silent && s.audio.effectsEnabled) effects.current?.step();
    }, 80);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const audio = media.current;
    if (!audio) return;
    const action = victoryPlaying || (state.audio.effectsEnabled && state.status === "running" &&
      (state.presentation || state.phase === "rolling" || state.phase === "moving"));
    audio.volume = state.audio.bgmVolume * (action ? 0.18 : 1);
    audio.muted = !enabled || muted;
    if (enabled && !muted && state.audio.bgmEnabled && state.audio.bgm) {
      void audio.play().catch((reason) => {
        if (reason.name !== "AbortError" && latest.current.state.audio.bgmEnabled)
          setError("音乐未能播放，请再次点击声音按钮");
      });
    } else audio.pause();
    if (!state.audio.bgm) setError("");
  }, [enabled, muted, state.audio.bgm?.id, state.audio.bgmEnabled, state.audio.bgmVolume,
    state.audio.effectsEnabled, state.presentation?.id, state.phase, state.status, victoryPlaying]);

  async function toggle() {
    setError("");
    if (enabled && !muted && !error) {
      setMuted(true);
      effects.current?.stop();
      media.current?.pause();
      return;
    }
    try {
      effects.current ||= new SoundEffects();
      await effects.current.unlock();
      setEnabled(true);
      setMuted(false);
      if (state.audio.bgmEnabled && state.audio.bgm) {
        await media.current?.play();
      }
    } catch {
      setError("请再次点击开启声音，并确认设备音量已打开");
    }
  }
  return (
    <div className={surface === "player" ? "screen-audio player-audio" : "screen-audio"}>
      <button type="button" onClick={() => void toggle()} aria-pressed={enabled && !muted}
        aria-label={error ? `重试${device}声音` : !enabled ? `开启${device}声音` : muted ? `恢复${device}声音` : `静音${device}`}>
        {error ? "♪ 重试开启声音" : !enabled ? `♪ 开启${device}声音` : muted ? "♪ 已静音" : "♪ 声音已开启"}
      </button>
      {error && <span role="alert">{error}</span>}
      <audio ref={media} className="screen-bgm" src={state.audio.bgm?.url} loop preload="none"
        onCanPlay={() => setError("")}
        onError={() => { if (state.audio.bgm) setError("音乐文件暂不可用，请主持人检查或重新上传"); }} />
    </div>
  );
}
