import { useEffect, useRef, useState } from "react";
import { startPosition } from "../../shared/tilePositions.js";
import type { GameState, Position } from "../types";
import { useNow } from "../hooks/useGame";
interface Props {
  state: GameState;
  debug?: boolean;
  onPositions?: (positions: Position[]) => void;
  offset?: number;
}
export default function Board({
  state,
  debug = false,
  onPositions,
  offset = 0,
}: Props) {
  const [missing, setMissing] = useState(false),
    [draft, setDraft] = useState(state.positions),
    [assetKey, setAssetKey] = useState(0);
  const now = useNow(offset),
    draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => setDraft(state.positions), [state.positions]);
  useEffect(() => {
    if (!missing) return;
    const timer = setInterval(() => setAssetKey(Date.now()), 10000);
    return () => clearInterval(timer);
  }, [missing]);
  const getPoint = (position: number) =>
    position === 0
      ? startPosition
      : draft.find((p) => p.id === position) || startPosition;
  const displayPosition = (team: string, position: number) => {
    const m = state.movement;
    if (m?.team === team && state.phase === "moving") {
      const time = state.status === "paused" ? (state.pausedAt ?? now) : now;
      const step =
        Math.max(0, Math.min(1, (time - m.startedAt) / m.duration)) *
        Math.abs(m.to - m.from);
      const logical = m.from + Math.sign(m.to - m.from) * step,
        a = getPoint(Math.floor(logical)),
        b = getPoint(Math.ceil(logical)),
        fraction = logical - Math.floor(logical);
      return {
        x: a.x + (b.x - a.x) * fraction,
        y: a.y + (b.y - a.y) * fraction,
      };
    }
    return getPoint(position);
  };
  function drag(e: React.PointerEvent, id: number) {
    const board = e.currentTarget.parentElement!;
    e.currentTarget.setPointerCapture(e.pointerId);
    const update = (event: PointerEvent) => {
      const rect = board.getBoundingClientRect();
      const next = draftRef.current.map((p) =>
        p.id === id
          ? {
              id,
              x: Math.max(
                0,
                Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
              ),
              y: Math.max(
                0,
                Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
              ),
            }
          : p,
      );
      draftRef.current = next;
      setDraft(next);
    };
    const stop = () => {
      board.removeEventListener("pointermove", update);
      board.removeEventListener("pointerup", stop);
      onPositions?.(draftRef.current);
    };
    board.addEventListener("pointermove", update);
    board.addEventListener("pointerup", stop, { once: true });
  }
  return (
    <div className={"board-canvas " + (debug ? "calibrating" : "")}>
      <img
        className="board-original"
        src={`/api/board-image?v=${assetKey}`}
        onLoad={() => setMissing(false)}
        onError={() => setMissing(true)}
        alt="原始20周年20格棋盘"
        style={{ visibility: missing ? "hidden" : "visible" }}
      />
      {missing && (
        <div className="asset-missing">
          <b>等待导入原始 20 格棋盘</b>
          <span>请在主持人端「棋盘校准」上传你提供的红色原图</span>
          <small>未使用旧版28格棋盘或生成替代图</small>
        </div>
      )}
      {Object.values(state.teams).map((team) => {
        const point = displayPosition(team.id, team.position),
          mates = Object.values(state.teams).filter(
            (t) => t.position === team.position,
          ),
          index = mates.findIndex((t) => t.id === team.id);
        const dx =
            mates.length > 1 ? (index - (mates.length - 1) / 2) * 4.3 : 0,
          dy = 0;
        return (
          <div
            key={team.id}
            data-team={team.id}
            data-position={team.position}
            className={
              "game-token " +
              (state.currentTeam === team.id && state.status === "running"
                ? "active"
                : "") +
              (team.finishOrder ? " finished" : "")
            }
            style={
              {
                left: `${point.x + dx}%`,
                top: `${point.y + dy}%`,
                "--team-color": team.color,
              } as React.CSSProperties
            }
          >
            <span className="token-crown">{team.finishOrder ? "♛" : "★"}</span>
            <span className="token-name">{team.name}</span>
            <span className="token-base" />
          </div>
        );
      })}
      {debug &&
        draft.map((p) => (
          <button
            type="button"
            key={p.id}
            onPointerDown={(e) => drag(e, p.id)}
            className="calibration-point"
            style={{ left: p.x + "%", top: p.y + "%" }}
            title={`${p.x.toFixed(2)}%, ${p.y.toFixed(2)}%`}
          >
            {String(p.id).padStart(2, "0")}
          </button>
        ))}
    </div>
  );
}
