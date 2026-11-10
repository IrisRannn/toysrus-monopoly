import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createStore } from "../server/lib/store.js";
import { newRoom, command, tick, publicState } from "../server/lib/engine.js";
import { TEAM_ORDER } from "../shared/gameRules.js";
import { EVENT_ROOM_CODE, LEGACY_ROOM_CODE, PREVIEW_ROOM_CODE } from "../shared/siteSettings.js";

const host = { role: "host" };
const player = (id) => ({ role: "player", playerId: id });
test("host-only roster rejects self-assignment and unauthorized rolls, persists through rounds and resets, and clears invalid members", () => {
  const s = newRoom(PREVIEW_ROOM_CODE, "hosthash");
  assert.equal(s.settings.hostOnlyRepresentatives, true);
  assert.equal(EVENT_ROOM_CODE, "261218");
  assert.equal(newRoom(LEGACY_ROOM_CODE, "hosthash").settings.hostOnlyRepresentatives, false);
  for (const id of TEAM_ORDER) {
    s.players[id] = { id, team: null, removed: false };
    command(s, player(id), "join", { team: id, nickname: id });
    if (id !== "shanghai") command(s, host, "setTeamRepresentative", { team: id, playerId: id });
  }
  assert.throws(() => command(s, player("east"), "setTeamRepresentative", { team: "east", playerId: "east" }), /主持人/);
  assert.throws(() => command(s, host, "setTeamRepresentative", { team: "east", playerId: "central" }), /该队伍/);
  assert.throws(() => command(s, host, "setTeamRepresentative", { team: "shanghai", playerId: "shanghai" }), /线上/);
  assert.throws(() => command(s, host, "settings", { hostOnlyRepresentatives: "true" }), /开启或关闭/);
  command(s, host, "start");
  for (const id of TEAM_ORDER) {
    assert.equal(s.currentTeam, id);
    if (id !== "shanghai") {
      assert.equal(s.teams[id].representativeId, id);
      for (const type of ["claimRepresentative", "assignRepresentative"])
        assert.throws(() => command(s, player(id), type, { playerId: id }), /主持人指定/);
      assert.throws(() => command(s, player(id === "east" ? "central" : "east"), "roll"), /指定代表/);
      command(s, player(id), "roll", {}, Date.now(), () => 1);
      assert.throws(() => command(s, host, "setTeamRepresentative", { team: id, playerId: null }), /投骰前/);
    } else command(s, host, "physicalDice", { value: 1 });
    for (let i = 0; i < 10 && s.phase !== "turn_complete"; i++) tick(s, s.transitionAt);
    assert.equal(s.phase, "turn_complete");
    command(s, host, "next");
  }
  assert.equal(s.currentTeam, "east");
  assert.equal(s.round, 2);
  assert.equal(s.teams.east.representativeId, "east");
  command(s, host, "reset", { confirm: s.code });
  assert.equal(s.teams.east.position, 0);
  assert.equal(s.teams.east.representativeId, "east");
  assert.equal(s.representativeRoster.east, "east");
  assert.equal(publicState(s, player("east")).representativeRoster, undefined);
  command(s, host, "removePlayer", { playerId: "east" });
  assert.equal(s.teams.east.representativeId, null);
  assert.equal(s.representativeRoster.east, undefined);
  command(s, host, "changePlayerTeam", { playerId: "central", team: "west" });
  assert.equal(s.teams.central.representativeId, null);
  assert.equal(s.representativeRoster.central, undefined);
});

test("official room can be joined first, remains isolated from 261219, and retains host roster across restart without exposing the question bank", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-preview-"));
  const file = path.join(directory, "state.sqlite");
  async function fixture() {
    const store = await createStore({ databaseUrl: null, file });
    const instance = await createApp({ store, assetDirectory: path.join(directory, "assets") });
    await new Promise((resolve) => instance.server.listen(0, "127.0.0.1", resolve));
    return { ...instance, url: `http://127.0.0.1:${instance.server.address().port}` };
  }
  let app = await fixture();
  const api = async (route, body, token, role = "host") => {
    const response = await fetch(app.url + route, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-game-role": role, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const representative = await api(`/api/rooms/${PREVIEW_ROOM_CODE}/players`, { team: "east", nickname: "指定员工" });
    assert.equal(representative.status, 201);
    assert.deepEqual(await app.store.codes(), [PREVIEW_ROOM_CODE]);
    const viewer = await api(`/api/rooms/${PREVIEW_ROOM_CODE}/players`, { team: "east", nickname: "普通玩家" });
    const previewHost = (await api(`/api/rooms/${PREVIEW_ROOM_CODE}/host-session`, {})).body;
    const official = (await api(`/api/rooms/${LEGACY_ROOM_CODE}/host-session`, {})).body;
    const officialBefore = await app.store.read(LEGACY_ROOM_CODE);
    const post = (type, payload = {}, token = previewHost.token, role = "host") =>
      api(`/api/rooms/${PREVIEW_ROOM_CODE}/commands`, { type, payload }, token, role);
    assert.equal((await post("start")).status, 200);
    assert.equal((await post("claimRepresentative", {}, representative.body.token, "player")).status, 400);
    assert.equal((await post("assignRepresentative", { playerId: viewer.body.playerId }, viewer.body.token, "player")).status, 400);
    assert.equal((await post("setTeamRepresentative", { team: "east", playerId: viewer.body.playerId }, viewer.body.token, "player")).status, 400);
    assert.equal((await post("roll", {}, representative.body.token, "player")).status, 400);
    assert.equal((await post("setTeamRepresentative", { team: "east", playerId: representative.body.playerId })).status, 200);
    assert.equal((await post("roll", {}, viewer.body.token, "player")).status, 400);
    assert.equal((await post("roll", {}, representative.body.token, "player")).status, 200);
    await post("pause");
    await app.close();
    app = await fixture();
    const resumed = await api(`/api/rooms/${PREVIEW_ROOM_CODE}/state`, null, previewHost.token);
    assert.equal(resumed.body.status, "paused");
    assert.equal(resumed.body.representativeRoster.east, representative.body.playerId);
    assert.equal(resumed.body.settings.hostOnlyRepresentatives, true);
    const employeeView = (await api(`/api/rooms/${PREVIEW_ROOM_CODE}/state`, null, viewer.body.token, "player")).body;
    assert.equal(employeeView.representativeRoster, undefined);
    assert.equal(employeeView.players, undefined);
    assert.equal(employeeView.questions, undefined);
    assert.deepEqual(await app.store.read(LEGACY_ROOM_CODE), officialBefore);
    assert.equal((await api(`/api/rooms/${LEGACY_ROOM_CODE}/state`, null, official.token)).body.settings.hostOnlyRepresentatives, false);
    assert.equal((await api(`/api/rooms/${PREVIEW_ROOM_CODE}/state`, null, official.token)).status, 401);
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
