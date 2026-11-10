import { useState } from "react";
import { statusNames, phaseNames, teamInfo } from "../config";
import {
  initialRoom,
  request,
  saveSession,
  useNow,
  isPreviewRoute,
  rememberRoom,
  type GameConnection,
} from "../hooks/useGame";
import type { TeamId, GameState } from "../types";
import { EVENT_ROOM_CODE } from "../../shared/siteSettings.js";
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={"brand " + (small ? "small" : "")}>
      <span className="anniversary">
        20<span>TH</span>
      </span>
      <div>
        <b>Toys“R”Us</b>
        <span>全员互动大富翁</span>
      </div>
    </div>
  );
}
export function Network({ connected }: { connected: boolean }) {
  return (
    <span className={"network " + (connected ? "online" : "offline")}>
      <i />
      {connected ? "实时同步" : "连接中 · 自动恢复"}
    </span>
  );
}
export function ErrorBar({ game }: { game: GameConnection }) {
  return game.error ? (
    <div role="alert" className="error">
      {game.error}
      <button aria-label="关闭提示" onClick={() => game.setError("")}>
        ×
      </button>
    </div>
  ) : game.busy ? (
    <div className="request-pending" role="status">
      正在提交，请稍候…
    </div>
  ) : null;
}
export function RoomForm({ role }: { role: "host" | "player" | "screen" }) {
  const preview = isPreviewRoute();
  const [room, setRoom] = useState(() => initialRoom() || EVENT_ROOM_CODE),
    [name, setName] = useState(""),
    [team, setTeam] = useState<TeamId>("east"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function enter(create = false) {
    setBusy(true);
    setError("");
    try {
      if (role === "host") {
        const result = await request(
          create && !preview ? "/api/rooms" : `/api/rooms/${room}/host-session`,
          "POST",
          {},
        );
        saveSession(result.code, "host", result.token);
      } else if (role === "player") {
        const result = await request(`/api/rooms/${room}/players`, "POST", {
          nickname: name,
          team,
        });
        saveSession(room, "player", result.token);
      } else {
        await request(`/api/rooms/${room}/state`);
        rememberRoom(room);
        location.href = `/screen?room=${room}`;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="entry">
      <div className="entry-glow" />
      <section className="entry-card">
        <Brand />
        <div className="eyebrow">一起玩 · 一路向前</div>
        <h1>
          {role === "host"
            ? "主持人控制中心"
            : role === "player"
              ? "加入你的队伍"
              : "准备好，一起出发"}
        </h1>
        <p className="muted">
          {role === "host"
            ? `年会固定房间 ${EVENT_ROOM_CODE}，再次进入会保留游戏进度。`
            : role === "player"
              ? "五支队伍，同一场童心冒险。"
              : "输入房间号，开启全场大屏。"}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enter();
          }}
        >
          <label>
            游戏房间号
            <input
              inputMode="numeric"
              maxLength={6}
              placeholder="6位房间号"
              value={room}
              readOnly={preview}
              onChange={(e) => setRoom(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          {role === "player" && (
            <>
              <label>
                员工昵称
                <input
                  maxLength={24}
                  required
                  placeholder="怎么称呼你？"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <fieldset>
                <legend>选择所属队伍</legend>
                <div className="team-choices">
                  {Object.entries(teamInfo).map(([id, t]) => (
                    <button
                      type="button"
                      key={id}
                      className={team === id ? "selected" : ""}
                      style={{ "--team-color": t.color } as React.CSSProperties}
                      onClick={() => setTeam(id as TeamId)}
                    >
                      {t.name}
                      <span>{team === id ? "✓" : ""}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy || room.length !== 6}>
            {busy
              ? "正在连接…"
              : role === "player"
                ? "加入游戏 →"
                : role === "host"
                  ? "进入主持人控制台 →"
                  : "打开游戏大屏 →"}
          </button>
          {role === "host" && (
            <button
              type="button"
              className="secondary wide"
              disabled={busy}
              onClick={() => void enter(true)}
            >
              {`进入年会房间 ${EVENT_ROOM_CODE}`}
            </button>
          )}
        </form>
        {preview && role === "player" && (
          <a className="preview-host-link" href="/host" target="_blank" rel="noreferrer">打开主持人控制台 ↗</a>
        )}
        <a className="back-link" href="/">
          ← 返回入口
        </a>
      </section>
    </main>
  );
}
export function Status({ state }: { state: GameState }) {
  return (
    <span className={"status status-" + state.status}>
      {statusNames[state.status]}
      {state.status === "running" ? " · " + phaseNames[state.phase] : ""}
    </span>
  );
}
export function Countdown({
  state,
  offset = 0,
}: {
  state: GameState;
  offset?: number;
}) {
  const now = useNow(offset),
    time = state.status === "paused" ? (state.pausedAt ?? now) : now;
  const remain = state.quiz
    ? Math.max(0, Math.ceil((state.quiz.endsAt - time) / 1000))
    : 0;
  return (
    <span className={"countdown " + (remain <= 5 ? "urgent" : "")}>
      {remain}
      <small>秒</small>
    </span>
  );
}
export function Ranking({ state }: { state: GameState }) {
  return (
    <div className="ranking-list">
      {state.rankings.map((t) => (
        <div className="rank-row" key={t.id}>
          <b>{String(t.rank).padStart(2, "0")}</b>
          <span className="team-dot" style={{ background: t.color }} />
          <strong>{t.name}</strong>
          <span>{t.finishOrder ? "🏁 已冲线" : `${t.position} / 20`}</span>
        </div>
      ))}
    </div>
  );
}
