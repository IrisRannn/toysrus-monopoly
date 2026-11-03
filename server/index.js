import "dotenv/config";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt, randomUUID } from "node:crypto";
import { Server } from "socket.io";
import QRCode from "qrcode";
import ExcelJS from "exceljs";
import { createStore } from "./lib/store.js";
import { authorize, token, hash } from "./lib/auth.js";
import {
  newRoom,
  command,
  tick,
  event,
  GameError,
  publicState,
  prizeCandidates,
  seedQuestionBank,
} from "./lib/engine.js";
import { importQuestions, COLUMNS, safeCsv } from "./lib/import.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function createApp(options = {}) {
  const production = process.env.NODE_ENV === "production";
  const store = options.store ?? (await createStore());
  // Upgrade persisted rooms once, preserving their progress and custom questions.
  for (const code of await store.codes()) {
    const preview = await store.read(code);
    if (preview && seedQuestionBank(preview))
      await store.mutate(code, (s) => {
        seedQuestionBank(s);
      });
  }
  const app = express(),
    server = http.createServer(app);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "12mb" }));
  // Socket commands authenticate per connection and per command. No broad CORS.
  const allowed = new Set(
    (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean),
  );
  const io = new Server(server, {
    maxHttpBufferSize: 1024 * 1024,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(
        null,
        !origin ||
          allowed.has(origin) ||
          (() => {
            try {
              return new URL(origin).host === req.headers.host;
            } catch {
              return false;
            }
          })(),
      );
    },
  });
  const online = (code) =>
    new Set(
      [...io.sockets.sockets.values()]
        .filter((sock) => sock.data.code === code && sock.data.actor?.playerId)
        .map((sock) => sock.data.actor.playerId),
    );
  const presenceVersions = new Map();
  const pendingBroadcasts = new Map();
  const activeBroadcasts = new Set();
  let closing = false;
  const updatePresence = (code) =>
    presenceVersions.set(code, (presenceVersions.get(code) || 0) + 1);
  const sendSnapshot = (
    socket,
    s,
    connected,
    shared,
    hostView,
    presence = presenceVersions.get(s.code) || 0,
  ) => {
    if (!socket.connected) return;
    try {
      const actor = authorize(
        s,
        socket.data.actor.role,
        socket.data.credential,
        socket.data.actor.playerId,
      );
      if (
        socket.data.lastVersion > s.version ||
        (socket.data.lastVersion === s.version &&
          socket.data.lastPresence === presence)
      )
        return;
      const view =
        actor.role === "host"
          ? hostView || publicState(s, actor, connected)
          : shared
            ? publicState(s, actor, connected, shared)
            : publicState(s, actor, connected);
      socket.emit("state:update", view);
      socket.data.lastVersion = s.version;
      socket.data.lastPresence = presence;
    } catch {
      socket.emit("session:revoked");
      socket.disconnect(true);
    }
  };
  const broadcast = async (code) => {
    const s = await store.read(code);
    if (!s) return;
    const presence = presenceVersions.get(code) || 0;
    const connected = online(code);
    const sockets = [...io.sockets.sockets.values()].filter(
      (socket) => socket.data.code === code,
    );
    if (!sockets.length) {
      presenceVersions.delete(code);
      return;
    }
    const shared = publicState(s, { role: "screen" }, connected);
    const hostView = sockets.some((socket) => socket.data.actor.role === "host")
      ? publicState(s, { role: "host" }, connected)
      : null;
    for (const socket of sockets)
      sendSnapshot(socket, s, connected, shared, hostView, presence);
  };
  const trackUpdate = (work) => {
    activeBroadcasts.add(work);
    void work
      .catch((error) => console.error("Snapshot failure:", error.message))
      .finally(() => activeBroadcasts.delete(work));
  };
  const scheduleBroadcast = (code) => {
    if (closing || pendingBroadcasts.has(code)) return;
    pendingBroadcasts.set(
      code,
      setTimeout(() => {
        pendingBroadcasts.delete(code);
        trackUpdate(broadcast(code));
      }, 40),
    );
  };
  const authHttp = async (req) => {
    const s = await store.read(req.params.code);
    return authorize(
      s,
      req.headers["x-game-role"] || "screen",
      req.headers.authorization?.replace(/^Bearer /, ""),
    );
  };
  const limiters = new Map();
  function limit(key, max, window = 60000) {
    const now = Date.now(),
      prev = limiters.get(key);
    if (!prev || prev.until < now) {
      limiters.set(key, { count: 1, until: now + window });
      return;
    }
    if (++prev.count > max)
      throw new GameError("操作过于频繁，请稍后再试", 429);
  }
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);
  const perform = async (
    code,
    role,
    credential,
    type,
    payload,
    trustedPlayerId,
  ) => {
    const state = await store.mutate(code, (s) => {
      const actor = authorize(s, role, credential, trustedPlayerId);
      if (actor.role === "screen") throw new GameError("大屏为只读界面", 403);
      command(s, actor, type, payload);
    });
    scheduleBroadcast(code);
    return state;
  };
  const assetDir = path.join(root, "data", "assets");
  app.get("/api/board-image", (_req, res) => {
    const image = ["jpg", "png"]
      .map((ext) => path.join(assetDir, "游戏背景图." + ext))
      .concat(
        ["jpg", "png"].map((ext) =>
          path.join(root, "public", "assets", "游戏背景图." + ext),
        ),
      )
      .find((p) => fs.existsSync(p));
    if (image) res.setHeader("Cache-Control", "no-cache").sendFile(image);
    else res.status(404).json({ error: "请上传原始红色20格棋盘文件" });
  });
  app.post(
    "/api/rooms/:code/background",
    wrap(async (req, res) => {
      const actor = await authHttp(req);
      if (actor.role !== "host") throw new GameError("仅主持人可上传原图", 403);
      if (typeof req.body.content !== "string") throw new GameError("缺少图片");
      const bytes = Buffer.from(req.body.content, "base64");
      const ext =
        bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? "jpg"
          : bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "png"
            : null;
      if (!ext || bytes.length > 8 * 1024 * 1024)
        throw new GameError("请上传8MB以内的原始JPG或PNG");
      fs.mkdirSync(assetDir, { recursive: true });
      fs.writeFileSync(path.join(assetDir, "游戏背景图." + ext), bytes);
      fs.writeFileSync(
        path.join(root, "public", "assets", "游戏背景图." + ext),
        bytes,
      );
      const other = ext === "jpg" ? "png" : "jpg";
      for (const dir of [assetDir, path.join(root, "public", "assets")]) {
        const old = path.join(dir, "游戏背景图." + other);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }
      await store.mutate(req.params.code, (s) => {
        event(s, "background", "主持人上传原始棋盘图片，保留原始字节");
      });
      scheduleBroadcast(req.params.code);
      res.json({ ok: true });
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      database: store.kind,
      mode: production ? "production" : "development",
    }),
  );
  app.post(
    "/api/rooms",
    wrap(async (req, res) => {
      limit("host-entry:" + req.ip, 30);
      let code;
      do {
        code = String(randomInt(100000, 1000000));
      } while (await store.read(code));
      const credential = token();
      await store.mutate(code, (s) => {
        if (s) throw new GameError("房间号冲突，请重试");
        return { state: newRoom(code, hash(credential)) };
      });
      res.status(201).json({ code, token: credential });
    }),
  );
  app.post(
    "/api/rooms/:code/host-session",
    wrap(async (req, res) => {
      limit("host-entry:" + req.ip, 30);
      const credential = token();
      await store.mutate(req.params.code, (s) => {
        if (!s) throw new GameError("房间不存在", 404);
        s.hostHash = hash(credential);
        event(s, "host_enter", "主持人进入房间，旧主持人会话失效");
      });
      scheduleBroadcast(req.params.code);
      res.json({ code: req.params.code, token: credential });
    }),
  );
  app.post(
    "/api/rooms/:code/players",
    wrap(async (req, res) => {
      limit("join:" + req.ip, 1000);
      const credential = token(),
        id = randomUUID();
      await store.mutate(req.params.code, (s) => {
        if (!s) throw new GameError("房间不存在", 404);
        if (Object.keys(s.players).length >= 5000)
          throw new GameError("房间人数已达上限");
        s.players[id] = {
          id,
          tokenHash: hash(credential),
          team: null,
          nickname: "",
          removed: false,
          joinedAt: Date.now(),
        };
        command(s, { role: "player", playerId: id }, "join", req.body);
      });
      scheduleBroadcast(req.params.code);
      res.status(201).json({ token: credential, playerId: id });
    }),
  );
  app.get(
    "/api/rooms/:code/state",
    wrap(async (req, res) => {
      const actor = await authHttp(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        publicState(
          await store.read(req.params.code),
          actor,
          online(req.params.code),
        ),
      );
    }),
  );
  app.post(
    "/api/rooms/:code/commands",
    wrap(async (req, res) => {
      limit("command:" + req.ip, 3000);
      let payload = req.body.payload ?? {};
      if (req.body.type === "importQuestions") {
        const actor = await authHttp(req);
        if (actor.role !== "host")
          throw new GameError("仅主持人可导入题库", 403);
        payload = {
          questions: await importQuestions(payload.format, payload.content),
        };
      }
      await perform(
        req.params.code,
        req.headers["x-game-role"] || "screen",
        req.headers.authorization?.replace(/^Bearer /, ""),
        req.body.type,
        payload,
      );
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/rooms/:code/qr",
    wrap(async (req, res) => {
      const actor = await authHttp(req);
      if (actor.role !== "host") throw new GameError("仅主持人可操作", 403);
      const base = process.env.PUBLIC_BASE_URL || req.query.base;
      let url;
      try {
        url = new URL("/player", String(base));
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new GameError("请提供可供手机访问的完整站点地址");
      }
      url.searchParams.set("room", req.params.code);
      res.type("image/svg+xml").send(
        await QRCode.toString(url.href, {
          type: "svg",
          margin: 2,
          color: { dark: "#281512", light: "#ffffff" },
        }),
      );
    }),
  );
  app.get(
    "/api/rooms/:code/template/:format",
    wrap(async (req, res) => {
      const actor = await authHttp(req);
      if (actor.role !== "host") throw new GameError("仅主持人可操作", 403);
      if (req.params.format === "csv") {
        res
          .attachment("questions-template.csv")
          .type("text/csv")
          .send("\uFEFF" + COLUMNS.join(",") + "\r\n");
      } else if (req.params.format === "xlsx") {
        const workbook = new ExcelJS.Workbook(),
          sheet = workbook.addWorksheet("题库模板");
        sheet.addRow(COLUMNS);
        sheet.columns.forEach((c) => (c.width = 24));
        res
          .attachment("questions-template.xlsx")
          .type(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          )
          .send(Buffer.from(await workbook.xlsx.writeBuffer()));
      } else throw new GameError("格式无效");
    }),
  );
  app.get(
    "/api/rooms/:code/export/:kind",
    wrap(async (req, res) => {
      const actor = await authHttp(req);
      if (actor.role !== "host") throw new GameError("仅主持人可导出", 403);
      const s = await store.read(req.params.code);
      if (req.params.kind === "positions") {
        res.attachment("tilePositions.json").json(s.positions);
        return;
      }
      if (req.params.kind === "events") {
        res.attachment("game-events.json").json(s.events);
        return;
      }
      if (req.params.kind === "prizes") {
        if (s.status !== "finished") throw new GameError("请先结束游戏");
        const candidates = prizeCandidates(s);
        if (candidates.needsConfirmation)
          throw new GameError("存在并列排名，请先确认抽奖资格");
        const rows = candidates.prizes.flatMap((p) =>
          p.players.map((x) => ({
            prize: p.name,
            value: p.value,
            quantity: p.quantity,
            player_id: x.id,
            nickname: x.nickname,
            team: s.teams[x.team].name,
          })),
        );
        res
          .attachment("lottery-candidates.csv")
          .type("text/csv")
          .send(
            safeCsv(rows, [
              "prize",
              "value",
              "quantity",
              "player_id",
              "nickname",
              "team",
            ]),
          );
        return;
      }
      throw new GameError("导出类型无效");
    }),
  );
  io.use(async (socket, next) => {
    try {
      const {
        room,
        role = "screen",
        token: credential,
      } = socket.handshake.auth;
      const actor = authorize(await store.read(room), role, credential);
      socket.data = { code: room, actor, credential };
      next();
    } catch (e) {
      next(new Error(e.message));
    }
  });
  io.on("connection", (socket) => {
    if (closing) {
      socket.disconnect(true);
      return;
    }
    updatePresence(socket.data.code);
    trackUpdate(
      (async () => {
        const s = await store.read(socket.data.code);
        if (s) sendSnapshot(socket, s, online(s.code));
      })(),
    );
    scheduleBroadcast(socket.data.code);
    socket.on(
      "command",
      async ({ type, payload = {} } = {}, ack = () => {}) => {
        try {
          limit("socket:" + socket.id, 180, 60000);
          if (type === "importQuestions")
            throw new GameError("请通过HTTP接口导入题库");
          const state = await perform(
            socket.data.code,
            socket.data.actor.role,
            socket.data.credential,
            type,
            payload,
            socket.data.actor.playerId,
          );
          // Confirm the sender immediately after its durable transaction.
          // Other clients receive one coalesced snapshot per short interval.
          sendSnapshot(socket, state, online(state.code));
          ack({ ok: true });
        } catch (e) {
          ack({
            ok: false,
            error: e.status ? e.message : "操作失败，请查看服务器日志",
          });
          if (!e.status) console.error("command failure", e.message);
        }
      },
    );
    socket.on("disconnect", () => {
      updatePresence(socket.data.code);
      scheduleBroadcast(socket.data.code);
    });
  });
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      for (const code of await store.codes()) {
        const preview = await store.read(code);
        if (
          preview.status === "running" &&
          ((preview.transitionAt && preview.transitionAt <= Date.now()) ||
            (preview.phase === "answering" &&
              preview.quiz.endsAt <= Date.now()))
        ) {
          await store.mutate(code, (s) => {
            tick(s);
          });
          scheduleBroadcast(code);
        }
      }
    } catch (e) {
      console.error("Timer failure:", e.message);
    } finally {
      ticking = false;
    }
  }, 100);
  timer.unref();
  const cleanup = setInterval(() => {
    for (const [key, value] of limiters)
      if (value.until < Date.now()) limiters.delete(key);
  }, 60000);
  cleanup.unref();
  app.use(express.static(path.join(root, "dist")));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/"))
      res.status(404).json({ error: "接口不存在" });
    else res.sendFile(path.join(root, "dist/index.html"));
  });
  app.use((error, _req, res, _next) => {
    if (!error.status) console.error("Request failure:", error.message);
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : "服务器错误，请查看日志" });
  });
  return {
    app,
    server,
    io,
    store,
    close: async () => {
      closing = true;
      clearInterval(timer);
      clearInterval(cleanup);
      for (const timer of pendingBroadcasts.values()) clearTimeout(timer);
      pendingBroadcasts.clear();
      await new Promise((resolve) => io.close(resolve));
      await Promise.allSettled([...activeBroadcasts]);
      await store.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const instance = await createApp();
  const port = Number(process.env.PORT || 3001);
  instance.server.listen(port, "0.0.0.0", () =>
    console.log(`20周年全员大富翁 · ${instance.store.kind} · port ${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(
      signal,
      () => void instance.close().then(() => process.exit(0)),
    );
}
