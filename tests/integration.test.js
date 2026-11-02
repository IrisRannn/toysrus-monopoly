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
const password = "integration-host-secret";
async function fixture(file) {
  const store = await createStore({ databaseUrl: null, file });
  const app = await createApp({ store, hostPassword: password });
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
    assert.equal(
      (await api(app.url, "/api/rooms", { password: "wrong" })).status,
      401,
    );
    const created = await api(app.url, "/api/rooms", { password });
    assert.equal(created.status, 201);
    const { code, token: host } = created.body;
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
