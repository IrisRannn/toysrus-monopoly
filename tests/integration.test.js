import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { io } from "socket.io-client";
import ExcelJS from "exceljs";
import { createApp } from "../server/index.js";
import { createStore } from "../server/lib/store.js";
import { importQuestions, safeCsv, COLUMNS } from "../server/lib/import.js";
import { newRoom, command, tick } from "../server/lib/engine.js";
import { hash } from "../server/lib/auth.js";
import { MAX_BGM_BYTES } from "../server/lib/audioAssets.js";
import { BUILTIN_BGM } from "../shared/builtinBgm.js";
async function fixture(file) {
  const store = await createStore({ databaseUrl: null, file });
  const app = await createApp({ store, assetDirectory: path.join(path.dirname(file), "assets") });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}` };
}
async function api(url, route, body, token, role = "host") {
  const res = await fetch(url + route, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-game-role": role,
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const waitState = (socket, predicate) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("state:update", listener);
      reject(new Error("state timeout"));
    }, 6000);
    function listener(s) {
      if (predicate(s)) {
        clearTimeout(timeout);
        socket.off("state:update", listener);
        resolve(s);
      }
    }
    socket.on("state:update", listener);
  });
test("official room 261219 reopens atomically without losing players, progress, questions or settings", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-fixed-room-"));
  const file = path.join(directory, "state.sqlite");
  let app = await fixture(file);
  try {
    const first = await api(app.url, "/api/rooms", {});
    assert.equal(first.status, 201);
    assert.equal(first.body.code, "261219");
    const code = first.body.code;
    const player = (await api(app.url, `/api/rooms/${code}/players`, { team: "east", nickname: "固定房间员工" })).body;
    await api(app.url, `/api/rooms/${code}/commands`, { type: "manualMove", payload: { team: "east", position: 9, reason: "固定房间进度测试" } }, first.body.token);
    await api(app.url, `/api/rooms/${code}/commands`, { type: "audioSettings", payload: { bgmVolume: 0.12 } }, first.body.token);
    const before = await app.store.read(code);
    const reopened = await Promise.all(Array.from({ length: 4 }, () => api(app.url, "/api/rooms", {})));
    assert(reopened.every((r) => r.status === 200 && r.body.code === code));
    assert.deepEqual(await app.store.codes(), [code]);
    const after = await app.store.read(code);
    assert.deepEqual(after.teams, before.teams);
    assert.deepEqual(after.players, before.players);
    assert.deepEqual(after.questions, before.questions);
    assert.deepEqual(after.audio, before.audio);
    assert.equal((await api(app.url, `/api/rooms/${code}/state`, null, first.body.token)).status, 401);
    assert.equal((await api(app.url, `/api/rooms/${code}/state`, null, player.token, "player")).status, 200);
    await app.close();
    app = await fixture(file);
    const entered = await api(app.url, `/api/rooms/${code}/host-session`, {});
    assert.equal(entered.status, 200);
    assert.equal((await app.store.read(code)).teams.east.position, 9);
    assert.equal((await api(app.url, "/api/rooms/888888/host-session", {})).status, 404);
    await app.close();
    app = await fixture(path.join(directory, "fresh.sqlite"));
    assert.equal((await api(app.url, "/api/rooms/261218/host-session", {})).status, 200);
    assert.equal((await app.store.read("261218")).questions.length, 19);
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("BGM upload is authenticated, bounded, streamed and retained across database restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-bgm-"));
  const file = path.join(directory, "state.sqlite");
  let app = await fixture(file);
  try {
    const created = (await api(app.url, "/api/rooms", {})).body;
    const { code, token } = created;
    const player = (await api(app.url, `/api/rooms/${code}/players`, { team: "east", nickname: "音频权限测试" })).body;
    const wave = Buffer.alloc(44 + 1600);
    wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(1600, 40);
    const upload = (body, credential = token, role = "host") => fetch(app.url + `/api/rooms/${code}/bgm`, {
      method: "POST", headers: { "x-game-role": role, Authorization: "Bearer " + credential,
        "Content-Type": "audio/wav", "x-file-name": encodeURIComponent("测试背景.wav") }, body,
    });
    assert.equal((await upload(wave, player.token, "player")).status, 403);
    assert.equal((await upload(wave, "", "screen")).status, 403);
    assert.equal((await upload(wave, "bad-token")).status, 401);
    assert.equal((await upload(Buffer.from("not an audio file"))).status, 400);
    assert.equal((await upload(Buffer.alloc(MAX_BGM_BYTES + 1))).status, 413);
    const uploaded = await upload(wave);
    assert.equal(uploaded.status, 200);
    const { bgm } = await uploaded.json();
    assert.equal(bgm.fileName, "测试背景.wav");
    assert.equal(bgm.size, wave.length);
    assert.equal((await app.store.read(code)).events.find((e) => e.type === "bgm").actor, "host");
    assert(!JSON.stringify(bgm).includes("base64"));
    const ranged = await fetch(app.url + bgm.url, { headers: { Range: "bytes=0-15" } });
    assert.equal(ranged.status, 206);
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), wave.subarray(0, 16));
    const changed = await api(app.url, `/api/rooms/${code}/commands`, {
      type: "audioSettings", payload: { bgmEnabled: true, bgmVolume: 0.12 },
    }, token);
    assert.equal(changed.status, 200);
    await app.close();
    app = await fixture(file);
    const restored = (await api(app.url, `/api/rooms/${code}/state`, null, token)).body;
    assert.equal(restored.audio.bgm.id, bgm.id);
    assert.equal(restored.audio.bgmEnabled, true);
    assert.equal(restored.audio.bgmVolume, 0.12);
    assert.deepEqual(Buffer.from(await (await fetch(app.url + bgm.url)).arrayBuffer()), wave);
    assert.equal((await fetch(app.url + `/api/rooms/${code}/bgm`, {
      method: "DELETE", headers: { "x-game-role": "player", Authorization: "Bearer " + player.token },
    })).status, 403);
    assert.equal((await fetch(app.url + `/api/rooms/${code}/bgm`, {
      method: "DELETE", headers: { "x-game-role": "host", Authorization: "Bearer " + token },
    })).status, 200);
    assert.equal((await fetch(app.url + bgm.url)).status, 404);
    assert.equal((await app.store.read(code)).audio.bgmEnabled, false);
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("official MP3 is available without uploads in a fresh database and can be restored after replacement", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-official-bgm-"));
  let app = await fixture(path.join(directory, "first.sqlite"));
  try {
    const room = (await api(app.url, "/api/rooms", {})).body;
    const initial = (await api(app.url, `/api/rooms/${room.code}/state`, null, room.token)).body;
    assert.equal(initial.audio.bgm.id, BUILTIN_BGM.id);
    assert.equal(initial.audio.bgm.source, "builtin");
    assert.equal(initial.audio.bgmEnabled, false);
    const media = await fetch(app.url + initial.audio.bgm.url);
    assert.equal(media.status, 200);
    assert.match(media.headers.get("content-type"), /audio\/mpeg/);
    const bytes = Buffer.from(await media.arrayBuffer());
    assert.equal(bytes.length, 5256532);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), BUILTIN_BGM.id);
    const range = await fetch(app.url + initial.audio.bgm.url, { headers: { Range: "bytes=0-31" } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 32));
    await fetch(app.url + `/api/rooms/${room.code}/bgm`, {
      method: "DELETE", headers: { "x-game-role": "host", Authorization: "Bearer " + room.token },
    });
    await app.close();
    app = await fixture(path.join(directory, "first.sqlite"));
    assert.equal((await app.store.read(room.code)).audio.bgm, null);
    const restored = await api(app.url, `/api/rooms/${room.code}/commands`, { type: "useBuiltinBgm" }, room.token);
    assert.equal(restored.status, 200);
    assert.equal((await app.store.read(room.code)).audio.bgm.id, BUILTIN_BGM.id);
    await app.close();
    app = await fixture(path.join(directory, "fresh.sqlite"));
    const fresh = (await api(app.url, "/api/rooms", {})).body;
    assert.equal((await app.store.read(fresh.code)).audio.bgm.id, BUILTIN_BGM.id);
    const freshMedia = await fetch(app.url + BUILTIN_BGM.url);
    assert.equal(freshMedia.status, 200);
    await freshMedia.arrayBuffer();
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("real HTTP + WebSocket, auth boundaries, concurrent roll lock, database reload and reconnect", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-test-")),
    file = path.join(dir, "game.sqlite");
  let app = await fixture(file);
  const sockets = [];
  try {
    const created = await api(app.url, "/api/rooms", {});
    assert.equal(created.status, 201);
    const { code, token: previousHost } = created.body;
    const entered = await api(app.url, `/api/rooms/${code}/host-session`, {});
    assert.equal(entered.status, 200);
    const host = entered.body.token;
    assert.notEqual(host, previousHost);
    assert.equal(
      (await api(app.url, `/api/rooms/${code}/state`, null, previousHost))
        .status,
      401,
    );
    const creds = [];
    for (const [team, nickname] of [
      ["east", "东区1"],
      ["central", "中南1"],
      ["north", "北1"],
      ["west", "西1"],
      ["shanghai", "上海1"],
    ]) {
      const joined = await api(app.url, `/api/rooms/${code}/players`, {
        team,
        nickname,
      });
      assert.equal(joined.status, 201);
      creds.push(joined.body);
    }
    assert.equal(
      (
        await api(
          app.url,
          `/api/rooms/${code}/commands`,
          { type: "start" },
          creds[0].token,
          "player",
        )
      ).status,
      400,
    );
    const screen = io(app.url, {
      auth: { room: code, role: "screen" },
      transports: ["websocket"],
    });
    sockets.push(screen);
    const initial = await waitState(screen, (s) => s.code === code);
    assert.equal(initial.teams.east.members, 1);
    assert.equal(initial.players, undefined);
    const started = waitState(screen, (s) => s.status === "running");
    assert.equal(
      (
        await api(
          app.url,
          `/api/rooms/${code}/commands`,
          { type: "start" },
          host,
        )
      ).status,
      200,
    );
    await started;
    await api(
      app.url,
      `/api/rooms/${code}/commands`,
      { type: "setTeamRepresentative", payload: { team: "east", playerId: creds[0].playerId } },
      host,
    );
    const rolls = await Promise.all(
      Array.from({ length: 10 }, () =>
        api(
          app.url,
          `/api/rooms/${code}/commands`,
          { type: "roll", payload: { value: 99 } },
          creds[0].token,
          "player",
        ),
      ),
    );
    assert.equal(rolls.filter((r) => r.status === 200).length, 1);
    const state = (await api(app.url, `/api/rooms/${code}/state`, null, host))
      .body;
    assert(state.dice.value >= 1 && state.dice.value <= 6);
    assert.equal(state.events.filter((e) => e.type === "dice").length, 1);
    assert.equal(
      (
        await api(
          app.url,
          `/api/rooms/${code}/commands`,
          {
            type: "manualMove",
            payload: { team: "east", position: 20, reason: "fake" },
          },
          creds[0].token,
          "player",
        )
      ).status,
      400,
    );
    await api(app.url, `/api/rooms/${code}/commands`, { type: "pause" }, host);
    const before = (await api(app.url, `/api/rooms/${code}/state`, null, host))
      .body;
    screen.disconnect();
    await app.close();
    app = await fixture(file);
    const restored = (
      await api(app.url, `/api/rooms/${code}/state`, null, host)
    ).body;
    assert.equal(restored.status, "paused");
    assert.deepEqual(restored.teams, before.teams);
    assert.equal(restored.dice.value, before.dice.value);
    const reconnect = io(app.url, {
      auth: { room: code, role: "player", token: creds[0].token },
    });
    sockets.push(reconnect);
    const current = await waitState(reconnect, (s) => s.status === "paused");
    assert.equal(current.me.nickname, "东区1");
    const db = await fs.readFile(file);
    assert.equal(db.subarray(0, 15).toString(), "SQLite format 3");
  } finally {
    for (const sock of sockets) sock.disconnect();
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("CSV/XLSX validate real files, reject empty or invalid rows, formula-safe exports", async () => {
  const content = COLUMNS.join(",") + "\n4,测试题,甲,乙,丙,丁,A,测试解析\n";
  const questions = await importQuestions("csv", content);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].tile, 4);
  assert.equal((await importQuestions("csv", content.replace("\n4,", "\n0,")))[0].tile, 0);
  await assert.rejects(
    () => importQuestions("csv", COLUMNS.join(",") + "\n"),
    /1–1000/,
  );
  await assert.rejects(
    () => importQuestions("csv", content + "2,错误题,甲,乙,丙,丁,A,错误格子\n"),
    /第3行/,
  );
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("questions");
  sheet.addRow(COLUMNS);
  sheet.addRow([15, "测试终极题", "甲", "乙", "丙", "丁", "B", "解析"]);
  const imported = await importQuestions(
    "xlsx",
    Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64"),
  );
  assert.equal(imported[0].answer, "B");
  assert.equal(imported[0].tile, 15);
  assert(
    safeCsv([{ nickname: '=HYPERLINK("fake")' }], ["nickname"]).includes(
      "'=HYPERLINK",
    ),
  );
});

test("built-in bank upgrades existing rooms once, preserves consumption on restart and returns after a fresh deployment", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-bank-"));
  const file = path.join(directory, "state.sqlite");
  const code = "123456", credential = "test-host-token";
  const store = await createStore({ databaseUrl: null, file });
  const legacy = newRoom(code, hash(credential));
  const used = { ...legacy.questions[0], id: "legacy-used", tile: 4 };
  legacy.questions = [used, {
    id: "custom", tile: 0, text: "既有自定义题目", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "A", explanation: "保留原题",
  }];
  legacy.usedQuestions = [used.id];
  delete legacy.questionBankVersion;
  delete legacy.usedQuestionKeys;
  legacy.round = 3;
  legacy.status = "running";
  legacy.phase = "quiz_ready";
  legacy.teams.east.position = 8;
  await store.mutate(code, () => ({ state: legacy }));
  await store.close();
  let app = await fixture(file);
  try {
    const current = (await api(app.url, `/api/rooms/${code}/state`, null, credential)).body;
    assert.equal(current.questions.length, 20);
    assert.equal(current.round, 3);
    assert(current.questions.some((q) => q.id === "custom"));
    assert.equal((await api(app.url, `/api/rooms/${code}/state`, null, null, "screen")).body.questions, undefined);
    const request = (type, payload = {}) => api(app.url, `/api/rooms/${code}/commands`, { type, payload }, credential);
    assert.equal((await request("startQuiz", { questionId: used.id })).status, 400);
    const removed = current.questions.find((q) => q.id !== used.id && q.id !== "custom");
    assert.equal((await request("deleteQuestion", { id: removed.id })).status, 200);
    assert.equal((await request("startQuiz", { questionId: "custom", seconds: 300 })).status, 200);
    assert.equal((await request("pause")).status, 200);
    await app.close();
    app = await fixture(file);
    const restored = (await api(app.url, `/api/rooms/${code}/state`, null, credential)).body;
    assert.equal(restored.questions.length, 19);
    assert(!restored.questions.some((q) => q.id === removed.id));
    assert(restored.usedQuestions.includes(used.id));
    assert(restored.usedQuestions.includes("custom"));
    assert.equal(restored.quiz.question.id, "custom");
    assert.equal(restored.status, "paused");
    await app.close();
    // A free instance losing its database still starts with the approved bank.
    app = await fixture(path.join(directory, "fresh.sqlite"));
    const created = (await api(app.url, "/api/rooms", {})).body;
    const fresh = (await api(app.url, `/api/rooms/${created.code}/state`, null, created.token)).body;
    assert.equal(fresh.questions.length, 19);
    assert.deepEqual(fresh.usedQuestions, []);
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ordinary turn handoff survives restart, pauses safely and broadcasts without a host next command", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-auto-next-"));
  const file = path.join(directory, "state.sqlite");
  const code = "123456", credential = "test-host-token";
  const store = await createStore({ databaseUrl: null, file });
  const legacy = newRoom(code, hash(credential));
  delete legacy.turnAutomationVersion;
  legacy.settings.autoAdvance = false;
  legacy.status = "paused";
  legacy.phase = "turn_complete";
  legacy.pausedAt = Date.now();
  legacy.teams.east.position = 1;
  legacy.dice = { source: "online", value: 1, at: Date.now() - 2000 };
  await store.mutate(code, () => ({ state: legacy }));
  await store.close();
  let app = await fixture(file);
  const sockets = [];
  try {
    const migrated = (await api(app.url, `/api/rooms/${code}/state`, null, credential)).body;
    assert.equal(migrated.settings.autoAdvance, true);
    assert.equal(migrated.currentTeam, "east");
    assert.equal(migrated.autoNextAt, null);
    await app.close();
    app = await fixture(file);
    const screen = io(app.url, { auth: { room: code, role: "screen" }, transports: ["websocket"] });
    sockets.push(screen);
    await waitState(screen, (s) => s.status === "paused");
    const automatic = waitState(screen, (s) => s.currentTeam === "central" && s.phase === "awaiting_dice");
    const resumed = await api(app.url, `/api/rooms/${code}/commands`, { type: "resume" }, credential);
    assert.equal(resumed.status, 200);
    const next = await automatic;
    assert.equal(next.teams.east.position, 1);
    assert.equal(next.dice, null);
    assert.equal(next.events.filter((e) => e.type === "next").length, 1);
    assert.equal(next.events.find((e) => e.type === "next").actor, "system");
    await api(app.url, `/api/rooms/${code}/commands`, { type: "settings", payload: { autoAdvance: false } }, credential);
    screen.disconnect();
    await app.close();
    app = await fixture(file);
    const restored = (await api(app.url, `/api/rooms/${code}/state`, null, credential)).body;
    assert.equal(restored.settings.autoAdvance, false);
    assert.equal(restored.currentTeam, "central");
    assert.equal(restored.phase, "awaiting_dice");
  } finally {
    for (const socket of sockets) socket.disconnect();
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("special event survives restart and unrelated joins, then moves once without chaining a quiz", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-presentation-"));
  const file = path.join(directory, "state.sqlite");
  const code = "123456", credential = "test-host-token", now = Date.now() - 5000;
  const store = await createStore({ databaseUrl: null, file });
  const state = newRoom(code, hash(credential));
  const host = { role: "host" }, rep = { role: "player", playerId: "rep" };
  state.players.rep = { id: "rep", team: "east", nickname: "代表" };
  command(state, host, "start", {}, now);
  command(state, rep, "claimRepresentative", {}, now);
  command(state, rep, "roll", {}, now, () => 6);
  tick(state, state.transitionAt);
  tick(state, state.transitionAt);
  command(state, host, "pause", {}, state.presentation.startedAt + 100);
  await store.mutate(code, () => ({ state }));
  await store.close();
  let app = await fixture(file);
  const sockets = [];
  try {
    const paused = (await api(app.url, `/api/rooms/${code}/state`, null, credential)).body;
    assert.equal(paused.presentation.kind, "penalty");
    assert.equal(paused.teams.east.position, 6);
    const eventId = paused.presentation.id;
    await api(app.url, `/api/rooms/${code}/players`, { team: "central", nickname: "晚加入员工" });
    assert.equal((await app.store.read(code)).presentation.id, eventId);
    await app.close();
    app = await fixture(file);
    const screen = io(app.url, { auth: { room: code, role: "screen" }, transports: ["websocket"] });
    sockets.push(screen);
    const restored = await waitState(screen, (s) => s.phase === "tile_event");
    assert.equal(restored.presentation.id, eventId);
    assert.equal(restored.presentation.effect, "后退2格");
    const movement = waitState(screen, (s) => s.phase === "moving" && s.movement.kind === "effect");
    await api(app.url, `/api/rooms/${code}/commands`, { type: "resume" }, credential);
    const moving = await movement;
    assert.equal(moving.teams.east.position, 4);
    assert.equal(moving.presentation, null);
    const completed = await waitState(screen, (s) => s.phase === "turn_complete");
    assert.equal(completed.quiz, null);
    assert.equal(completed.presentation, null);
    assert.equal(completed.events.filter((e) => e.type === "tile_event").length, 1);
    assert.equal((await app.store.read(code)).usedQuestions.length, 0);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a burst of commands is acknowledged durably while screen snapshots are coalesced", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "monopoly-broadcast-"),
  );
  const app = await fixture(path.join(directory, "state.sqlite"));
  const sockets = [];
  try {
    const created = (await api(app.url, "/api/rooms", {})).body;
    const screen = io(app.url, {
      auth: { room: created.code, role: "screen" },
      transports: ["websocket"],
    });
    sockets.push(screen);
    const initial = await waitState(screen, (s) => s.code === created.code);
    const host = io(app.url, {
      auth: { room: created.code, role: "host", token: created.token },
      transports: ["websocket"],
    });
    sockets.push(host);
    await waitState(host, (s) => s.code === created.code);
    const versions = [];
    screen.on("state:update", (s) => {
      if (s.version > initial.version) versions.push(s.version);
    });
    const updated = waitState(screen, (s) => s.version >= initial.version + 8);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        host.timeout(5000).emitWithAck("command", {
          type: "settings",
          payload: { answerSeconds: 20 + i },
        }),
      ),
    );
    assert(results.every((r) => r.ok));
    const final = await updated;
    assert.equal(final.settings.answerSeconds, 27);
    assert(
      versions.length < 8,
      `expected coalescing, got ${versions.length} snapshots`,
    );
    assert.equal((await app.store.read(created.code)).version, final.version);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("revoking one player updates every remaining connection online count", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "monopoly-presence-"),
  );
  const app = await fixture(path.join(directory, "state.sqlite"));
  const sockets = [];
  try {
    const room = (await api(app.url, "/api/rooms", {})).body;
    const first = (
      await api(app.url, `/api/rooms/${room.code}/players`, {
        team: "east",
        nickname: "first",
      })
    ).body;
    const second = (
      await api(app.url, `/api/rooms/${room.code}/players`, {
        team: "east",
        nickname: "second",
      })
    ).body;
    for (const [role, token] of [
      ["host", room.token],
      ["player", first.token],
      ["player", second.token],
    ]) {
      const socket = io(app.url, {
        auth: { room: room.code, role, token },
        transports: ["websocket"],
      });
      sockets.push(socket);
      await waitState(socket, (s) => s.code === room.code);
    }
    const remaining = sockets[2];
    const updated = waitState(remaining, (s) => s.onlineCount === 1);
    const removed = await api(
      app.url,
      `/api/rooms/${room.code}/commands`,
      { type: "removePlayer", payload: { playerId: first.playerId } },
      room.token,
    );
    assert.equal(removed.status, 200);
    const final = await updated;
    assert.equal(final.teams.east.members, 1);
    assert.equal(final.teams.east.online, 1);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
