import { test } from "node:test";
import assert from "node:assert/strict";
import { newRoom, command, tick, publicState, prizeCandidates, upgradeFirstWinner } from "../server/lib/engine.js";
import { EVENT_ROOM_CODE } from "../shared/siteSettings.js";
import { TEAM_ORDER } from "../shared/gameRules.js";
import { votePercentage } from "../shared/votePercentages.js";
import { tileMessages } from "../shared/tileMessages.js";

const host = { role: "host" }, now = 100000;
const player = (id) => ({ role: "player", playerId: id });
function quiz() {
  const s = newRoom(EVENT_ROOM_CODE, "hosthash");
  for (let i = 0; i < 12; i++) s.players[`p${i}`] = { id: `p${i}`, team: "east", nickname: `员工${i}`, removed: false };
  s.players.outside = { id: "outside", team: "north", nickname: "旁观者", removed: false };
  s.status = "running";
  s.phase = "quiz_ready";
  s.teams.east.position = 4;
  command(s, host, "saveQuestion", { id: "tie-test", tile: 0, text: "测试", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "A" }, now);
  command(s, host, "startQuiz", { questionId: "tie-test", seconds: 30 }, now);
  return s;
}
function vote(s, values, time = now + 1) {
  values.forEach((option, i) => command(s, player(`p${i}`), "answer", { option }, time));
}

test("2, 3 and 4 top options each cause only one private, restricted 15-second revote", () => {
  for (const initial of [["A", "B"], ["A", "B", "C"], ["A", "B", "C", "D"]]) {
    const s = quiz(), originalBallot = s.quiz.ballotId;
    vote(s, initial);
    tick(s, now + 30000);
    assert.equal(s.phase, "answering");
    assert.equal(s.quiz.revote, true);
    assert.equal(s.quiz.endsAt, now + 45000);
    assert.notEqual(s.quiz.ballotId, originalBallot);
    assert.deepEqual(s.quiz.allowedOptions, initial);
    assert.deepEqual(s.quiz.answers, {});
    assert.equal(publicState(s, player("outside")).quiz.question.answer, undefined);
    assert.equal(publicState(s, player("p0")).quiz.myAnswer, null);
    assert.throws(() => command(s, player("outside"), "answer", { option: "A" }, now + 30001), /当前队伍/);
    if (initial.length < 4) assert.throws(() => command(s, player("p0"), "answer", { option: "D" }, now + 30001), /并列的选项/);
    vote(s, initial, now + 30002);
    tick(s, now + 45000);
    assert.equal(s.phase, "quiz_closed");
    assert.equal(s.events.filter((e) => e.type === "quiz_revote").length, 1);
    command(s, host, "reveal", {}, now + 45001);
    assert.equal(s.quiz.result.tiedAccepted, true);
    assert.equal(s.quiz.result.correct, true);
    assert.throws(() => command(s, player("p0"), "answer", { option: "A" }, now + 45002), /截止/);
  }
});

test("the accepted revote tie grants the normal tile reward even if the correct option was eliminated", () => {
  const s = quiz();
  vote(s, ["B", "C"]);
  command(s, host, "closeQuiz", {}, now + 100);
  vote(s, ["B", "C"], now + 101);
  command(s, host, "closeQuiz", {}, now + 102);
  command(s, host, "reveal", {}, now + 103);
  assert.equal(s.quiz.result.correctAnswer, "A");
  assert.equal(s.quiz.result.correct, true);
  tick(s, s.transitionAt);
  assert.equal(s.teams.east.position, 7);
});

test("a unique revote answer is judged normally, and empty revotes never receive a free reward", () => {
  for (const final of [[], ["B"], ["A"]]) {
    const s = quiz();
    vote(s, ["A", "B"]);
    command(s, host, "closeQuiz", {}, now + 10);
    vote(s, final, now + 11);
    command(s, host, "closeQuiz", {}, now + 12);
    command(s, host, "reveal", {}, now + 13);
    assert.equal(s.quiz.result.correct, final[0] === "A");
    assert.equal(s.quiz.result.tiedAccepted, false);
  }
});

test("30/30/20/20 uses raw highest counts, and lower ties do not trigger revoting", () => {
  const s = quiz();
  vote(s, ["A", "A", "A", "B", "B", "B", "C", "C", "D", "D"]);
  command(s, host, "closeQuiz", {}, now + 10);
  assert.deepEqual(s.quiz.allowedOptions, ["A", "B"]);
  const other = quiz();
  vote(other, ["A", "A", "B", "C", "D"]);
  command(other, host, "closeQuiz", {}, now + 10);
  assert.equal(other.phase, "quiz_closed");
  assert.equal(other.quiz.revote, false);
});

test("pause, serialized reload and resume preserve the revote deadline and ballot identity", () => {
  let s = quiz();
  vote(s, ["A", "B"]);
  command(s, host, "closeQuiz", {}, now + 10);
  command(s, host, "pause", {}, now + 11);
  const ballot = s.quiz.ballotId, deadline = s.quiz.endsAt;
  s = JSON.parse(JSON.stringify(s));
  assert.equal(tick(s, now + 100000), false);
  command(s, host, "resume", {}, now + 1011);
  assert.equal(s.quiz.endsAt, deadline + 1000);
  assert.equal(s.quiz.ballotId, ballot);
  assert.equal(s.quiz.revote, true);
});

test("percentages use submitted votes, handle no answers, preserve true ties and distinguish close counts", () => {
  const counts = { A: 3, B: 3, C: 2, D: 2 };
  assert.deepEqual(Object.keys(counts).map((key) => votePercentage(counts, key)), ["30%", "30%", "20%", "20%"]);
  assert.equal(votePercentage({ A: 0, B: 0, C: 0, D: 0 }, "A"), "0%");
  assert.notEqual(votePercentage({ A: 1001, B: 1002, C: 1498, D: 1499 }, "A"), votePercentage({ A: 1001, B: 1002, C: 1498, D: 1499 }, "B"));
});

test("official first winner celebrates only after arrival and blocks all further turns until host ends", () => {
  for (const position of [18, 19]) {
    const s = newRoom(EVENT_ROOM_CODE, "hosthash");
    s.teams.east.position = position;
    command(s, host, "start", {}, now);
    s.players.rep = { id: "rep", nickname: "代表", team: "east", removed: false };
    command(s, host, "setTeamRepresentative", { team: "east", playerId: "rep" }, now);
    command(s, player("rep"), "roll", {}, now, () => 1);
    tick(s, s.transitionAt);
    assert.equal(s.status, "running");
    assert.equal(s.victory, null);
    while (s.transitionAt && s.status === "running") tick(s, s.transitionAt);
    assert.equal(s.status, "champion");
    assert.equal(s.victory.team, "east");
    assert.equal(s.transitionAt, null);
    assert.equal(publicState(s, host).autoNextAt, null);
    assert.equal(tick(s, now + 1000000), false);
    assert.throws(() => command(s, host, "next"), /未进行|已暂停/);
    assert.throws(() => command(s, player("rep"), "roll"), /未进行|已暂停/);
    assert.throws(() => command(s, host, "resume"), /未暂停/);
    const id = s.victory.id;
    const reloaded = JSON.parse(JSON.stringify(s));
    assert.equal(reloaded.victory.id, id);
    command(s, host, "end");
    assert.equal(s.status, "finished");
    assert.equal(s.victory.id, id);
    command(s, host, "reset", { confirm: EVENT_ROOM_CODE });
    assert.equal(s.victory, null);
  }
});

test("answer and manual correction routes also stop on the official first winner; prizes contain three second awards", () => {
  const s = quiz();
  s.teams.east.position = 15;
  s.quiz.tile = 15;
  vote(s, ["A"]);
  command(s, host, "closeQuiz", {}, now + 10);
  command(s, host, "reveal", {}, now + 11);
  while (s.transitionAt && s.status === "running") tick(s, s.transitionAt);
  assert.equal(s.status, "champion");
  const other = newRoom(EVENT_ROOM_CODE, "hosthash");
  command(other, host, "start", {}, now);
  command(other, host, "pause", {}, now + 1);
  command(other, host, "manualMove", { team: "north", position: 20, reason: "现场修正" }, now + 2);
  assert.equal(other.victory.team, "north");
  command(other, host, "end");
  for (let i = 0; i < TEAM_ORDER.length; i++) if (TEAM_ORDER[i] !== "north") other.teams[TEAM_ORDER[i]].position = 10 - i;
  assert.deepEqual(prizeCandidates(other).prizes.map((prize) => prize.quantity), [1, 3, 5]);
  assert.equal(tileMessages[9], "天降玩具盲盒");
});

test("existing official games with a winner stop after upgrade, and a winning move still finishes before celebration", () => {
  const s = newRoom(EVENT_ROOM_CODE, "hosthash");
  s.status = "running";
  s.currentTeam = "central";
  s.teams.east.position = 20;
  s.teams.east.finishOrder = 1;
  assert(upgradeFirstWinner(s, now));
  const id = s.victory.id;
  assert.equal(s.status, "champion");
  assert.equal(upgradeFirstWinner(s), false);
  assert.equal(s.victory.id, id);
  s.status = "running";
  s.phase = "moving";
  s.currentTeam = "east";
  s.victory = null;
  assert.equal(upgradeFirstWinner(s), false);
  assert.equal(s.victory, null);
});
