import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize, hash } from "../server/lib/auth.js";
import {
  newRoom,
  command,
  tick,
  publicState,
  prizeCandidates,
  seedQuestionBank,
  validateQuestion,
  upgradeTurnAutomation,
} from "../server/lib/engine.js";
import { BUILTIN_QUESTIONS, availableQuestions, questionKey } from "../server/lib/questions.js";
import { TEAM_ORDER, TILES, tally, rankings } from "../shared/gameRules.js";
const host = { role: "host" },
  player = (id) => ({ role: "player", playerId: id }),
  NOW = 10000;
function room() {
  const s = newRoom("123456", "hosthash");
  for (const id of TEAM_ORDER) {
    s.players[id] = { id, nickname: "", team: null, removed: false };
    command(s, player(id), "join", { team: id, nickname: id }, NOW);
  }
  return s;
}
function start(s) {
  command(s, host, "start", {}, NOW);
}
function onlineRoll(s, value) {
  command(s, player(s.currentTeam), "claimRepresentative", {}, NOW);
  command(s, player(s.currentTeam), "roll", { value: 99 }, NOW, () => value);
}
function settle(s) {
  for (let i = 0; i < 30 && s.transitionAt && s.status === "running" && s.phase !== "turn_complete"; i++)
    tick(s, s.transitionAt);
}
function toQuiz(tile = 4) {
  const s = room();
  start(s);
  s.teams.east.position = tile - 1;
  onlineRoll(s, 1);
  settle(s);
  assert.equal(s.phase, "quiz_ready");
  command(
    s,
    host,
    "saveQuestion",
    {
      id: `test-question-${tile}`,
      tile,
      text: "测试题目（非正式品牌题）",
      options: { A: "一", B: "二", C: "三", D: "四" },
      answer: "A",
      explanation: "仅用于自动化测试",
    },
    NOW,
  );
  command(s, host, "startQuiz", { questionId: `test-question-${tile}` }, NOW);
  return s;
}
function reveal(s) {
  command(s, host, "closeQuiz", {}, NOW + 100);
  command(s, host, "reveal", {}, NOW + 200);
  settle(s);
}
test("20 tiles, exact five teams/colors, no score fields", () => {
  const s = room();
  assert.equal(TILES.length, 20);
  assert.deepEqual(s.order, ["east", "central", "north", "west", "shanghai"]);
  assert.equal(s.teams.east.color, "#2F80ED");
  assert.equal(s.teams.shanghai.name, "上海SSC");
  assert.equal(Object.values(s.players).filter((p) => p.team).length, 5);
  assert(!/score|bonusSteps|points/.test(JSON.stringify(s)));
});
test("online dice is backend-generated: 4 moves from 0 to tile04, duplicate rolls blocked", () => {
  const s = room();
  start(s);
  onlineRoll(s, 4);
  assert.equal(s.dice.value, 4);
  assert.throws(() => command(s, player("east"), "roll", {}, NOW), /已投骰/);
  settle(s);
  assert.equal(s.teams.east.position, 4);
  assert.equal(s.phase, "quiz_ready");
  assert.throws(() => command(s, host, "next"), /先完成/);
});
test("physical Shanghai dice 5, normal players cannot roll or enter result; undo restores full game", () => {
  const s = room();
  s.currentTeam = "shanghai";
  start(s);
  assert.throws(
    () => command(s, player("shanghai"), "physicalDice", { value: 5 }, NOW),
    /主持人/,
  );
  command(s, host, "physicalDice", { value: 5 }, NOW);
  tick(s, s.transitionAt);
  assert.equal(s.teams.shanghai.position, 5);
  settle(s);
  assert.equal(s.teams.shanghai.position, 4);
  command(s, host, "undo", {}, NOW);
  assert.equal(s.teams.shanghai.position, 0);
  assert.equal(s.phase, "awaiting_dice");
  assert.equal(s.dice, null);
  assert.equal(s.events[s.events.length - 1].type, "undo");
});
test("tile02 reward +2 to04 does not chain into quiz", () => {
  const s = room();
  start(s);
  onlineRoll(s, 2);
  settle(s);
  assert.equal(s.teams.east.position, 4);
  assert.equal(s.phase, "turn_complete");
  assert.equal(s.quiz, null);
});
test("tile06 punishment -2 to04 does not chain", () => {
  const s = room();
  s.currentTeam = "north";
  start(s);
  onlineRoll(s, 6);
  settle(s);
  assert.equal(s.teams.north.position, 4);
  assert.equal(s.phase, "turn_complete");
});
test("all reward/penalty tiles obey exact table; movement clamps", () => {
  for (const tile of TILES.filter((t) =>
    ["reward", "penalty"].includes(t.type),
  )) {
    const s = room();
    start(s);
    s.teams.east.position = tile.id - 1;
    onlineRoll(s, 1);
    settle(s);
    assert.equal(
      s.teams.east.position,
      Math.min(20, tile.id + tile.effect),
      tile.name,
    );
  }
  const s = room();
  start(s);
  s.teams.east.position = 18;
  onlineRoll(s, 6);
  settle(s);
  assert.equal(s.teams.east.position, 20);
});
test("normal, reward, penalty and finish turns auto-advance only after all movement finishes", () => {
  for (const tile of TILES.filter((t) => t.type !== "quiz")) {
    const s = room();
    assert.equal(s.settings.autoAdvance, true);
    s.teams.east.position = tile.id - 1;
    start(s);
    onlineRoll(s, 1);
    while (["rolling", "moving", "tile_event"].includes(s.phase)) {
      assert.equal(s.currentTeam, "east");
      assert.equal(publicState(s, host).autoNextAt, null);
      tick(s, s.transitionAt);
    }
    assert.equal(s.phase, "turn_complete");
    assert.equal(s.currentTeam, "east");
    const due = s.transitionAt;
    assert(due, `missing automatic handoff for tile ${tile.id}`);
    assert.equal(publicState(s, host).autoNextAt, due);
    assert.equal(tick(s, due - 1), false);
    assert(tick(s, due));
    assert.equal(s.currentTeam, "central");
    assert.equal(s.phase, "awaiting_dice");
    assert.equal(s.dice, null);
    assert.equal(s.teams.central.representativeId, null);
    assert.equal(tick(s, due + 100000), false);
    assert.equal(s.events.filter((e) => e.type === "next").length, 1);
  }
});
test("automatic handoff skips finished teams and waits for Shanghai physical dice and manual next", () => {
  const s = room();
  s.teams.central.position = 20;
  s.teams.central.finishOrder = 1;
  start(s);
  onlineRoll(s, 1);
  settle(s);
  tick(s, s.transitionAt);
  assert.equal(s.currentTeam, "north");
  onlineRoll(s, 1);
  settle(s);
  tick(s, s.transitionAt);
  assert.equal(s.currentTeam, "west");
  onlineRoll(s, 1);
  settle(s);
  tick(s, s.transitionAt);
  assert.equal(s.currentTeam, "shanghai");
  assert.equal(s.phase, "awaiting_dice");
  assert.equal(s.transitionAt, null);
  command(s, host, "physicalDice", { value: 1 }, NOW);
  settle(s);
  assert.equal(s.phase, "turn_complete");
  assert.equal(s.transitionAt, null);
  command(s, host, "settings", { autoAdvance: true }, NOW);
  assert.equal(s.transitionAt, null);
  assert.equal(tick(s, NOW + 100000), false);
  assert.equal(s.currentTeam, "shanghai");
  command(s, host, "next", {}, NOW);
  assert.equal(s.currentTeam, "east");
  assert.equal(s.round, 2);
});
test("quiz-ready, correct and incorrect quiz turns always wait for host next even with automation enabled", () => {
  const waiting = room();
  start(waiting);
  onlineRoll(waiting, 4);
  settle(waiting);
  assert.equal(waiting.phase, "quiz_ready");
  assert.equal(tick(waiting, NOW + 100000), false);
  assert.equal(waiting.currentTeam, "east");
  for (const tile of [4, 8, 12, 15, 16]) {
    for (const option of ["A", "B"]) {
      const s = toQuiz(tile);
      command(s, player("east"), "answer", { option }, NOW + 1);
      reveal(s);
      assert.equal(s.phase, "turn_complete");
      assert.equal(s.transitionAt, null);
      assert.equal(publicState(s, host).autoNextAt, null);
      command(s, host, "settings", { autoAdvance: true }, NOW);
      assert.equal(s.transitionAt, null);
      assert.equal(tick(s, NOW + 100000), false);
      assert.equal(s.currentTeam, "east");
      command(s, host, "next", {}, NOW);
      assert.equal(s.currentTeam, "central");
    }
  }
});
test("automatic handoff respects pause, disabling automation and safe undo", () => {
  const s = room();
  start(s);
  onlineRoll(s, 3);
  settle(s);
  const due = s.transitionAt;
  command(s, host, "pause", {}, due - 500);
  assert.equal(publicState(s, host).autoNextAt, null);
  assert.equal(tick(s, due + 1000), false);
  command(s, host, "resume", {}, due + 4500);
  assert.equal(s.transitionAt, due + 5000);
  command(s, host, "settings", { autoAdvance: false }, due + 4501);
  assert.equal(s.transitionAt, null);
  assert.equal(tick(s, due + 10000), false);
  command(s, host, "settings", { autoAdvance: true }, due + 10000);
  assert.equal(s.transitionAt, due + 11800);
  command(s, host, "next", {}, due + 10001);
  command(s, host, "undo", {}, due + 10002);
  assert.equal(s.currentTeam, "east");
  assert.equal(s.phase, "turn_complete");
  assert.equal(s.transitionAt, null);
  assert.equal(tick(s, due + 100000), false);
  command(s, host, "next", {}, due + 100003);
  assert.equal(s.currentTeam, "central");
});
test("old rooms enable selective automation once and preserve later host choices", () => {
  const s = room();
  s.settings.autoAdvance = false;
  delete s.turnAutomationVersion;
  s.round = 5;
  assert(upgradeTurnAutomation(s, NOW));
  assert.equal(s.settings.autoAdvance, true);
  assert.equal(s.round, 5);
  command(s, host, "settings", { autoAdvance: false }, NOW);
  assert.equal(upgradeTurnAutomation(s, NOW + 100), false);
  assert.equal(s.settings.autoAdvance, false);
  const paused = room();
  start(paused);
  onlineRoll(paused, 1);
  settle(paused);
  command(paused, host, "pause", {}, paused.transitionAt - 500);
  delete paused.turnAutomationVersion;
  assert(upgradeTurnAutomation(paused, NOW + 100000));
  assert.equal(paused.transitionAt, paused.pausedAt + 1800);
  assert.equal(tick(paused, NOW + 100000), false);
});
test("every special landing holds a server-timed 2.5 second presentation before its action", () => {
  for (const tile of TILES.filter((t) => t.type !== "normal")) {
    const s = room();
    s.teams.east.position = tile.id - 1;
    start(s);
    onlineRoll(s, 1);
    tick(s, s.transitionAt);
    tick(s, s.transitionAt);
    assert.equal(s.phase, "tile_event");
    assert.equal(s.teams.east.position, tile.id);
    assert.equal(s.presentation.tile, tile.id);
    assert.equal(s.presentation.kind, tile.type);
    assert(s.presentation.title);
    const due = s.presentation.endsAt;
    assert.equal(due - s.presentation.startedAt, 2500);
    assert.equal(tick(s, due - 1), false);
    assert.equal(s.teams.east.position, tile.id);
    assert.throws(() => command(s, host, "next", {}, due - 1), /先完成/);
    if (tile.type === "quiz")
      assert.throws(() => command(s, host, "startQuiz", {}, due - 1), /待答题格/);
    tick(s, due);
    assert.equal(s.presentation, null);
    if (["reward", "penalty"].includes(tile.type)) {
      assert.equal(s.phase, "moving");
      assert.equal(s.movement.kind, "effect");
      assert.equal(s.teams.east.position, Math.min(20, tile.id + tile.effect));
    } else assert.equal(s.phase, tile.type === "quiz" ? "quiz_ready" : "turn_complete");
  }
  const ordinary = room();
  start(ordinary);
  onlineRoll(ordinary, 1);
  settle(ordinary);
  assert.equal(ordinary.presentation, null);
  assert.equal(ordinary.events.filter((e) => e.type === "tile_event").length, 0);
});
test("dinosaur 6-to-4 presentation never chains a second quiz or effect", () => {
  const s = room();
  start(s);
  onlineRoll(s, 6);
  tick(s, s.transitionAt);
  tick(s, s.transitionAt);
  assert.equal(s.presentation.title, "糟糕！调皮恐龙拦住去路！");
  assert.equal(s.presentation.effect, "后退2格");
  assert.equal(s.teams.east.position, 6);
  tick(s, s.transitionAt);
  assert.equal(s.movement.to, 4);
  settle(s);
  assert.equal(s.phase, "turn_complete");
  assert.equal(s.teams.east.position, 4);
  assert.equal(s.quiz, null);
  assert.deepEqual(s.usedQuestions, []);
  assert.equal(s.events.filter((e) => e.type === "tile_event").length, 1);
  assert.equal(s.events.filter((e) => e.type === "quiz_ready").length, 0);
});
test("correct-answer presentation cannot be skipped and common-pool tile15 still shows direct finish", () => {
  for (const tile of [4, 15, 16]) {
    const s = room();
    s.teams.east.position = tile - 1;
    start(s);
    onlineRoll(s, 1);
    settle(s);
    command(s, host, "startQuiz", {}, NOW);
    assert.equal(s.quiz.question.tile, 0);
    assert.equal(publicState(s, host).quiz.tile, tile);
    command(s, player("east"), "answer", { option: s.quiz.question.answer }, NOW + 1);
    command(s, host, "closeQuiz", {}, NOW + 2);
    command(s, host, "reveal", {}, NOW + 3);
    const due = s.transitionAt;
    assert.equal(due, NOW + 2503);
    assert.equal(s.presentation.kind, "correct");
    assert.equal(s.presentation.effect, tile === 15 ? "直达终点" : "前进3格");
    assert.equal(tick(s, due - 1), false);
    assert.throws(() => command(s, host, "applyAnswer", {}, due - 1), /展示结束/);
    assert.equal(s.teams.east.position, tile);
    tick(s, due);
    assert.equal(s.presentation, null);
    assert.equal(s.movement.kind, "answer");
    settle(s);
    assert.equal(s.teams.east.position, tile === 15 ? 20 : tile + 3);
    assert.equal(s.phase, "turn_complete");
    assert.equal(s.transitionAt, null);
    assert.equal(s.events.filter((e) => e.type === "tile_event").length, 1);
  }
});
test("special presentation pauses, resumes and undoes without leaving stale effects", () => {
  const s = room();
  start(s);
  onlineRoll(s, 6);
  tick(s, s.transitionAt);
  tick(s, s.transitionAt);
  const before = structuredClone(s.presentation);
  command(s, host, "pause", {}, before.startedAt + 100);
  assert.equal(tick(s, before.endsAt + 10000), false);
  command(s, host, "resume", {}, before.startedAt + 10100);
  assert.equal(s.presentation.startedAt, before.startedAt + 10000);
  assert.equal(s.presentation.endsAt, before.endsAt + 10000);
  assert.equal(s.transitionAt, s.presentation.endsAt);
  delete s.undo.game.presentation; // A checkpoint saved by the previous release.
  command(s, host, "undo", {}, before.startedAt + 10200);
  assert.equal(s.presentation, null);
  assert.equal(s.phase, "awaiting_dice");
  assert.equal(s.transitionAt, null);
  assert.equal(s.teams.east.position, 0);
});
test("10 concurrent-style answers, updates replace old vote; plurality <50% still correct", () => {
  const s = toQuiz();
  for (let n = 0; n < 10; n++) {
    const id = "voter" + n;
    s.players[id] = { id, nickname: "", team: null };
    command(s, player(id), "join", { team: "east", nickname: id }, NOW);
    command(s, player(id), "answer", { option: "D" }, NOW + 10);
    command(
      s,
      player(id),
      "answer",
      { option: n < 4 ? "A" : n < 7 ? "B" : n < 9 ? "C" : "D" },
      NOW + 20,
    );
  }
  assert.equal(Object.keys(s.quiz.answers).length, 10);
  assert.deepEqual(tally(s.quiz.answers, "A").counts, {
    A: 4,
    B: 3,
    C: 2,
    D: 1,
  });
  reveal(s);
  assert.equal(s.teams.east.position, 7);
  assert.equal(s.quiz.result.correct, true);
});
test("wrong answer on08, tie and zero votes never grant reward", () => {
  for (const mode of ["wrong", "tie", "empty"]) {
    const s = toQuiz(8);
    if (mode !== "empty")
      command(
        s,
        player("east"),
        "answer",
        { option: mode === "tie" ? "A" : "B" },
        NOW + 10,
      );
    if (mode === "tie") {
      s.players.other = { id: "other", nickname: "同队", team: "east" };
      command(s, player("other"), "answer", { option: "B" }, NOW + 20);
    }
    reveal(s);
    assert.equal(s.teams.east.position, 8);
    assert.equal(s.quiz.result.correct, false);
  }
});
test("tile15 correct goes straight to20, incorrect stays15", () => {
  for (const answer of ["A", "B"]) {
    const s = toQuiz(15);
    command(s, player("east"), "answer", { option: answer }, NOW + 10);
    reveal(s);
    assert.equal(s.teams.east.position, answer === "A" ? 20 : 15);
    assert.equal(!!s.teams.east.finishOrder, answer === "A");
  }
});
test("tile19 accelerator reaches finish and first finisher does not end other teams", () => {
  const s = room();
  start(s);
  s.teams.east.position = 18;
  onlineRoll(s, 1);
  settle(s);
  assert.equal(s.teams.east.position, 20);
  assert.equal(s.teams.east.finishOrder, 1);
  assert(s.teams.east.finishedAt);
  assert.equal(s.status, "running");
  command(s, host, "next", {}, NOW);
  assert.equal(s.currentTeam, "central");
});
test("finished teams skipped, no three-round limit, all finish ends game", () => {
  const s = room();
  start(s);
  s.round = 8;
  s.currentTeam = "shanghai";
  s.phase = "turn_complete";
  s.teams.east.position = 20;
  s.teams.east.finishOrder = 1;
  command(s, host, "next", {}, NOW);
  assert.equal(s.currentTeam, "central");
  assert.equal(s.round, 9);
  for (const id of TEAM_ORDER) {
    s.teams[id].position = 20;
    s.teams[id].finishOrder = TEAM_ORDER.indexOf(id) + 1;
  }
  s.currentTeam = "central";
  s.phase = "moving";
  s.movement = { kind: "effect" };
  s.transitionAt = NOW;
  tick(s, NOW);
  assert.equal(s.status, "finished");
});
test("finish order dominates position; unfinished same position ties without extra criteria", () => {
  const s = room();
  s.teams.east.position = 20;
  s.teams.east.finishOrder = 1;
  s.teams.north.position = 15;
  s.teams.central.position = 15;
  s.teams.west.position = 10;
  const r = rankings(s.teams);
  assert.equal(r[0].id, "east");
  assert.equal(r[1].rank, 2);
  assert.equal(r[2].rank, 2);
  assert.equal(r[3].rank, 4);
});
test("host-only controls, private answer filtering, cross-team votes, cutoff and pause", () => {
  const s = toQuiz();
  assert.throws(
    () => command(s, player("north"), "answer", { option: "A" }, NOW + 10),
    /当前队伍/,
  );
  assert.throws(
    () =>
      command(s, player("east"), "manualMove", {
        team: "east",
        position: 20,
        reason: "forged",
      }),
    /主持人/,
  );
  for (const actor of [player("east"), { role: "screen" }]) {
    const view = publicState(s, actor);
    assert.equal(view.quiz.question.answer, undefined);
    assert.equal(view.quiz.answers, undefined);
    assert.equal(view.quiz.counts, undefined);
    assert.equal(view.questions, undefined);
    assert.equal(view.hostHash, undefined);
    assert.equal(view.players, undefined);
  }
  assert.equal(publicState(s, host).quiz.question.answer, "A");
  assert.equal(
    publicState(s, host).questionUsage[0].questionId,
    s.quiz.question.id,
  );
  assert.equal(publicState(s, { role: "screen" }).questionUsage, undefined);
  command(s, host, "pause", {}, NOW + 100);
  assert.throws(
    () => command(s, player("east"), "answer", { option: "A" }, NOW + 200),
    /暂停/,
  );
  const end = s.quiz.endsAt;
  command(s, host, "resume", {}, NOW + 1100);
  assert.equal(s.quiz.endsAt, end + 1000);
  assert.throws(
    () => command(s, player("east"), "answer", { option: "A" }, s.quiz.endsAt),
    /截止/,
  );
});
test("empty question banks never fabricate questions; resets require room confirmation", () => {
  const s = room();
  s.questions = [];
  start(s);
  onlineRoll(s, 4);
  settle(s);
  assert.throws(() => command(s, host, "startQuiz"), /先添加/);
  assert.throws(() => command(s, host, "reset", { confirm: "bad" }), /确认/);
  command(s, host, "reset", { confirm: s.code });
  assert.equal(s.status, "waiting");
  assert.equal(s.teams.east.position, 0);
  assert.equal(Object.keys(s.players).length, 5);
  const used = toQuiz();
  command(used, host, "reset", { confirm: used.code }, NOW);
  assert.equal(publicState(used, host).questionUsage.length, 1);
});

test("approved built-in bank loads in every new room, deduplicates 20 source rows, and uses a shared pool", () => {
  const s = room();
  assert.equal(s.questions.length, 19);
  assert.equal(new Set(s.questions.map(questionKey)).size, 19);
  assert(s.questions.every((q) => q.tile === 0));
  s.questions.forEach(validateQuestion);
  for (const tile of [4, 8, 12, 15, 16])
    assert.equal(availableQuestions(s, tile).length, 19);
  const date = s.questions.find((q) => q.text.includes("具体时间"));
  assert.deepEqual(date.options, { A: "2006年6月", B: "2006年8月", C: "2006年10月", D: "2006年12月" });
  assert.equal(date.answer, "D");
  s.questions[0].text = "只在这个房间修改";
  assert.equal(room().questions[0].text, BUILTIN_QUESTIONS[0].text);
  assert.equal(publicState(s, { role: "screen" }).questions, undefined);
});

test("a full four-round five-team game draws all 19 questions without reuse across teams or tiles", () => {
  const s = room(), seen = new Set();
  start(s);
  for (let round = 1; round <= 4; round++) {
    for (const team of TEAM_ORDER) {
      assert.equal(s.currentTeam, team);
      const value = round === 4 ? 3 : round === 1 && team === "shanghai" ? 2 : 4;
      if (team === "shanghai") command(s, host, "physicalDice", { value }, NOW);
      else onlineRoll(s, value);
      settle(s);
      if (s.phase === "quiz_ready") {
        command(s, host, "startQuiz", {}, NOW);
        const key = questionKey(s.quiz.question);
        assert(!seen.has(key), "question repeated during the same game");
        seen.add(key);
        if (round === 4)
          command(s, player(team), "answer", { option: s.quiz.question.answer }, NOW + 1);
        reveal(s);
      }
      if (s.status !== "finished") command(s, host, "next", {}, NOW);
    }
  }
  assert.equal(s.status, "finished");
  assert.equal(s.round, 4);
  assert.equal(seen.size, 19);
  assert.equal(s.usedQuestionKeys.length, 19);
  assert(Object.values(s.teams).every((team) => team.position === 20));
});

test("exhausted bank never wraps; imports, new IDs, option edits and punctuation cannot recycle a used question", () => {
  const s = room();
  start(s);
  const question = structuredClone(s.questions[0]);
  // Exhaust the bank across different teams/tiles without resetting the game.
  for (let i = 0; i < 19; i++) {
    s.currentTeam = TEAM_ORDER[i % 5];
    s.teams[s.currentTeam].position = [4, 8, 12, 15, 16][i % 5];
    s.phase = "quiz_ready";
    command(s, host, "startQuiz", {}, NOW);
    if (i === 0) {
      s.phase = "quiz_ready";
      assert.throws(() => command(s, host, "startQuiz", { questionId: s.quiz.question.id }, NOW), /已使用/);
    }
  }
  assert.equal(new Set(s.usedQuestionKeys).size, 19);
  s.phase = "quiz_ready";
  assert.throws(() => command(s, host, "startQuiz", {}, NOW), /用完/);
  assert.throws(() => command(s, host, "startQuiz", { questionId: question.id }, NOW), /用完/);
  command(s, host, "importQuestions", { questions: [{ ...question, id: "new-import-id" }] }, NOW);
  assert.equal(s.questions.length, 19);
  assert.throws(() => command(s, host, "saveQuestion", {
    ...question, id: "new-id", tile: 16,
    text: "  " + question.text.replace("？", " ? "),
    options: { ...question.options, A: "调整选项" },
  }, NOW), /相同问题/);
  assert.throws(() => command(s, host, "startQuiz", {}, NOW), /用完/);
  command(s, host, "reset", { confirm: s.code }, NOW);
  assert.equal(s.questions.length, 19);
  assert.equal(availableQuestions(s, 4).length, 19);
});

test("one-time migration preserves custom bank, progress and prior usage; deleting a built-in question stays respected", () => {
  const s = room(), question = { ...s.questions[0], id: "old-import-id", tile: 4 };
  s.questions = [question];
  s.usedQuestions = [question.id];
  delete s.usedQuestionKeys;
  delete s.questionBankVersion;
  s.round = 7;
  assert(seedQuestionBank(s));
  assert.equal(s.questions.length, 19);
  assert.equal(s.round, 7);
  assert.equal(availableQuestions(s, 4).length, 18);
  const unused = s.questions.find((q) => q.id !== question.id);
  command(s, host, "deleteQuestion", { id: unused.id }, NOW);
  assert(!seedQuestionBank(s));
  assert.equal(s.questions.length, 18);
});
test("lottery ranges respect ranks and tie confirmation, preserve every active employee", () => {
  const s = room();
  start(s);
  for (let n = 0; n < 5; n++) s.teams[TEAM_ORDER[n]].position = 20 - n;
  command(s, host, "end");
  let c = prizeCandidates(s);
  assert.equal(c.needsConfirmation, false);
  assert.deepEqual(
    c.prizes.map((p) => p.quantity),
    [1, 2, 5],
  );
  assert.deepEqual(
    c.prizes.map((p) => p.players.length),
    [1, 3, 5],
  );
  s.teams.central.position = 20;
  c = prizeCandidates(s);
  assert(c.needsConfirmation);
  command(s, host, "confirmPrizes", {
    first: ["east", "central"],
    second: ["east", "central", "north"],
  });
  assert.equal(prizeCandidates(s).prizes[0].players.length, 2);
});
test("submitting answers prevents unsafe undo; rejected action does not create a replacement answer", () => {
  const s = toQuiz();
  command(s, player("east"), "answer", { option: "A" }, NOW + 10);
  assert.throws(() => command(s, host, "undo"), /安全撤销/);
  const view = publicState(s, player("east"));
  assert.equal(view.quiz.myAnswer, "A");
  assert.equal(
    view.events.some((e) => e.type === "answer"),
    false,
  );
});

test("manual correction cannot corrupt a paused active quiz; pause survives a safe undo", () => {
  const s = toQuiz();
  command(s, host, "pause", {}, NOW + 10);
  assert.throws(
    () =>
      command(
        s,
        host,
        "manualMove",
        { team: "east", position: 1, reason: "错误修正" },
        NOW + 20,
      ),
    /未完成/,
  );
  assert.equal(s.teams.east.position, 4);
  const t = room();
  start(t);
  onlineRoll(t, 4);
  command(t, host, "pause", {}, NOW + 10);
  command(t, host, "undo", {}, NOW + 20);
  assert.equal(t.status, "paused");
  assert.equal(t.phase, "awaiting_dice");
  assert.equal(t.teams.east.position, 0);
});
test("manual finish leaves a valid next turn and its audit records the host", () => {
  const s = room();
  start(s);
  command(s, host, "pause", {}, NOW);
  command(
    s,
    host,
    "manualMove",
    { team: "east", position: 20, reason: "现场修正" },
    NOW + 1,
  );
  assert.equal(s.phase, "turn_complete");
  assert.equal(s.teams.east.finishOrder, 1);
  command(s, host, "resume", {}, NOW + 2);
  command(s, host, "next", {}, NOW + 3);
  assert.equal(s.currentTeam, "central");
  assert.equal(s.events[s.events.length - 1].actor, "host");
});

test("shared broadcast views preserve each player private answer and cached identity still checks its token", () => {
  const s = toQuiz();
  s.players.other = {
    id: "other",
    nickname: "other",
    team: "east",
    removed: false,
  };
  command(s, player("east"), "answer", { option: "A" }, NOW + 1);
  command(s, player("other"), "answer", { option: "B" }, NOW + 1);
  const shared = publicState(s, { role: "screen" });
  for (const id of ["east", "other"]) {
    const fast = publicState(s, player(id), new Set(), shared);
    const regular = publicState(s, player(id));
    delete fast.serverTime;
    delete regular.serverTime;
    assert.deepEqual(fast, regular);
    assert.equal(fast.quiz.answers, undefined);
    assert.equal(fast.quiz.counts, undefined);
    assert.equal(fast.quiz.question.answer, undefined);
  }
  assert.equal(shared.quiz.myAnswer, null);
  s.players.east.tokenHash = hash("east-fixture-token");
  s.players.other.tokenHash = hash("other-fixture-token");
  assert.deepEqual(
    authorize(s, "player", "east-fixture-token", "east"),
    player("east"),
  );
  assert.throws(
    () => authorize(s, "player", "east-fixture-token", "other"),
    /凭证/,
  );
});
