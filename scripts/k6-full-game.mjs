// Starts a real game and runs k6 players against it. No deploys or plan changes.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { io } from "socket.io-client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.BASE_URL || "").replace(/\/+$/, "");
const room = process.env.ROOM_CODE || "261219";
const players = Number(process.env.PLAYERS || 200);
const ramp = Number(process.env.RAMP_SECONDS || 30);
const maxSeconds = Number(process.env.MAX_SECONDS || 1200);
const answerSeconds = Number(process.env.ANSWER_SECONDS || 30);
const forceTie = process.env.FIRST_QUIZ_TIE !== "false";
const cleanup = process.env.CLEANUP !== "false";
const k6Bin = process.env.K6_BIN || "k6";
const teams = ["east", "central", "north", "west", "shanghai"];
if (!/^https?:\/\/[^/?#]+$/.test(base)) throw new Error("BASE_URL must be the site root");
if (!["261218", "261219"].includes(room)) throw new Error("Use a supported game room");
if (room === "261218" && process.env.ALLOW_FORMAL_ROOM !== "true") throw new Error("Formal room requires ALLOW_FORMAL_ROOM=true and an empty room");
if (!Number.isInteger(players) || players < 10 || players > 1500 || players % 10) throw new Error("PLAYERS must be a multiple of 10, between 10 and 1500");
if (!Number.isFinite(ramp) || ramp < 1 || !Number.isFinite(maxSeconds) || maxSeconds < 60 || !Number.isInteger(answerSeconds) || answerSeconds < 5 || answerSeconds > 300) throw new Error("Invalid test duration");

const startedAt = new Date();
const runId = startedAt.getTime().toString(36);
const prefix = `k6_${runId}_`;
const output = path.resolve(process.env.OUTPUT_DIR || path.join(root, "artifacts", "load-tests", `${startedAt.toISOString().replace(/[:.]/g, "-")}-${players}`));
await fs.mkdir(output, { recursive: true });
const timeline = [], hostCommands = [], generator = [];
const report = { startedAt: startedAt.toISOString(), base, room, players, rampSeconds: ramp, answerSeconds, maxSeconds,
  firstQuizTie: forceTie, runId, output, completion: false, failures: [], coverage: { turns: [], quizzes: [], revotes: [], winner: null, rankings: [] } };
let host, hostToken, latest, runner, runnerResult, runnerDone, observer, context, browserPage;
let browserErrors = [], browserFailures = [], browserMetrics;
let testEndedAt, abort = false, createdRoom = false, gameStarted = false, hostDisconnects = 0;
let observerBackground = false;
const log = async (type, data = {}) => {
  const item = { at: new Date().toISOString(), type, ...data };
  timeline.push(item);
  await fs.appendFile(path.join(output, "timeline.jsonl"), JSON.stringify(item) + "\n");
  console.log(JSON.stringify(item));
};
const api = async (route, body, token) => {
  const response = await fetch(base + route, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(20000),
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { "x-game-role": "host", Authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error || route}`);
  return data;
};
const hostCommand = async (type, payload = {}, transport = "socket") => {
  const t = performance.now();
  let result;
  try {
    result = transport === "http" ? await api(`/api/rooms/${room}/commands`, { type, payload }, hostToken)
      : await host.timeout(8000).emitWithAck("command", { type, payload });
    if (!result.ok) throw new Error(result.error || `${type} rejected`);
  } finally {
    hostCommands.push({ at: new Date().toISOString(), type, transport, ms: performance.now() - t, ok: result?.ok === true });
  }
};
const connectHost = async () => {
  host = io(base, { auth: { room, role: "host", token: hostToken }, transports: ["websocket"], reconnection: false });
  host.on("state:update", (s) => { latest = s; });
  host.on("disconnect", (reason) => { if (!testEndedAt) { hostDisconnects++; report.hostDisconnectReason = reason; } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Host connection timed out")), 15000);
    host.once("connect", () => { clearTimeout(timer); resolve(); });
    host.once("connect_error", (e) => { clearTimeout(timer); reject(e); });
  });
};
const startBrowser = async () => {
  if (!process.env.PLAYWRIGHT_MODULE) return;
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  observer = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, headless: true,
    args: ["--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  context = await observer.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.__loadCheck = { frameGaps: [], longTasks: [], hidden: document.hidden };
    let previous;
    const frame = (t) => {
      if (previous && window.__loadCheck.frameGaps.length < 150000) window.__loadCheck.frameGaps.push(t - previous);
      previous = t; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try { new PerformanceObserver((list) => window.__loadCheck.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: "longtask", buffered: true }); } catch { /* Browser may not expose long tasks. */ }
  });
  browserPage = await context.newPage();
  browserPage.on("pageerror", (e) => browserErrors.push(e.message));
  browserPage.on("requestfailed", (r) => browserFailures.push({ url: new URL(r.url()).pathname, error: r.failure()?.errorText }));
  await browserPage.goto(`${base}/screen?room=${room}`, { waitUntil: "load", timeout: 45000 });
  await browserPage.locator(".screen-app").waitFor({ timeout: 15000 });
  await log("browser_ready");
};
const runK6 = () => {
  const args = ["run", "--quiet", `--summary-export=${path.join(output, "k6-summary.json")}`, "-e", `BASE_URL=${base}`, "-e", `ROOM_CODE=${room}`,
    "-e", `PLAYERS=${players}`, "-e", `RAMP_SECONDS=${ramp}`, "-e", `HOLD_SECONDS=${maxSeconds}`, "-e", `RUN_ID=${runId}`,
    "-e", "FULL_GAME=true", "-e", "TEAM_MODE=balanced", "-e", `FIRST_QUIZ_TIE=${forceTie}`, "scripts/k6-players.js"];
  runner = spawn(k6Bin, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const writes = [];
  for (const stream of [runner.stdout, runner.stderr]) stream.on("data", (bytes) => writes.push(fs.appendFile(path.join(output, "k6.log"), bytes)));
  runnerDone = new Promise((resolve) => {
    runner.once("error", (e) => { runnerResult = { code: null, error: e.message }; resolve(runnerResult); });
    runner.once("close", async (code, signal) => { await Promise.allSettled(writes); runnerResult = { code, signal }; resolve(runnerResult); });
  });
};
const sampleGenerator = () => {
  if (!runner?.pid || runnerResult) return;
  try {
    const [cpu, rss] = execFileSync("/bin/ps", ["-p", String(runner.pid), "-o", "%cpu=,rss="], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
    generator.push({ at: new Date().toISOString(), cpuPercent: cpu, memoryMiB: rss / 1024 });
  } catch { /* Process may have exited between sampling and ps. */ }
};
const stats = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? { count: sorted.length, min: sorted[0], median: sorted[Math.floor((sorted.length - 1) * 0.5)], p95: sorted[Math.floor((sorted.length - 1) * 0.95)], max: sorted.at(-1) } : null;
};
process.once("SIGINT", () => { abort = true; });
process.once("SIGTERM", () => { abort = true; });
try {
  const preflight = await fetch(`${base}/api/rooms/${room}/state`, { signal: AbortSignal.timeout(20000) });
  if (preflight.status !== 404) {
    if (!preflight.ok) throw new Error(`Room preflight HTTP ${preflight.status}`);
    const state = await preflight.json();
    const members = Object.values(state.teams || {}).reduce((sum, team) => sum + team.members, 0);
    if (state.status !== "waiting" || members || state.onlineCount) throw new Error("Room is not empty and waiting. No existing game was reset.");
  }
  const session = await api(`/api/rooms/${room}/host-session`, {});
  hostToken = session.token; createdRoom = true;
  await connectHost();
  await hostCommand("settings", { hostOnlyRepresentatives: true, autoAdvance: true, answerSeconds });
  await startBrowser();
  await log("start", { room, players, rampSeconds: ramp, firstQuizTie: forceTie });
  runK6();
  const loadingDeadline = Date.now() + (ramp + 90) * 1000;
  const deadline = Date.now() + maxSeconds * 1000;
  let lastTurn, lastStatus, lastBallot, championAt, finishedAt, lastProgress = 0, lastGenerator = 0, quizImage = false, prizesConfirmed = false;
  const openedTurns = new Set(), revealed = new Set(), assigned = new Set();
  while (Date.now() < deadline) {
    if (abort) throw new Error("Stopped by user");
    if (runnerResult && !finishedAt && latest?.status !== "finished") throw new Error(`k6 exited before the game finished (${runnerResult.code})`);
    if (!host.connected) throw new Error("Host disconnected during test");
    const s = latest;
    if (!s) { await delay(100); continue; }
    const botPlayers = s.players.filter((p) => p.nickname.startsWith(prefix) && !p.removed);
    const online = botPlayers.filter((p) => p.online);
    report.maxOnlineObserved = Math.max(report.maxOnlineObserved || 0, online.length);
    if (Date.now() - lastProgress >= 15000) { await log("progress", { online: online.length, expected: players, status: s.status, phase: s.phase }); lastProgress = Date.now(); }
    if (Date.now() - lastGenerator >= 15000) { sampleGenerator(); lastGenerator = Date.now(); }
    if (!gameStarted) {
      if (online.length < players) {
        if (Date.now() > loadingDeadline) throw new Error(`Only ${online.length}/${players} test players became online`);
        await delay(200); continue;
      }
      if (s.order.join() !== teams.join()) throw new Error("Expected the normal five-team order");
      for (const team of teams.filter((id) => id !== "shanghai")) {
        const candidate = online.find((p) => p.team === team);
        if (!candidate) throw new Error(`No online representative for ${team}`);
        await hostCommand("setTeamRepresentative", { team, playerId: candidate.id });
      }
      report.allPlayersOnlineAt = new Date().toISOString();
      report.minOnlineDuringGame = players;
      await hostCommand("start"); gameStarted = true;
      await log("game_started", { online: online.length });
      await delay(200); continue;
    }
    if (!finishedAt) report.minOnlineDuringGame = Math.min(report.minOnlineDuringGame, online.length);
    if (s.turnId !== lastTurn) { lastTurn = s.turnId; report.coverage.turns.push({ team: s.currentTeam, turn: s.turnId, round: s.round }); await log("turn", report.coverage.turns.at(-1)); }
    if (s.status !== lastStatus) { lastStatus = s.status; await log("status", { status: s.status, phase: s.phase }); }
    if (s.status === "champion") {
      if (!championAt) {
        championAt = Date.now(); report.coverage.winner = s.victory?.team;
        if (browserPage) await browserPage.screenshot({ path: path.join(output, "victory.png") });
      }
      if (Date.now() - championAt >= 3000) await hostCommand("end");
    } else if (s.status === "finished") {
      if (s.prizes?.needsConfirmation) {
        if (!prizesConfirmed) {
          prizesConfirmed = true;
          // Exercise the existing host confirmation; retain every eligible tied team.
          await hostCommand("confirmPrizes", { first: s.rankings.filter((t) => t.rank === 1).map((t) => t.id), second: s.rankings.filter((t) => t.rank <= 3).map((t) => t.id) });
          report.coverage.prizeTieConfirmation = "Include all teams tied within the top three ranks";
          await log("prize_tie_confirmed");
        }
        await delay(200); continue;
      }
      if (!finishedAt) {
        finishedAt = Date.now(); testEndedAt = new Date(); report.completion = true;
        report.gameFinishedAt = testEndedAt.toISOString();
        report.coverage.rankings = s.rankings.map(({ id, name, position, rank, finishOrder }) => ({ id, name, position, rank, finishOrder }));
        report.coverage.prizes = s.prizes?.prizes?.map(({ name, quantity, rangeLabel }) => ({ name, quantity, rangeLabel }));
        if (browserPage) {
          await browserPage.getByRole("region", { name: "20周年荣耀颁奖台" }).waitFor({ timeout: 10000 });
          await browserPage.screenshot({ path: path.join(output, "awards.png") });
          report.coverage.browserPodiumTeams = await browserPage.locator(".podium-entry").count();
        }
        await log("game_finished", { winner: report.coverage.winner, rankings: report.coverage.rankings });
      }
      if (runnerResult) break;
      if (Date.now() - finishedAt > 20000) throw new Error("Players did not close after receiving the final ranking");
    } else if (s.status === "running") {
      if (room === "261219" && s.rankings.some((team) => team.finishOrder === 1)) { report.coverage.winner = s.rankings.find((team) => team.finishOrder === 1).id; await hostCommand("end"); }
      else if (s.phase === "awaiting_dice" && s.currentTeam === "shanghai") {
        const key = `${s.round}:${s.turnId}`;
        if (!assigned.has(key)) {
          assigned.add(key);
          // First SSC roll exercises the real quiz tile; subsequent rolls model physical dice.
          await hostCommand("physicalDice", { value: s.round === 1 ? 4 : 1 + Math.floor(Math.random() * 6) });
        }
      } else if (s.phase === "quiz_ready" && !openedTurns.has(s.turnId)) {
        openedTurns.add(s.turnId);
        await hostCommand("startQuiz", { seconds: answerSeconds });
      } else if (s.phase === "quiz_closed" && !revealed.has(s.quiz.id)) {
        revealed.add(s.quiz.id); await hostCommand("reveal");
      } else if (s.phase === "turn_complete" && !s.autoNextAt) await hostCommand("next");
      if (s.quiz && s.phase === "answering" && s.quiz.ballotId !== lastBallot) {
        lastBallot = s.quiz.ballotId;
        const item = { team: s.currentTeam, turn: s.turnId, id: s.quiz.id, revote: s.quiz.revote, at: new Date().toISOString() };
        if (s.quiz.revote) report.coverage.revotes.push(item); else report.coverage.quizzes.push(item);
        await log(s.quiz.revote ? "revote" : "quiz", { team: s.currentTeam, turn: s.turnId });
      }
      if (browserPage && !quizImage && s.phase === "answering" && s.quiz.submitted >= players / 5) {
        quizImage = true; await browserPage.screenshot({ path: path.join(output, "quiz.png") });
      }
    }
    await delay(200);
  }
  if (!report.completion) throw new Error("Game did not reach its final ranking within the test limit");
  if (runnerDone && !runnerResult) await runnerDone;
  if (runnerResult?.code !== 0) report.failures.push(`k6 thresholds failed (exit ${runnerResult?.code})`);
  if (report.minOnlineDuringGame !== players) report.failures.push("Some test players were offline during gameplay");
  if (!report.coverage.quizzes.length) report.failures.push("No quiz was exercised");
  if (forceTie && !report.coverage.revotes.length) report.failures.push("The requested tied-ballot revote was not exercised");
} catch (error) {
  report.failures.push(error.message);
  await log("failure", { message: error.message });
} finally {
  testEndedAt ||= new Date();
  report.testEndedAt = testEndedAt.toISOString();
  if (runner && !runnerResult) {
    runner.kill("SIGINT");
    await Promise.race([runnerDone, delay(12000)]);
    if (!runnerResult) { runner.kill("SIGTERM"); await Promise.race([runnerDone, delay(5000)]); }
  }
  if (browserPage) {
    try {
      const raw = await browserPage.evaluate(() => window.__loadCheck);
      observerBackground = raw.hidden;
      browserMetrics = { frameGapMs: stats(raw.frameGaps), longTaskMs: stats(raw.longTasks), hiddenAtStart: observerBackground,
        runtimeErrors: browserErrors, failedRequests: browserFailures, observer: "One headless desktop screen on the load generator; not 200 rendered phones" };
      await fs.writeFile(path.join(output, "browser.json"), JSON.stringify(browserMetrics, null, 2));
    } catch (error) { report.failures.push("Browser measurement: " + error.message); }
    await observer.close();
  }
  report.hostAckMs = stats(hostCommands.filter((v) => v.ok).map((v) => v.ms));
  report.hostCommandFailures = hostCommands.filter((v) => !v.ok);
  report.hostDisconnects = hostDisconnects;
  report.k6 = runnerResult;
  report.browser = browserMetrics;
  await fs.writeFile(path.join(output, "host-metrics.json"), JSON.stringify({ commands: hostCommands, generator }, null, 2));
  if (cleanup && createdRoom && hostToken) {
    try {
      let state = await api(`/api/rooms/${room}/state`, undefined, hostToken);
      if (state.phase === "answering" && state.status === "running") {
        await hostCommand("closeQuiz", {}, "http");
        state = await api(`/api/rooms/${room}/state`, undefined, hostToken);
        if (state.phase === "answering") await hostCommand("closeQuiz", {}, "http");
      }
      state = await api(`/api/rooms/${room}/state`, undefined, hostToken);
      if (["running", "paused", "champion"].includes(state.status)) await hostCommand("end", {}, "http");
      const bots = state.players.filter((p) => p.nickname.startsWith(prefix) && !p.removed);
      let removed = 0;
      for (const bot of bots) {
        await hostCommand("removePlayer", { playerId: bot.id }, "http"); removed++;
        if (removed % 25 === 0) await log("cleanup", { removed, total: bots.length });
      }
      state = await api(`/api/rooms/${room}/state`, undefined, hostToken);
      if (state.players.every((p) => p.removed)) await hostCommand("reset", { confirm: room }, "http");
      report.cleanup = { removed, syntheticRecordsRemainMarkedRemoved: true };
    } catch (error) { report.cleanup = { error: error.message }; }
  }
  host?.disconnect();
  report.passed = report.completion && report.failures.length === 0 && report.hostCommandFailures.length === 0 && hostDisconnects === 0;
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await log("done", { passed: report.passed, output, failures: report.failures });
}
process.exitCode = report.passed ? 0 : 1;
