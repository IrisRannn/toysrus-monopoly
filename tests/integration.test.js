import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { io } from "socket.io-client";
import ExcelJS from "exceljs";
import { createApp } from "../server/index.js";
import { createStore } from "../server/lib/store.js";
import { importQuestions, safeCsv, COLUMNS } from "../server/lib/import.js";
import { newRoom } from "../server/lib/engine.js";
import { hash } from "../server/lib/auth.js";
async function fixture(file) {
  const store = await createStore({ databaseUrl: null, file });
  const app = await createApp({ store });
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
      { type: "claimRepresentative" },
      creds[0].token,
      "player",
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
