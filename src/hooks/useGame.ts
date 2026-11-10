import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { GameState } from "../types";
import { EVENT_ROOM_CODE, PREVIEW_ROOM_CODE } from "../../shared/siteSettings.js";
export type Role = "host" | "player" | "screen";
export const tokenKey = (room: string, role: Role) =>
  `monopoly:${room}:${role}`;
export const initialRoom = () => {
  if (isPreviewRoute()) return PREVIEW_ROOM_CODE;
  const params = new URLSearchParams(location.search);
  return params.has("room")
    ? params.get("room") || ""
    : EVENT_ROOM_CODE;
};
export const isPreviewRoute = () => ["/player-preview", "/host-preview"].includes(location.pathname);
const rolePath = (role: Role) => isPreviewRoute() && role !== "screen" ? `/${role}-preview` : `/${role}`;
export function rememberRoom(room: string) {
  localStorage.setItem(room === PREVIEW_ROOM_CODE ? "monopoly:lastPreviewRoom" : "monopoly:lastRoom", room);
}
export function saveSession(room: string, role: Role, token: string) {
  localStorage.setItem(tokenKey(room, role), token);
  rememberRoom(room);
  location.href = `${rolePath(role)}?room=${encodeURIComponent(room)}`;
}
export async function request(
  path: string,
  method = "GET",
  body?: unknown,
  room?: string,
  role: Role = "host",
) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(room
        ? {
            "x-game-role": role,
            Authorization: `Bearer ${localStorage.getItem(tokenKey(room, role)) || ""}`,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let message = "请求失败";
    try {
      message = (await response.json()).error;
    } catch {
      /* Non-JSON upstream response. */
    }
    throw new Error(message);
  }
  return response.json();
}
export function useGame(role: Role) {
  const [room] = useState(initialRoom),
    [credential] = useState(() =>
      localStorage.getItem(tokenKey(initialRoom(), role)),
    );
  const [state, setState] = useState<GameState | null>(null),
    [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pendingCommand, setPendingCommand] = useState<string | null>(null),
    [offset, setOffset] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!/^\d{6}$/.test(room) || (role !== "screen" && !credential)) return;
    const s = io(import.meta.env.VITE_SOCKET_URL || "", {
      auth: { room, role, token: credential },
    });
    setSocket(s);
    s.on("connect", () => {
      setConnected(true);
      setError("");
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (e) => setError(e.message));
    s.on("session:revoked", () => {
      setError("身份已失效，请重新进入房间");
      localStorage.removeItem(tokenKey(room, role));
    });
    s.on("state:update", (next: GameState) => {
      setState((prev) => (prev && prev.version > next.version ? prev : next));
      setOffset(next.serverTime - Date.now());
    });
    return () => {
      s.disconnect();
    };
  }, [room, role, credential]);
  const cmd = async (type: string, payload: unknown = {}) => {
    if (inFlight.current) return false;
    setError("");
    if (!socket?.connected) {
      setError("连接已断开，恢复后再操作");
      return false;
    }
    inFlight.current = true;
    setBusy(true);
    setPendingCommand(type);
    try {
      const ack = await socket
        .timeout(8000)
        .emitWithAck("command", { type, payload });
      if (!ack.ok) throw new Error(ack.error);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPendingCommand(null);
    }
  };
  const logout = () => {
    localStorage.removeItem(tokenKey(room, role));
    location.href = `${rolePath(role)}?room=${room}`;
  };
  return {
    room,
    credential,
    state,
    connected,
    error,
    setError,
    busy,
    pendingCommand,
    cmd,
    offset,
    logout,
  };
}
export type GameConnection = ReturnType<typeof useGame>;
export function useNow(offset = 0) {
  const [now, setNow] = useState(Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 100);
    return () => clearInterval(id);
  }, [offset]);
  return now;
}
export async function download(room: string, kind: string, name: string) {
  const res = await fetch(`/api/rooms/${room}/${kind}`, {
    headers: {
      "x-game-role": "host",
      Authorization: `Bearer ${localStorage.getItem(tokenKey(room, "host")) || ""}`,
    },
  });
  if (!res.ok) throw new Error((await res.json()).error);
  const url = URL.createObjectURL(await res.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
