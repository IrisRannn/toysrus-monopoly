import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { io } from "socket.io-client";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.BENCHMARK_SERVER_ROOT || root;
const { createApp } = await import(
  pathToFileURL(path.join(sourceRoot, "server/index.js"))
);
const { createStore } = await import(
  pathToFileURL(path.join(sourceRoot, "server/lib/store.js"))
);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-four-"));
const file = path.join(dir, "game.sqlite");
try {
  await fs.copyFile(
    process.env.BENCHMARK_SEED_FILE ?? path.join(root, "data", "game.sqlite"),
    file,
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const store = await createStore({ databaseUrl: null, file });
const app = await createApp({ store });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + app.server.address().port;
const clients = [],
  samples = [],
  frames = {},
  players = [];
const loop = monitorEventLoopDelay({ resolution: 5 });
async function post(route, body) {
  const r = await fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Error("HTTP " + r.status);
  return r.json();
}
async function connect(auth) {
  const s = io(base, { auth, transports: ["websocket"] });
  clients.push(s);
  frames[auth.role + ":" + clients.length] = 0;
  const key = auth.role + ":" + clients.length;
  s.on("state:update", () => frames[key]++);
  await new Promise((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
try {
  const room = await post("/api/rooms", {}),
    host = await connect({ room: room.code, role: "host", token: room.token });
  await connect({ room: room.code, role: "screen" });
  for (let i = 0; i < 4; i++) {
    const player = await post(`/api/rooms/${room.code}/players`, {
      team: "shanghai",
      nickname: "benchmark-" + i,
    });
    players.push(
      await connect({ room: room.code, role: "player", token: player.token }),
    );
  }
  const hostCommand = async (type, payload = {}) => {
    const r = await host
      .timeout(8000)
      .emitWithAck("command", { type, payload });
    if (!r.ok) throw Error(r.error);
  };
  await hostCommand("setOrder", {
    order: ["shanghai", "east", "central", "north", "west"],
  });
  await hostCommand("saveQuestion", {
    tile: 4,
    text: "Performance test only",
    options: { A: "a", B: "b", C: "c", D: "d" },
    answer: "A",
  });
  await hostCommand("start");
  const landed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("landing timeout")), 10000);
    host.on("state:update", function listener(s) {
      if (s.phase === "quiz_ready") {
        clearTimeout(timer);
        host.off("state:update", listener);
        resolve();
      }
    });
  });
  await hostCommand("physicalDice", { value: 4 });
  await landed;
  await hostCommand("startQuiz", { seconds: 300 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const key of Object.keys(frames)) frames[key] = 0;
  loop.enable();
  for (let i = 0; i < 40; i++) {
    const t = performance.now();
    const result = await players[i % 4].timeout(8000).emitWithAck("command", {
      type: "answer",
      payload: { option: i % 2 ? "A" : "B" },
    });
    if (!result.ok) throw Error(result.error);
    samples.push(performance.now() - t);
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  loop.disable();
  samples.sort((a, b) => a - b);
  const stats = {
    operation: "answer",
    clients: clients.length,
    players: 4,
    commands: samples.length,
    ack_p50_ms: +samples[Math.floor(samples.length * 0.5)].toFixed(2),
    ack_p95_ms: +samples[Math.floor(samples.length * 0.95)].toFixed(2),
    ack_max_ms: +samples[samples.length - 1].toFixed(2),
    event_loop_max_ms: +(loop.max / 1e6).toFixed(2),
    database_kib: +((await fs.stat(file)).size / 1024).toFixed(1),
    received_frames: frames,
  };
  console.log(JSON.stringify(stats, null, 2));
  if (process.argv[2])
    await fs.writeFile(process.argv[2], JSON.stringify(stats, null, 2));
} finally {
  for (const client of clients) client.disconnect();
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
