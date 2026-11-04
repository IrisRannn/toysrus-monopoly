import { useEffect, useState } from "react";
import { tokenKey, request, type GameConnection } from "../hooks/useGame";
import type { GameState } from "../types";

export default function AudioControls({ game, state }: { game: GameConnection; state: GameState }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [effectsVolume, setEffectsVolume] = useState(state.audio.effectsVolume);
  const [bgmVolume, setBgmVolume] = useState(state.audio.bgmVolume);
  useEffect(() => setEffectsVolume(state.audio.effectsVolume), [state.audio.effectsVolume]);
  useEffect(() => setBgmVolume(state.audio.bgmVolume), [state.audio.bgmVolume]);
  const disabled = game.busy || !game.connected || uploading;
  async function upload(file?: File) {
    if (!file) return;
    game.setError("");
    setMessage("");
    setUploading(true);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("背景音乐不能超过20MB");
      const response = await fetch(`/api/rooms/${state.code}/bgm`, {
        method: "POST",
        headers: {
          "x-game-role": "host",
          Authorization: `Bearer ${localStorage.getItem(tokenKey(state.code, "host")) || ""}`,
          "Content-Type": file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
        },
        body: file,
      });
      if (!response.ok) throw new Error((await response.json()).error || "背景音乐上传失败");
      setMessage("音乐已保存。点击播放背景音乐，并在大屏开启声音。");
    } catch (e) { game.setError((e as Error).message); }
    finally { setUploading(false); }
  }
  async function remove() {
    if (!confirm("是否移除当前背景音乐？")) return;
    try {
      await request(`/api/rooms/${state.code}/bgm`, "DELETE", undefined, state.code);
      setMessage("背景音乐已移除");
    } catch (e) { game.setError((e as Error).message); }
  }
  const volume = (key: "bgmVolume" | "effectsVolume", value: string) =>
    void game.cmd("audioSettings", { [key]: Number(value) / 100 });
  return (
    <section className="panel audio-controls" aria-labelledby="audio-controls-heading">
      <div className="section-heading">
        <div>
          <h2 id="audio-controls-heading">现场音乐与音效</h2>
          <p className="muted">仅大屏播放声音。每次打开或刷新大屏，请先在投屏电脑点击一次“开启大屏声音”。</p>
        </div>
      </div>
      <div className="two-columns">
        <div>
          <h3>游戏音效</h3>
          <label className="check-label">
            <input type="checkbox" checked={state.audio.effectsEnabled} disabled={disabled}
              onChange={(e) => void game.cmd("audioSettings", { effectsEnabled: e.target.checked })} />
            开启特殊格与棋子脚步音效
          </label>
          <label>音效音量 · {Math.round(effectsVolume * 100)}%
            <input type="range" min="0" max="100" value={Math.round(effectsVolume * 100)} disabled={disabled}
              onChange={(e) => setEffectsVolume(Number(e.target.value) / 100)}
              onPointerUp={(e) => volume("effectsVolume", e.currentTarget.value)}
              onKeyUp={(e) => volume("effectsVolume", e.currentTarget.value)} />
          </label>
          <p className="muted">开心前进、倒霉后退、答题提示和成功庆祝；棋子移动时播放轻快脚步声。</p>
        </div>
        <div>
          <h3>背景音乐 BGM</h3>
          <p className="bgm-file-name">
            {state.audio.bgm ? `${state.audio.bgm.source === "builtin" ? "正式内置BGM · " : ""}${state.audio.bgm.fileName}` : "当前未选择音乐，可恢复内置BGM或上传其他音乐。"}
          </p>
          <label className="upload-label">{uploading ? "正在上传音乐…" : "上传／替换背景音乐"}
            <input type="file" accept=".mp3,.wav,.ogg,.m4a,audio/*" disabled={disabled}
              onChange={(e) => { void upload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
          <div className="button-row">
            <button type="button" className="secondary" disabled={disabled || !state.audio.bgm}
              onClick={() => void game.cmd("audioSettings", { bgmEnabled: !state.audio.bgmEnabled })}>
              {state.audio.bgmEnabled ? "暂停背景音乐" : "播放背景音乐"}
            </button>
            <button type="button" className="text-button" disabled={disabled || !state.audio.bgm} onClick={() => void remove()}>移除音乐</button>
            {state.audio.bgm?.source !== "builtin" && (
              <button type="button" className="secondary" disabled={disabled}
                onClick={() => void game.cmd("useBuiltinBgm")}>恢复正式内置BGM</button>
            )}
          </div>
          <label>音乐音量 · {Math.round(bgmVolume * 100)}%
            <input type="range" min="0" max="100" value={Math.round(bgmVolume * 100)} disabled={disabled}
              onChange={(e) => setBgmVolume(Number(e.target.value) / 100)}
              onPointerUp={(e) => volume("bgmVolume", e.currentTarget.value)}
              onKeyUp={(e) => volume("bgmVolume", e.currentTarget.value)} />
          </label>
          <p className="muted">自动循环播放，特殊提示出现时降低音乐音量。支持MP3、WAV、OGG、M4A，最大20MB。</p>
        </div>
      </div>
      {message && <p className="notice">{message}</p>}
    </section>
  );
}
