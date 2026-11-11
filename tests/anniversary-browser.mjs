// Always starts an isolated local game; never connects to an event deployment.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createStore } from "../server/lib/store.js";
import { tick } from "../server/lib/engine.js";
import { EVENT_ROOM_CODE, LEGACY_ROOM_CODE } from "../shared/siteSettings.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tru20-anniversary-browser-"));
const output = path.resolve(process.env.BROWSER_OUTPUT || path.join(directory, "screenshots"));
await fs.mkdir(output, { recursive: true });
const store = await createStore({ databaseUrl: null, file: path.join(directory, "game.sqlite") });
const app = await createApp({ store, assetDirectory: path.join(directory, "assets") });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  args: ["--mute-audio"],
});
const errors = [];
const contexts = [];
async function page(viewport) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  await context.addInitScript(() => {
    window.__oscillators = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) { window.__oscillators++; return original.apply(this, args); };
  });
  const result = await context.newPage();
  result.on("pageerror", (error) => errors.push(error.message));
  return result;
}
async function waitText(locator, text) {
  await locator.filter({ hasText: text }).first().waitFor();
}
try {
  const host = await page({ width: 1440, height: 1000 });
  await host.goto(base + "/host");
  assert.equal(await host.getByRole("textbox", { name: "游戏房间号", exact: true }).inputValue(), EVENT_ROOM_CODE);
  await host.getByRole("button", { name: `进入年会房间 ${EVENT_ROOM_CODE}`, exact: true }).click();
  await host.locator(".host-app").waitFor();
  const credential = await host.evaluate((room) => localStorage.getItem(`monopoly:${room}:host`), EVENT_ROOM_CODE);
  const headers = { "x-game-role": "host", Authorization: `Bearer ${credential}` };
  const command = async (type, payload = {}) => {
    const response = await host.request.post(base + `/api/rooms/${EVENT_ROOM_CODE}/commands`, { headers, data: { type, payload } });
    assert(response.ok(), await response.text());
  };
  const join = async (nickname, team, route = "/player") => {
    const p = await page({ width: 844, height: 390 });
    // A previously remembered room must not override the new official default.
    await p.goto(base + "/");
    await p.evaluate((room) => localStorage.setItem("monopoly:lastRoom", room), LEGACY_ROOM_CODE);
    await p.goto(base + route);
    assert.equal(await p.getByRole("textbox", { name: "游戏房间号", exact: true }).inputValue(), EVENT_ROOM_CODE);
    await p.getByPlaceholder("怎么称呼你？").fill(nickname);
    await p.getByRole("button", { name: new RegExp("^" + team) }).click();
    await p.getByRole("button", { name: "加入游戏 →", exact: true }).click();
    await p.locator(".experience-identity").filter({ hasText: nickname }).waitFor();
    return p;
  };
  const east = await join("东区观众", "东区");
  const north = await join("北区观众", "北区");
  const first = await join("上海答题甲", "上海SSC");
  const second = await join("上海答题乙", "上海SSC", "/player-preview");
  const screen = await page({ width: 1920, height: 1080 });
  await screen.goto(base + `/screen?room=${EVENT_ROOM_CODE}`);
  await screen.locator(".screen-app").waitFor();
  await command("start");
  await waitText(east.locator(".experience-turn"), "等待东区产生代表");
  assert.equal(await east.getByRole("button", { name: "🎲 投骰子", exact: true }).count(), 0);
  assert.equal(await east.getByRole("button", { name: "开启手机声音", exact: true }).getAttribute("aria-pressed"), "false");
  assert(await east.locator("audio").evaluate((audio) => audio.paused));
  await command("audioSettings", { bgmEnabled: true });
  await east.getByRole("button", { name: "开启手机声音", exact: true }).click();
  await east.waitForFunction(() => {
    const audio = document.querySelector("audio");
    return audio && !audio.paused && audio.readyState >= 2;
  });
  assert(await north.locator("audio").evaluate((audio) => audio.paused));
  await east.getByRole("button", { name: "静音手机", exact: true }).click();
  assert(await east.locator("audio").evaluate((audio) => audio.paused));
  await screen.getByRole("button", { name: "开启大屏声音", exact: true }).click();
  await screen.waitForFunction(() => !document.querySelector("audio").paused);
  await east.screenshot({ path: path.join(output, "official-player-landscape.png") });
  assert(await east.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log(`PASS official room ${EVENT_ROOM_CODE}, landscape default and alias, area representative wording, independent phone opt-in and screen BGM`);

  // Use the genuine physical-dice path to start a deterministic memory question.
  await command("reset", { confirm: EVENT_ROOM_CODE });
  await command("setOrder", { order: ["shanghai", "east", "central", "north", "west"] });
  await command("saveQuestion", { id: "browser-public-question", tile: 0, text: "全员观看验收题：请选择甲", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "A", explanation: "揭晓后才公开的解析" });
  await command("start");
  await command("physicalDice", { value: 4 });
  await store.mutate(EVENT_ROOM_CODE, (state) => {
    for (let i = 0; i < 20 && state.phase !== "quiz_ready"; i++) tick(state, state.transitionAt);
  });
  await command("startQuiz", { questionId: "browser-public-question", seconds: 120 });
  const players = [first, second, east, north];
  for (const p of players) {
    await p.getByRole("dialog", { name: "记忆大考验窗口" }).waitFor();
    await waitText(p.locator(".quiz-card h2"), "全员观看验收题");
    assert.equal(await p.locator(".quiz-public-progress").count(), 0);
    assert.equal(await p.getByText("揭晓后才公开的解析", { exact: true }).count(), 0);
  }
  for (const p of [east, north]) {
    assert.equal(await p.getByRole("button", { name: "提交答案", exact: true }).count(), 0);
    assert.equal(await p.locator(".answer-options button:enabled").count(), 0);
  }
  const option = (p, key) => p.locator(".answer-options button").filter({ has: p.locator("b", { hasText: new RegExp("^" + key + "$") }) });
  await option(first, "A").click();
  await first.getByRole("button", { name: "提交答案", exact: true }).click();
  for (const p of players) {
    assert.equal(await p.getByText(/人已提交/).count(), 0);
    await p.getByLabel("A选项100%", { exact: true }).waitFor();
  }
  await waitText(screen.locator(".screen-options > div").first(), "100%");
  await option(first, "B").click();
  await first.getByRole("button", { name: "更新我的答案", exact: true }).click();
  for (const p of players) {
    await p.getByLabel("A选项0%", { exact: true }).waitFor();
    await p.getByLabel("B选项100%", { exact: true }).waitFor();
    assert.equal(await p.getByText(/人已提交/).count(), 0);
  }
  await option(second, "A").click();
  await second.getByRole("button", { name: "提交答案", exact: true }).click();
  for (const p of players) await p.getByLabel("A选项50%", { exact: true }).waitFor();
  const outsiderToken = await east.evaluate((room) => localStorage.getItem(`monopoly:${room}:player`), EVENT_ROOM_CODE);
  const rejected = await east.request.post(base + `/api/rooms/${EVENT_ROOM_CODE}/commands`, {
    headers: { "x-game-role": "player", Authorization: `Bearer ${outsiderToken}` },
    data: { type: "answer", payload: { option: "D" } },
  });
  assert.equal(rejected.status(), 400);
  const publicView = await east.request.get(base + `/api/rooms/${EVENT_ROOM_CODE}/state`);
  const view = await publicView.json();
  assert.deepEqual(view.quiz.counts, { A: 1, B: 1, C: 0, D: 0 });
  assert.equal(view.quiz.answers, undefined);
  assert.equal(view.quiz.question.answer, undefined);
  await east.screenshot({ path: path.join(output, "all-teams-live-question-landscape.png") });
  await north.setViewportSize({ width: 390, height: 844 });
  await north.screenshot({ path: path.join(output, "all-teams-live-question-portrait.png") });
  await screen.screenshot({ path: path.join(output, "screen-live-option-totals.png") });
  await command("closeQuiz");
  for (const p of players) {
    await p.locator(".quiz-revote").waitFor();
    assert.equal(await p.locator(".answer-options button").count(), 2);
    await p.getByLabel("A选项0%", { exact: true }).waitFor();
    assert.equal(await p.getByText("揭晓后才公开的解析", { exact: true }).count(), 0);
  }
  await option(first, "A").click();
  await first.getByRole("button", { name: "提交答案", exact: true }).click();
  await option(second, "B").click();
  await second.getByRole("button", { name: "提交答案", exact: true }).click();
  for (const p of players) await p.getByLabel("A选项50%", { exact: true }).waitFor();
  await command("closeQuiz");
  await first.getByRole("button", { name: "更新我的答案", exact: true }).waitFor({ state: "detached" });
  await command("reveal");
  for (const p of players) await waitText(p.locator(".quiz-result"), "正确答案 A");
  for (const p of players) await waitText(p.locator(".quiz-result"), "加投仍平票，按答对奖励");
  await command("pause");
  const beforeRestart = await store.read(EVENT_ROOM_CODE);
  const restart = host.getByRole("button", { name: "重新开始游戏", exact: true });
  assert.equal(await restart.count(), 1);
  const gap = await host.evaluate(() => {
    const panel = document.querySelector(".host-restart-zone");
    return panel.getBoundingClientRect().top - panel.previousElementSibling.getBoundingClientRect().bottom;
  });
  assert(gap >= 90, "restart panel must be separated from ordinary controls");
  const resetDialogs = async (steps) => {
    let index = 0;
    const dialogErrors = [];
    const handle = async (dialog) => {
      const step = steps[index++];
      if (!step || dialog.type() !== step[0]) {
        dialogErrors.push(dialog.type());
        await dialog.dismiss();
      } else if (step[1] === null) await dialog.dismiss();
      else await dialog.accept(step[1]);
    };
    host.on("dialog", handle);
    try { await restart.click(); }
    finally { host.off("dialog", handle); }
    assert.equal(index, steps.length);
    assert.deepEqual(dialogErrors, []);
  };
  await resetDialogs([["prompt", null]]);
  assert.deepEqual(await store.read(EVENT_ROOM_CODE), beforeRestart);
  await resetDialogs([["prompt", "000000"], ["alert", ""]]);
  assert.deepEqual(await store.read(EVENT_ROOM_CODE), beforeRestart);
  await resetDialogs([["prompt", EVENT_ROOM_CODE], ["confirm", null]]);
  assert.deepEqual(await store.read(EVENT_ROOM_CODE), beforeRestart);
  await restart.scrollIntoViewIfNeeded();
  await host.screenshot({ path: path.join(output, "host-restart-separated.png") });
  await resetDialogs([["prompt", EVENT_ROOM_CODE], ["confirm", ""]]);
  await waitText(east.locator(".experience-turn"), "等待主持人开场");
  const restarted = await store.read(EVENT_ROOM_CODE);
  assert.equal(restarted.status, "waiting");
  assert.equal(restarted.quiz, null);
  assert(Object.values(restarted.teams).every((team) => team.position === 0 && team.finishOrder === null));
  for (const key of ["players", "questions", "audio", "settings", "representativeRoster"])
    assert.deepEqual(restarted[key], beforeRestart[key]);
  assert.equal(await east.getByText(/记忆大考验全员可见|答题时所有人都能观看/).count(), 0);
  await host.setViewportSize({ width: 390, height: 844 });
  await restart.scrollIntoViewIfNeeded();
  assert(await restart.isVisible());
  assert(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await host.screenshot({ path: path.join(output, "host-restart-mobile.png") });
  await host.setViewportSize({ width: 1440, height: 1000 });
  for (const [team, position] of [["shanghai", 19], ["east", 16], ["central", 13], ["north", 11], ["west", 9]])
    await command("manualMove", { team, position, reason: "颁奖验收" });
  await command("setOrder", { order: ["shanghai", "east", "central", "north", "west"] });
  await command("start");
  await command("physicalDice", { value: 1 });
  await screen.locator(".screen-focus p").filter({ hasText: "棋子移动中" }).waitFor({ state: "attached" });
  const voicesBeforeVictory = await screen.evaluate(() => window.__oscillators);
  for (const p of [screen, ...players]) await p.getByLabel("冠军庆祝", { exact: true }).waitFor();
  await screen.waitForTimeout(350);
  const voices = await screen.evaluate(() => window.__oscillators);
  assert(voices >= voicesBeforeVictory + 17, "the winner must play its dedicated victory fanfare");
  await command("audioSettings", { bgmVolume: 0.2 });
  await screen.waitForTimeout(200);
  assert.equal(await screen.evaluate(() => window.__oscillators), voices);
  const lateScreen = await page({ width: 1920, height: 1080 });
  await lateScreen.goto(base + `/screen?room=${EVENT_ROOM_CODE}`);
  await lateScreen.getByLabel("冠军庆祝", { exact: true }).waitFor();
  await lateScreen.getByRole("button", { name: "开启大屏声音", exact: true }).click();
  assert.equal(await lateScreen.evaluate(() => window.__oscillators), 0);
  assert.equal((await store.read(EVENT_ROOM_CODE)).status, "champion");
  assert.equal(await first.locator("dialog[open]").count(), 0);
  await screen.screenshot({ path: path.join(output, "champion-screen.png") });
  await north.screenshot({ path: path.join(output, "champion-player-portrait.png") });
  host.once("dialog", (dialog) => void dialog.accept());
  await host.getByRole("button", { name: "结束游戏，揭晓荣耀榜", exact: true }).click();
  for (const p of [screen, ...players]) {
    await p.getByLabel("20周年荣耀颁奖台", { exact: true }).waitFor();
    assert.equal(await p.locator(".podium-entry").count(), 5);
    assert((await p.locator(".ceremony-prizes").innerText()).includes("× 3名"));
  }
  assert.equal((await store.read(EVENT_ROOM_CODE)).status, "finished");
  await screen.waitForTimeout(1300);
  for (const p of [screen, east, north]) {
    assert(await p.evaluate(() => {
      const stage = document.querySelector(".podium-stage").getBoundingClientRect();
      return [...document.querySelectorAll(".podium-gift")].every((node) => node.getBoundingClientRect().bottom <= stage.bottom + 1);
    }), "all five podiums must fit above the prize panel");
  }
  await screen.screenshot({ path: path.join(output, "awards-screen.png") });
  await east.screenshot({ path: path.join(output, "awards-player-landscape.png") });
  await north.screenshot({ path: path.join(output, "awards-player-portrait.png") });
  assert.deepEqual(errors, []);
  console.log("PASS all-team live question and option counts, private answers, same-team-only votes, replacement votes, cutoff, reveal, landscape and portrait");
  console.log("PASS separated restart controls, cancel and wrong-room protection, confirmed reset preserving employees, questions and audio, mobile access and clean player copy");
  console.log("PASS one revote, accepted second tie, first-winner freeze, one-time victory sound, silent late join, host-controlled five-team awards and three second prizes");
  console.log(`Screenshots: ${output}`);
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await app.close();
  await fs.rm(directory, { recursive: true, force: true });
}
