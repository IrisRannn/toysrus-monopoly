/* global __ENV */
// Run with k6, not node. The test never opens a host session or resets a game.
import http from "k6/http";
import { fail, sleep } from "k6";
import exec from "k6/execution";
import { WebSocket } from "k6/websockets";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "").replace(/\/+$/, "");
const ROOM = __ENV.ROOM_CODE || "261219";
const PLAYERS = Number(__ENV.PLAYERS || 100);
const RAMP = Number(__ENV.RAMP_SECONDS || 30);
const HOLD = Number(__ENV.HOLD_SECONDS || 1800);
const SPREAD = Number(__ENV.ANSWER_SPREAD_MS || 1000);
const MODE = __ENV.MODE || "game";
const TEAM_MODE = __ENV.TEAM_MODE || "balanced";
const AUTO_ROLL = (__ENV.AUTO_ROLL || "true") === "true";
const FULL_GAME = __ENV.FULL_GAME === "true";
const FIRST_QUIZ_TIE = __ENV.FIRST_QUIZ_TIE === "true";
const ACK_TIMEOUT = 8000;
if (!/^https?:\/\/[^/?#]+$/.test(BASE)) throw new Error("请用 -e BASE_URL=https://测试站点 指定站点根地址（不含/player等路径）");
if (!/^\d{6}$/.test(ROOM)) throw new Error("ROOM_CODE应为6位房间号");
if (!Number.isInteger(PLAYERS) || PLAYERS < 1 || PLAYERS > 1500) throw new Error("PLAYERS应为1–1500的整数");
if (!Number.isFinite(RAMP) || RAMP < 0 || !Number.isFinite(HOLD) || HOLD < 5 || !Number.isFinite(SPREAD) || SPREAD < 0) throw new Error("无效的时长设置");
if (!["game", "idle"].includes(MODE) || !["balanced", "single"].includes(TEAM_MODE)) throw new Error("MODE为game/idle，TEAM_MODE为balanced/single");
if (__ENV.AUTO_ROLL && !["true", "false"].includes(__ENV.AUTO_ROLL)) throw new Error("AUTO_ROLL为true/false");

const joined = new Rate("player_join_ok");
const loggedIn = new Rate("socket_login_ok");
const sessionOK = new Rate("session_ok");
const answersOK = new Rate("answer_ok");
const loginTime = new Trend("socket_login_ms", true);
const answerTime = new Trend("answer_ack_ms", true);
const visibleTime = new Trend("answer_visible_ms", true);
const onlinePlayers = new Trend("online_players");
const drops = new Counter("unexpected_disconnects");
const snapshots = new Counter("snapshots_received");
const heartbeats = new Counter("heartbeat_replies");
const sentAnswers = new Counter("answers_sent");
const acceptedAnswers = new Counter("answers_accepted");
const plannedEnds = new Counter("planned_disconnects");
const questionsSeen = new Counter("questions_seen");
const eligibleQuestions = new Counter("eligible_questions_seen");
const rollsSent = new Counter("rolls_sent");
const rollsAccepted = new Counter("rolls_accepted");
const rollsOK = new Rate("roll_ok");
const rollTime = new Trend("roll_ack_ms", true);
const deliveryTime = new Trend("snapshot_delivery_estimate_ms", true);
const startsSeen = new Counter("game_starts_seen");
const endingsSeen = new Counter("game_endings_seen");
const revotesSeen = new Counter("revotes_seen");
const awardsOK = new Rate("award_snapshot_ok");
const teams = ["east", "central", "north", "west", "shanghai"];
const teamNames = { east: "东区", central: "中南区", north: "北区", west: "西区", shanghai: "上海SSC" };
const beijingTime = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ") + "（北京时间）";
const errorDetail = (e) => String(e?.message || e?.error?.message || e?.error || e?.reason || "无错误详情").slice(0, 240);

export const options = {
  scenarios: {
    players: {
      executor: "per-vu-iterations", vus: PLAYERS, iterations: 1,
      maxDuration: `${Math.ceil(RAMP + HOLD + 45)}s`, gracefulStop: "10s",
    },
  },
  summaryTrendStats: ["min", "med", "p(95)", "max"],
  thresholds: {
    player_join_ok: [FULL_GAME ? "rate==1" : "rate>0.99"],
    socket_login_ok: [FULL_GAME ? "rate==1" : "rate>0.99"],
    session_ok: [FULL_GAME ? "rate==1" : "rate>0.99"],
    unexpected_disconnects: ["count==0"],
    online_players: [`max>=${PLAYERS}`],
    "http_req_duration{name:join_player}": ["p(95)<2000"],
    socket_login_ms: ["p(95)<3000"],
    ...(MODE === "game" ? {
      answers_accepted: ["count>0"],
      answer_ok: [FULL_GAME ? "rate==1" : "rate>0.99"],
      answer_ack_ms: ["p(95)<1000"],
      answer_visible_ms: ["p(95)<1500"],
      ...(AUTO_ROLL ? { roll_ok: [FULL_GAME ? "rate==1" : "rate>0.99"] } : {}),
      ...(FULL_GAME ? {
        game_starts_seen: [`count==${PLAYERS}`],
        game_endings_seen: [`count==${PLAYERS}`],
        award_snapshot_ok: ["rate==1"],
        roll_ack_ms: ["p(95)<1000"],
        ...(FIRST_QUIZ_TIE ? { revotes_seen: ["count>0"] } : {}),
      } : {}),
    } : {}),
  },
};

export function setup() {
  const health = http.get(`${BASE}/api/health`, { timeout: "15s", tags: { name: "preflight" } });
  if (health.status !== 200 || health.json("ok") !== true) fail("服务尚未就绪，请先打开站点等待启动，再运行测试。");
  const stateStarted = Date.now();
  const state = http.get(`${BASE}/api/rooms/${ROOM}/state`, { timeout: "15s", tags: { name: "preflight" } });
  const stateFinished = Date.now();
  if (state.status !== 200) fail(`请先打开 /host?room=${ROOM}，点击“进入主持人控制台”创建测试房间，再运行脚本。`);
  if (MODE === "game" && ["finished", "champion"].includes(state.json("status"))) fail("测试房间已结束，请先由主持人重开测试房间。");
  drops.add(0);
  sentAnswers.add(0);
  acceptedAnswers.add(0);
  plannedEnds.add(0);
  questionsSeen.add(0);
  eligibleQuestions.add(0);
  rollsSent.add(0);
  rollsAccepted.add(0);
  startsSeen.add(0);
  endingsSeen.add(0);
  revotesSeen.add(0);
  const startAt = Date.now();
  const closeAt = startAt + (RAMP + HOLD) * 1000;
  console.log(`广播到达时间按预检校准，时钟估算不确定度约±${Math.round((stateFinished - stateStarted) / 2)}毫秒；操作确认与答案可见耗时不受此时钟估算影响。`);
  console.log(`${PLAYERS}名模拟玩家，${RAMP}秒逐步加入，再保持${HOLD}秒。模式=${MODE}，房间=${ROOM}，分队=${TEAM_MODE}`);
  console.log(`开始：${beijingTime(startAt)}；所有机器人定时退出：${beijingTime(closeAt)}。退出前至少留10秒完成作答。`);
  console.log(`主持人地址：${BASE}/host?room=${ROOM}；大屏地址：${BASE}/screen?room=${ROOM}`);
  console.log(`当前房间：${state.json("status")} / ${state.json("phase")}，当前队伍：${teamNames[state.json("currentTeam")] || "未知"}`);
  if (MODE === "game") console.log(`保持原有队伍顺序。自动投骰=${AUTO_ROLL}：主持人指定在线的k6机器人为代表后，该机器人在本队回合自动投骰；上海SSC仍由主持人录入实体骰子点数。`);
  console.log("game模式需由主持人开启题目。若有人加入失败或人数一直达不到目标，本轮连接测试已失败，不要一直等人数凑齐；先用5人验证流程。不开题不会算游戏测试通过。");
  return { startAt, closeAt, run: __ENV.RUN_ID || startAt.toString(36),
    clockOffset: state.json("serverTime") - (stateStarted + stateFinished) / 2,
    clockUncertaintyMs: (stateFinished - stateStarted) / 2 };
}

export default function (plan) {
  const vu = exec.vu.idInTest;
  const enterAt = plan.startAt + (PLAYERS === 1 ? 0 : (vu - 1) / (PLAYERS - 1) * RAMP * 1000);
  sleep(Math.max(0, enterAt - Date.now()) / 1000);
  const team = TEAM_MODE === "single" ? "shanghai" : teams[(vu - 1) % teams.length];
  const nickname = `k6_${plan.run}_${vu}`;
  const res = http.post(`${BASE}/api/rooms/${ROOM}/players`, JSON.stringify({ team, nickname }), {
    headers: { "Content-Type": "application/json" }, timeout: "15s", tags: { name: "join_player" },
  });
  let identity;
  try { identity = res.json(); } catch { /* Failed join recorded below. */ }
  const joinOK = res.status === 201 && !!identity?.token;
  joined.add(joinOK);
  if (!joinOK) {
    console.error(`玩家${vu}加入失败，房间${ROOM}，HTTP ${res.status}，错误码=${res.error_code || "无"}，详情=${res.error || identity?.error || "无"}`);
    sessionOK.add(false);
    return;
  }

  let socket, authed = false, loginRecorded = false, sawState = false, bad = false, finished = false, lastState;
  if (vu <= 5) console.log(`${teamNames[team]}测试玩家：${nickname}；请在主持人端选择本轮在线的机器人代表。`);
  let ackId = 0, answerCount = 0, sawStart = false, sawEnd = false, firstQuestionId;
  const pending = new Map(), observed = new Map(), scheduled = new Set(), timers = new Set(), seenBallots = new Set(), rolledTurns = new Set();
  let lastPhase;
  const started = Date.now();
  const later = (fn, delay) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, Math.max(0, delay));
    timers.add(id);
    return id;
  };
  const cancel = (id) => { clearTimeout(id); timers.delete(id); };
  function finish(planned, reason, detail = "") {
    if (finished) return;
    finished = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const action of pending.values()) {
      (action.kind === "roll" ? rollsOK : answersOK).add(false);
      bad = true;
      if (action.kind !== "roll") observed.delete(action.ballot);
    }
    for (const answer of observed.values()) if (!answer.visible) bad = true;
    if (!loginRecorded) loggedIn.add(false);
    sessionOK.add(planned && authed && sawState && !bad && (!FULL_GAME || (sawStart && sawEnd)));
    if (!planned) {
      drops.add(1, { reason });
      console.error(`玩家${vu}非计划断线：${reason}；房间${ROOM}，已认证=${authed}，最后阶段=${lastState?.phase || "未收到状态"}，距定时退出还有${Math.round((plan.closeAt - Date.now()) / 1000)}秒${detail ? "；" + detail : ""}`);
    } else {
      plannedEnds.add(1);
      if (vu <= 5) console.log(`玩家${vu}到时正常退出；看过${seenBallots.size}轮题目，发送${answerCount}次答案。`);
      if (MODE === "game" && vu <= 5 && seenBallots.size === 0) console.warn(`房间${ROOM}：玩家${vu}在线期间未看到开放答题，请核对开题时间和房间号。`);
    }
    try { socket?.close(); } catch { /* Socket may already be closed. */ }
  }
  const turnKey = (state) => `${state.round}:${state.turnId}:${state.currentTeam}`;
  const canRoll = (state) => state?.status === "running" && state.phase === "awaiting_dice" &&
    state.currentTeam !== "shanghai" && state.me?.team === state.currentTeam &&
    state.teams?.[state.currentTeam]?.representativeId === state.me?.id;
  function maybeRoll(state) {
    if (state.status === "waiting") rolledTurns.clear();
    const key = turnKey(state);
    if (MODE !== "game" || !AUTO_ROLL || !authed || !canRoll(state) || rolledTurns.has(key) || Date.now() >= plan.closeAt - ACK_TIMEOUT - 1000) return;
    rolledTurns.add(key);
    later(() => {
      if (finished || !canRoll(lastState) || turnKey(lastState) !== key) { rolledTurns.delete(key); return; }
      const id = ++ackId;
      const timeout = later(() => {
        pending.delete(id); rollsOK.add(false); bad = true;
        console.error(`${teamNames[team]}机器人代表投骰确认超时，房间${ROOM}`);
      }, ACK_TIMEOUT);
      pending.set(id, { kind: "roll", timeout, sentAt: Date.now() });
      rollsSent.add(1);
      console.log(`${teamNames[team]}机器人代表${nickname}正在投骰。`);
      socket.send(`42${id}${JSON.stringify(["command", { type: "roll", payload: {} }])}`);
    }, 1000);
  }
  function onState(state) {
    lastState = state;
    sawState = true;
    snapshots.add(1);
    onlinePlayers.add(state.onlineCount);
    if (Number.isFinite(plan.clockOffset) && Number.isFinite(state.serverTime))
      deliveryTime.add(Math.max(0, Date.now() + plan.clockOffset - state.serverTime));
    if (!sawStart && state.status === "running") { sawStart = true; startsSeen.add(1); }
    if (!sawEnd && state.status === "finished" && (!FULL_GAME || state.prizes?.needsConfirmation === false)) {
      sawEnd = true;
      endingsSeen.add(1);
      awardsOK.add(state.rankings?.length === 5 && state.rankings.every((t) => t.rank >= 1 && t.rank <= 5) && state.prizes?.prizes?.length === 3);
      if (FULL_GAME) later(() => finish(true, "已收到最终结算"), 2500);
    }
    if (vu <= 5 && state.phase !== lastPhase) {
      console.log(`玩家${vu}（${teamNames[team]}）：房间${ROOM}，阶段=${state.phase}，当前${teamNames[state.currentTeam] || state.currentTeam}，在线${state.onlineCount}，距定时退出${Math.round((plan.closeAt - Date.now()) / 1000)}秒`);
      lastPhase = state.phase;
    }
    maybeRoll(state);
    const q = state.quiz;
    if (!q) return;
    const ballot = q.ballotId || q.id;
    if (state.status === "running" && state.phase === "answering" && !seenBallots.has(ballot)) {
      seenBallots.add(ballot);
      questionsSeen.add(1);
      firstQuestionId ||= q.id;
      if (q.revote) revotesSeen.add(1);
      if (state.currentTeam === state.me?.team) eligibleQuestions.add(1);
    }
    const prior = observed.get(ballot);
    if (prior && !prior.visible && q.myAnswer === prior.option) {
      prior.visible = true;
      visibleTime.add(Date.now() - prior.sentAt);
    }
    if (MODE !== "game" || !authed || scheduled.has(ballot) || state.status !== "running" || state.phase !== "answering" || state.currentTeam !== state.me?.team) return;
    if (Date.now() >= plan.closeAt - ACK_TIMEOUT - SPREAD) return;
    scheduled.add(ballot);
    later(() => {
      const current = lastState?.quiz;
      if (finished || !current || (current.ballotId || current.id) !== ballot || lastState.status !== "running" || lastState.phase !== "answering") return;
      const choices = current.allowedOptions || ["A", "B", "C", "D"];
      const tieChoices = choices.filter((choice) => ["A", "B"].includes(choice));
      const option = FIRST_QUIZ_TIE && current.id === firstQuestionId && tieChoices.length === 2
        ? tieChoices[Math.floor((vu - 1) / teams.length) % 2]
        : choices[Math.floor(Math.random() * choices.length)];
      const id = ++ackId, sentAt = Date.now();
      const timeout = later(() => {
        pending.delete(id); answersOK.add(false); bad = true;
        console.error(`玩家${vu}答案确认超时（${ACK_TIMEOUT / 1000}秒），房间${ROOM}`);
      }, ACK_TIMEOUT);
      const entry = { kind: "answer", sentAt, ballot, option, timeout, visible: false };
      pending.set(id, entry);
      observed.set(ballot, entry);
      sentAnswers.add(1);
      answerCount++;
      socket.send(`42${id}${JSON.stringify(["command", { type: "answer", payload: { option } }])}`);
    }, Math.random() * SPREAD);
  }
  try {
    socket = new WebSocket(BASE.replace(/^http/, "ws") + "/socket.io/?EIO=4&transport=websocket", [], { tags: { name: "game_socket" } });
  } catch (error) { finish(false, "创建连接失败", errorDetail(error)); return; }
  const connectTimer = later(() => finish(false, "连接认证超过10秒"), 10000);
  later(() => finish(true, "到时退出"), plan.closeAt - Date.now());
  socket.onmessage = ({ data }) => {
    const packet = String(data);
    try {
      if (packet.startsWith("0")) {
        socket.send("40" + JSON.stringify({ room: ROOM, role: "player", token: identity.token }));
      } else if (packet.startsWith("2")) {
        socket.send("3" + packet.slice(1));
        heartbeats.add(1);
      } else if (packet.startsWith("40")) {
        authed = true;
        loginRecorded = true;
        loggedIn.add(true);
        loginTime.add(Date.now() - started);
        cancel(connectTimer);
      } else if (packet.startsWith("44")) {
        let message;
        try { message = JSON.parse(packet.slice(2)).message; } catch { /* Report only a safe error message. */ }
        finish(false, "服务器拒绝认证", message || "无错误详情");
      } else if (packet === "41" || packet === "1") {
        finish(false, "服务器关闭连接");
      } else if (packet.startsWith("42")) {
        const [event, payload] = JSON.parse(packet.slice(2));
        if (event === "state:update") onState(payload);
        if (event === "session:revoked") finish(false, "玩家身份失效");
      } else if (packet.startsWith("43")) {
        const match = /^43(\d+)(\[.*\])$/s.exec(packet);
        const answer = match && pending.get(Number(match[1]));
        if (!answer) return;
        pending.delete(Number(match[1]));
        cancel(answer.timeout);
        const [ack] = JSON.parse(match[2]);
        if (answer.kind === "roll") {
          rollsOK.add(ack.ok === true);
          if (ack.ok) { rollsAccepted.add(1); rollTime.add(Date.now() - answer.sentAt); }
          else { bad = true; console.error(`${teamNames[team]}机器人投骰失败：${ack.error}`); }
          return;
        }
        answersOK.add(ack.ok === true);
        if (ack.ok) {
          acceptedAnswers.add(1); answerTime.add(Date.now() - answer.sentAt);
          if (vu <= 5) console.log(`玩家${vu}（${teamNames[team]}）答案已被服务器接受。`);
        }
        else { bad = true; console.error(`玩家${vu}答案未被接受：${ack.error}`); }
      }
    } catch (error) { bad = true; finish(false, "处理消息失败", errorDetail(error)); }
  };
  socket.onerror = (error) => finish(false, "连接错误", errorDetail(error));
  socket.onclose = (event) => finish(false, "连接中途关闭", `关闭码=${event?.code ?? "未知"}，${errorDetail(event)}`);
}

export function teardown(plan) {
  console.log(`房间${ROOM}本轮已结束；原定退出时间：${beijingTime(plan.closeAt)}。questions_seen=0表示未看到开放题目；eligible_questions_seen=0表示没有机器人看到本区可作答的题目。`);
  console.log("请保留开头的时间、加入失败和非计划断线的报错文字；仅有最终汇总无法区分网络、认证或服务器故障。");
}
