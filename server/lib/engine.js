import { randomUUID, randomInt } from "node:crypto";
import {
  TEAM_ORDER,
  TEAM_INFO,
  QUIZ_TILES,
  clampPosition,
  landing,
  tally,
  rankings,
} from "../../shared/gameRules.js";
import { tilePositions } from "../../shared/tilePositions.js";
import { tileMessages } from "../../shared/tileMessages.js";
import { MOVEMENT_MS_PER_TILE, MIN_MOVEMENT_MS, PRESENTATION_MS } from "../../shared/gameTiming.js";
import { DEFAULT_AUDIO, audioState } from "../../shared/audioSettings.js";
import { BUILTIN_BGM } from "../../shared/builtinBgm.js";
import { PREVIEW_ROOM_CODE } from "../../shared/siteSettings.js";
import { ACTIVITY_DICE_WEIGHTS } from "../../shared/diceRules.js";
import { rollActivityDie } from "./dice.js";
import {
  BUILTIN_QUESTIONS,
  QUESTION_BANK_VERSION,
  questionKey,
  usedQuestionKeys,
  availableQuestions,
} from "./questions.js";
export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requireThat = (condition, message) => {
  if (!condition) throw new GameError(message);
};
const clone = (x) => structuredClone(x);
const TURN_AUTOMATION_VERSION = 1;
const BRAND_ASSETS_VERSION = "20261104-brand-v1";
const gameFields = [
  "status",
  "phase",
  "teams",
  "order",
  "round",
  "turnId",
  "currentTeam",
  "dice",
  "movement",
  "presentation",
  "quiz",
  "transitionAt",
  "usedQuestions",
  "usedQuestionKeys",
  "pausedAt",
  "lastTile",
  "prizeConfirmation",
];
export function event(s, type, text, actor = "system", data = {}) {
  s.events.push({
    id: randomUUID(),
    type,
    text,
    actor,
    at: Date.now(),
    ...data,
  });
}
export function freshGame() {
  return {
    status: "waiting",
    phase: "awaiting_dice",
    teams: Object.fromEntries(
      TEAM_ORDER.map((id) => [
        id,
        {
          id,
          ...TEAM_INFO[id],
          position: 0,
          representativeId: null,
          finishOrder: null,
          finishedAt: null,
        },
      ]),
    ),
    order: [...TEAM_ORDER],
    round: 1,
    turnId: 1,
    currentTeam: "east",
    dice: null,
    movement: null,
    presentation: null,
    quiz: null,
    transitionAt: null,
    usedQuestions: [],
    usedQuestionKeys: [],
    pausedAt: null,
    lastTile: null,
    prizeConfirmation: null,
  };
}
export function newRoom(code, hostHash) {
  return {
    code,
    hostHash,
    version: 0,
    createdAt: Date.now(),
    ...freshGame(),
    players: {},
    questions: clone(BUILTIN_QUESTIONS).map(validateQuestion),
    questionBankVersion: QUESTION_BANK_VERSION,
    events: [],
    positions: clone(tilePositions),
    settings: { answerSeconds: 30, autoAdvance: true, hostOnlyRepresentatives: code === PREVIEW_ROOM_CODE },
    representativeRoster: {},
    turnAutomationVersion: TURN_AUTOMATION_VERSION,
    audio: clone(DEFAULT_AUDIO),
    brandAssetsVersion: BRAND_ASSETS_VERSION,
    stageAudioVersion: 1,
    undo: null,
  };
}
export function seedQuestionBank(s) {
  if (s.questionBankVersion === QUESTION_BANK_VERSION) return false;
  s.usedQuestionKeys = [...usedQuestionKeys(s)];
  const existing = new Set(s.questions.map(questionKey));
  let added = 0;
  for (const q of BUILTIN_QUESTIONS) {
    if (existing.has(questionKey(q))) continue;
    s.questions.push(validateQuestion(clone(q)));
    existing.add(questionKey(q));
    added++;
  }
  s.questionBankVersion = QUESTION_BANK_VERSION;
  event(s, "question", `加载内置周年题库，新增${added}道不重复题目`);
  return true;
}
export function upgradeTurnAutomation(s, now = Date.now()) {
  if (s.turnAutomationVersion === TURN_AUTOMATION_VERSION) return false;
  s.settings.autoAdvance = true;
  s.turnAutomationVersion = TURN_AUTOMATION_VERSION;
  if (s.phase === "turn_complete") scheduleNextTurn(s, now);
  event(s, "settings", "已开启普通线上回合自动切队；答题和上海SSC回合仍由主持人确认");
  return true;
}
export function upgradeBrandAssets(s) {
  if (s.brandAssetsVersion === BRAND_ASSETS_VERSION) return false;
  for (const id of TEAM_ORDER) {
    s.teams[id].color = TEAM_INFO[id].color;
    if (s.undo?.game?.teams?.[id]) s.undo.game.teams[id].color = TEAM_INFO[id].color;
  }
  const audio = audioState(s);
  if (!audio.bgm) audio.bgm = clone(BUILTIN_BGM);
  s.audio = audio;
  s.brandAssetsVersion = BRAND_ASSETS_VERSION;
  event(s, "brand_assets", "更新品牌色板并接入正式内置BGM");
  return true;
}
export function upgradeStageAudio(s) {
  if (s.stageAudioVersion === 1) return false;
  const audio = audioState(s);
  if (audio.effectsVolume > 0) audio.effectsVolume = Math.max(0.9, audio.effectsVolume);
  s.audio = audio;
  s.stageAudioVersion = 1;
  event(s, "audio", "提高现场音效音量，动作期间自动降低背景音乐");
  return true;
}
function checkpoint(s, label) {
  s.undo = {
    label,
    game: Object.fromEntries(gameFields.map((k) => [k, clone(s[k])])),
  };
}
function finish(s, team, now) {
  if (team.position !== 20 || team.finishOrder) return;
  team.finishOrder =
    Object.values(s.teams).filter((t) => t.finishOrder).length + 1;
  team.finishedAt = now;
  event(s, "finish", `${team.name}冲线，获得第${team.finishOrder}名`);
}
function rosterRepresentative(s, team) {
  const id = s.representativeRoster?.[team];
  const employee = s.players[id];
  return employee && !employee.removed && employee.team === team ? id : null;
}
function move(s, to, kind, now) {
  const team = s.teams[s.currentTeam],
    from = team.position;
  team.position = clampPosition(to);
  s.presentation = null;
  s.movement = {
    id: randomUUID(),
    team: team.id,
    from,
    to: team.position,
    kind,
    startedAt: now,
    duration: Math.max(MIN_MOVEMENT_MS, Math.abs(team.position - from) * MOVEMENT_MS_PER_TILE),
  };
  s.phase = "moving";
  s.transitionAt = now + s.movement.duration;
  event(s, "move", `${team.name}：${from} → ${team.position}格`);
  finish(s, team, now);
}
function present(s, tile, kind, now) {
  const correct = kind === "correct";
  const effect = correct
    ? tile.id === 15 ? "直达终点" : `前进${tile.effect}格`
    : tile.type === "quiz"
      ? tile.id === 15 ? "答对直达终点" : `答对前进${tile.effect}格`
      : tile.type === "finish"
        ? "成功冲线！"
        : `${tile.effect > 0 ? "前进" : "后退"}${Math.abs(tile.effect)}格`;
  s.presentation = {
    id: randomUUID(),
    team: s.currentTeam,
    tile: tile.id,
    kind,
    icon: correct ? "🏆" : tile.icon,
    title: correct ? "回答正确！" : tileMessages[tile.id],
    effect,
    startedAt: now,
    endsAt: now + PRESENTATION_MS,
  };
  s.transitionAt = s.presentation.endsAt;
}
function applyTile(s, tile, now) {
  s.presentation = null;
  if (tile.type === "quiz") {
    s.phase = "quiz_ready";
    s.transitionAt = null;
    event(s, "quiz_ready", "等待主持人选题并开始答题");
  } else if (tile.type === "reward" || tile.type === "penalty") {
    move(s, s.teams[s.currentTeam].position + tile.effect, "effect", now);
  } else complete(s, now);
}
function canAutoAdvance(s) {
  return (
    s.settings.autoAdvance &&
    ["running", "paused"].includes(s.status) &&
    s.currentTeam !== "shanghai" &&
    s.dice?.source === "online" &&
    !s.quiz
  );
}
function scheduleNextTurn(s, now) {
  s.transitionAt = canAutoAdvance(s)
    ? (s.status === "paused" ? s.pausedAt : now) + 1800
    : null;
}
function complete(s, now) {
  s.presentation = null;
  s.phase = "turn_complete";
  scheduleNextTurn(s, now);
  if (Object.values(s.teams).every((t) => t.finishOrder)) {
    s.status = "finished";
    s.transitionAt = null;
    event(s, "end", "五队全部冲线，游戏结束");
  }
}
function next(s, _now, actor = "system") {
  requireThat(s.phase === "turn_complete", "请先完成当前格子事件或答题");
  checkpoint(s, "切换下一队");
  const index = s.order.indexOf(s.currentTeam);
  for (let n = 1; n <= 5; n++) {
    const idx = (index + n) % 5,
      team = s.teams[s.order[idx]];
    if (!team.finishOrder) {
      if (index + n >= 5) s.round++;
      s.currentTeam = team.id;
      s.turnId++;
      team.representativeId = rosterRepresentative(s, team.id);
      s.phase = "awaiting_dice";
      s.dice = null;
      s.quiz = null;
      s.movement = null;
      s.presentation = null;
      s.transitionAt = null;
      event(s, "next", `第${s.round}轮 · ${team.name}回合开始`, actor);
      return;
    }
  }
  s.status = "finished";
  s.transitionAt = null;
  event(s, "end", "游戏结束");
}
export function tick(s, now = Date.now()) {
  if (s.status !== "running") return false;
  if (s.phase === "answering" && s.quiz.endsAt <= now) {
    s.phase = "quiz_closed";
    s.transitionAt = null;
    event(s, "quiz_close", "答题时间结束");
    return true;
  }
  if (!s.transitionAt || s.transitionAt > now) return false;
  s.transitionAt = null;
  const team = s.teams[s.currentTeam];
  if (s.phase === "rolling") move(s, team.position + s.dice.value, "dice", now);
  else if (s.phase === "moving") {
    if (s.movement.kind !== "dice") {
      complete(s, now);
      return true;
    }
    const tile = landing(team.position);
    s.lastTile = tile?.id ?? null;
    if (!tile) {
      complete(s, now);
      return true;
    }
    event(
      s,
      "landing",
      `${team.name}落在${String(tile.id).padStart(2, "0")} · ${tile.name}`,
    );
    if (tile.type === "normal") complete(s, now);
    else {
      s.phase = "tile_event";
      present(s, tile, tile.type, now);
      event(s, "tile_event", `${tileMessages[tile.id]} ${s.presentation.effect}`);
    }
  } else if (s.phase === "tile_event") {
    applyTile(s, landing(s.presentation.tile), now);
  } else if (s.phase === "revealed") applyAnswer(s, now);
  else if (s.phase === "turn_complete") {
    // Recheck the exceptions before executing a persisted timer.
    if (canAutoAdvance(s)) next(s, now);
  } else return false;
  return true;
}
function applyAnswer(s, now) {
  requireThat(s.phase === "revealed", "请先公布答案");
  requireThat(!s.presentation || now >= s.presentation.endsAt, "请等待特效展示结束");
  if (s.quiz.result.correct) {
    const tile = landing(s.teams[s.currentTeam].position);
    event(
      s,
      "correct",
      tile.id === 15
        ? "答对终极周年挑战，直达终点"
        : `答对，前进${tile.effect}格`,
    );
    move(
      s,
      tile.id === 15 ? 20 : s.teams[s.currentTeam].position + tile.effect,
      "answer",
      now,
    );
  } else {
    event(s, "incorrect", "未答对，棋子保持原位");
    complete(s, now);
  }
}
export function validateQuestion(q) {
  const tile = Number(q.tile);
  requireThat(
    tile === 0 || QUIZ_TILES.includes(tile),
    "题目归属应为0（所有答题格共用）或04、08、12、15、16号格",
  );
  requireThat(
    typeof q.text === "string" &&
      q.text.trim().length > 0 &&
      q.text.length <= 2000,
    "题目内容应为1–2000字",
  );
  requireThat(
    q.options &&
      ["A", "B", "C", "D"].every(
        (k) =>
          typeof q.options[k] === "string" &&
          q.options[k].trim().length > 0 &&
          q.options[k].length <= 1000,
      ),
    "必须填写四个选项",
  );
  requireThat(["A", "B", "C", "D"].includes(q.answer), "正确答案必须为A/B/C/D");
  return {
    id: q.id || randomUUID(),
    tile,
    text: q.text.trim(),
    options: Object.fromEntries(
      Object.entries(q.options)
        .filter(([k]) => ["A", "B", "C", "D"].includes(k))
        .map(([k, v]) => [k, v.trim()]),
    ),
    answer: q.answer,
    explanation: String(q.explanation || "").slice(0, 3000),
  };
}
export function command(
  s,
  actor,
  type,
  p = {},
  now = Date.now(),
  rng = rollActivityDie,
) {
  const host = actor.role === "host",
    player = s.players[actor.playerId];
  requireThat(
    host || (actor.role === "player" && player && !player.removed),
    "无操作权限",
  );
  const hostOnly = () => requireThat(host, "仅主持人可操作");
  const running = () =>
    requireThat(s.status === "running", "游戏未进行或已暂停");
  const current = () => s.teams[s.currentTeam];
  const record = (
    state,
    type,
    text,
    by = host ? "host" : actor.playerId,
    data = {},
  ) => event(state, type, text, by, data);
  if (type === "join") {
    requireThat(actor.role === "player", "仅玩家可加入");
    requireThat(!player.team, "你已加入队伍，变更请联系主持人");
    requireThat(TEAM_ORDER.includes(p.team), "队伍无效");
    requireThat(
      typeof p.nickname === "string" &&
        p.nickname.trim().length > 0 &&
        p.nickname.trim().length <= 24,
      "昵称应为1–24字",
    );
    player.team = p.team;
    player.nickname = p.nickname.trim();
    player.joinedAt = now;
    s.undo = null;
    record(
      s,
      "join",
      `${player.nickname}加入${s.teams[p.team].name}`,
      actor.playerId,
    );
  } else if (type === "start") {
    hostOnly();
    requireThat(s.status === "waiting", "游戏已开始");
    requireThat(
      s.order.some((id) => !s.teams[id].finishOrder),
      "所有队伍都已冲线，请重置游戏",
    );
    if (s.teams[s.currentTeam].finishOrder)
      s.currentTeam = s.order.find((id) => !s.teams[id].finishOrder);
    s.status = "running";
    for (const id of TEAM_ORDER)
      if (rosterRepresentative(s, id)) s.teams[id].representativeId = rosterRepresentative(s, id);
    s.undo = null;
    record(s, "start", "游戏开始 · 20格无限轮次");
  } else if (type === "pause") {
    hostOnly();
    running();
    s.status = "paused";
    s.pausedAt = now;
    record(s, "pause", "主持人暂停游戏");
  } else if (type === "resume") {
    hostOnly();
    requireThat(s.status === "paused", "游戏未暂停");
    const delta = now - s.pausedAt;
    if (s.transitionAt) s.transitionAt += delta;
    if (s.quiz?.endsAt) s.quiz.endsAt += delta;
    if (s.movement) s.movement.startedAt += delta;
    if (s.presentation) {
      s.presentation.startedAt += delta;
      s.presentation.endsAt += delta;
    }
    s.status = "running";
    s.pausedAt = null;
    record(s, "resume", "游戏恢复");
  } else if (type === "reset") {
    hostOnly();
    requireThat(p.confirm === s.code, "请输入房间号确认重置");
    Object.assign(s, freshGame());
    for (const id of TEAM_ORDER) s.teams[id].representativeId = rosterRepresentative(s, id);
    s.undo = null;
    record(s, "reset", "主持人重置游戏，保留员工与题库");
  } else if (type === "end") {
    hostOnly();
    requireThat(["running", "paused"].includes(s.status), "游戏未进行");
    s.status = "finished";
    s.transitionAt = null;
    s.presentation = null;
    s.undo = null;
    record(s, "end", "主持人提前结束游戏，未冲线队伍按位置排名");
  } else if (type === "setTeamRepresentative") {
    hostOnly();
    requireThat(TEAM_ORDER.includes(p.team) && p.team !== "shanghai", "请选择线上投骰队伍");
    requireThat(p.team !== s.currentTeam || s.status === "waiting" ||
      ["awaiting_dice", "turn_complete"].includes(s.phase), "请在本队投骰前或回合结束后更换代表");
    const id = p.playerId || null;
    const target = id ? s.players[id] : null;
    requireThat(!id || (target && !target.removed && target.team === p.team), "请选择该队伍的有效员工");
    s.representativeRoster ||= {};
    s.representativeRoster[p.team] = id;
    s.teams[p.team].representativeId = id;
    s.undo = null;
    record(s, "representative", `${s.teams[p.team].name}固定投骰代表：${target?.nickname || "未指定"}`);
  } else if (
    type === "assignRepresentative" ||
    type === "claimRepresentative"
  ) {
    if (!host) requireThat(!s.settings.hostOnlyRepresentatives, "投骰代表由主持人指定，员工不能自行申请");
    running();
    requireThat(s.phase === "awaiting_dice", "当前不能更换代表");
    requireThat(s.currentTeam !== "shanghai", "上海SSC由主持人录入实体骰子");
    const id = host ? p.playerId : actor.playerId,
      target = s.players[id];
    requireThat(
      target && !target.removed && target.team === s.currentTeam,
      "请选择当前队伍员工",
    );
    if (!host) requireThat(!current().representativeId, "本回合代表已指定");
    current().representativeId = id;
    s.undo = null;
    record(
      s,
      "representative",
      `${current().name}投骰代表：${target.nickname}`,
      actor.playerId || "host",
    );
  } else if (type === "roll" || type === "physicalDice") {
    running();
    requireThat(s.phase === "awaiting_dice", "本回合已投骰或尚未结束");
    requireThat(!current().finishOrder, "已冲线队伍不再投骰");
    let value;
    if (type === "physicalDice") {
      hostOnly();
      requireThat(s.currentTeam === "shanghai", "仅上海SSC使用实体骰子");
      value = Number(p.value);
      requireThat(
        Number.isInteger(value) && value >= 1 && value <= 6,
        "骰子点数必须为1–6",
      );
    } else {
      requireThat(
        !host &&
          current().representativeId === actor.playerId &&
          player.team === s.currentTeam,
        "仅当前队伍指定代表可投骰",
      );
      requireThat(s.currentTeam !== "shanghai", "上海SSC不能线上投骰");
      value = rng();
    }
    checkpoint(s, type === "roll" ? "线上投骰" : "上海SSC实体骰子");
    s.dice = {
      value,
      source: type === "roll" ? "online" : "physical",
      at: now,
      playerId: actor.playerId || null,
    };
    s.phase = "rolling";
    s.transitionAt = now + 1000;
    record(
      s,
      "dice",
      `${current().name}${type === "roll" ? "线上" : "实体"}骰子：${value}点`,
      actor.playerId || "host",
    );
  } else if (type === "cancelDice") {
    hostOnly();
    requireThat(s.phase === "rolling", "只能取消尚未生效的投骰");
    restore(s);
    record(s, "cancel", "主持人取消尚未生效的投骰");
  } else if (type === "next") {
    hostOnly();
    running();
    next(s, now, "host");
  } else if (type === "startQuiz") {
    hostOnly();
    running();
    requireThat(s.phase === "quiz_ready", "当前未停在待答题格");
    const available = availableQuestions(s, current().position);
    requireThat(
      available.length > 0,
      "此格可用题目已用完，请先添加或导入新题；本局不会重复出题",
    );
    const question = p.questionId
      ? available.find((q) => q.id === p.questionId)
      : available[randomInt(available.length)];
    requireThat(question, "题目不属于当前格或已使用");
    const seconds = Number(p.seconds ?? s.settings.answerSeconds);
    requireThat(
      Number.isInteger(seconds) && seconds >= 5 && seconds <= 300,
      "答题时间为5–300秒",
    );
    s.quiz = {
      id: randomUUID(),
      tile: current().position,
      question: clone(question),
      answers: {},
      startedAt: now,
      endsAt: now + seconds * 1000,
      result: null,
    };
    s.usedQuestions.push(question.id);
    s.usedQuestionKeys = [...usedQuestionKeys(s)];
    s.phase = "answering";
    s.undo = null;
    record(
      s,
      "quiz_start",
      `开始答题 · ${question.text} · ${seconds}秒`,
      "host",
      {
        questionId: question.id,
        tile: current().position,
        team: s.currentTeam,
        round: s.round,
        turnId: s.turnId,
      },
    );
  } else if (type === "answer") {
    requireThat(!host, "主持人不能代替员工投票");
    running();
    requireThat(s.phase === "answering" && now < s.quiz.endsAt, "答题已截止");
    requireThat(player.team === s.currentTeam, "仅当前队伍员工可参与本题");
    requireThat(["A", "B", "C", "D"].includes(p.option), "无效选项");
    s.quiz.answers[player.id] = { option: p.option, at: now };
    s.undo = null;
    record(s, "answer", `${player.nickname}提交或更新答案`, player.id, {
      private: true,
    });
  } else if (type === "closeQuiz") {
    hostOnly();
    running();
    requireThat(s.phase === "answering", "当前未答题");
    s.phase = "quiz_closed";
    record(s, "quiz_close", "主持人提前结束答题");
  } else if (type === "reveal") {
    hostOnly();
    running();
    requireThat(s.phase === "quiz_closed", "请先结束答题");
    s.quiz.result = tally(s.quiz.answers, s.quiz.question.answer);
    s.phase = "revealed";
    s.transitionAt = now + PRESENTATION_MS;
    if (s.quiz.result.correct)
      present(s, landing(current().position), "correct", now);
    s.undo = null;
    record(
      s,
      "reveal",
      `公布答案：${s.quiz.result.majority || "无唯一最多选项"} · ${s.quiz.result.correct ? "答对" : "未答对"}`,
    );
  } else if (type === "applyAnswer") {
    hostOnly();
    running();
    applyAnswer(s, now);
  } else if (type === "setOrder") {
    hostOnly();
    requireThat(s.status === "waiting", "请在游戏开始前修改顺序");
    requireThat(
      Array.isArray(p.order) &&
        p.order.length === 5 &&
        new Set(p.order).size === 5 &&
        p.order.every((x) => TEAM_ORDER.includes(x)),
      "行动顺序必须包含五支队伍各一次",
    );
    s.order = [...p.order];
    s.currentTeam = p.order[0];
    record(s, "order", "主持人调整行动顺序");
  } else if (type === "useBuiltinBgm") {
    hostOnly();
    s.audio = { ...audioState(s), bgm: clone(BUILTIN_BGM), bgmEnabled: false };
    record(s, "bgm", "主持人恢复正式内置背景音乐");
  } else if (type === "audioSettings") {
    hostOnly();
    const audio = audioState(s);
    for (const key of ["effectsEnabled", "bgmEnabled"]) {
      if (p[key] !== undefined) {
        requireThat(typeof p[key] === "boolean", "声音开关应为开启或关闭");
        if (key === "bgmEnabled" && p[key]) requireThat(audio.bgm, "请先上传背景音乐");
        audio[key] = p[key];
      }
    }
    for (const key of ["effectsVolume", "bgmVolume"]) {
      if (p[key] !== undefined) {
        requireThat(typeof p[key] === "number" && Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= 1, "音量应为0–100%");
        audio[key] = p[key];
      }
    }
    s.audio = audio;
    record(s, "audio_settings", "主持人调整大屏音乐与音效");
  } else if (type === "settings") {
    hostOnly();
    if (p.answerSeconds !== undefined) {
      const n = Number(p.answerSeconds);
      requireThat(
        Number.isInteger(n) && n >= 5 && n <= 300,
        "答题时间应为5–300秒",
      );
      s.settings.answerSeconds = n;
    }
    if (p.autoAdvance !== undefined) {
      s.settings.autoAdvance = !!p.autoAdvance;
      if (s.phase === "turn_complete") scheduleNextTurn(s, now);
    }
    if (p.hostOnlyRepresentatives !== undefined) {
      requireThat(typeof p.hostOnlyRepresentatives === "boolean", "代表设置应为开启或关闭");
      s.settings.hostOnlyRepresentatives = p.hostOnlyRepresentatives;
    }
    record(s, "settings", "主持人更新游戏设置");
  } else if (type === "manualMove") {
    hostOnly();
    requireThat(
      s.status === "paused" ||
        s.status === "waiting" ||
        (s.status === "running" && s.phase === "turn_complete"),
      "请先暂停游戏再修正",
    );
    requireThat(
      TEAM_ORDER.includes(p.team) &&
        Number.isInteger(p.position) &&
        p.position >= 0 &&
        p.position <= 20,
      "位置必须为0–20",
    );
    requireThat(
      typeof p.reason === "string" && p.reason.trim().length > 0,
      "请填写修正原因",
    );
    requireThat(
      !s.teams[p.team].finishOrder,
      "已冲线队伍请通过撤销恢复，不能改写完成名次",
    );
    requireThat(
      p.team !== s.currentTeam ||
        ["awaiting_dice", "turn_complete"].includes(s.phase),
      "当前队伍仍有未完成的移动或答题，请先完成或撤销该操作",
    );
    checkpoint(s, "手动修正");
    s.teams[p.team].position = p.position;
    finish(s, s.teams[p.team], now);
    if (p.team === s.currentTeam && p.position === 20 && s.status !== "waiting")
      complete(s, now);
    else if (
      s.status !== "waiting" &&
      Object.values(s.teams).every((t) => t.finishOrder)
    ) {
      s.status = "finished";
      s.transitionAt = null;
    }
    s.prizeConfirmation = null;
    record(
      s,
      "manual",
      `${s.teams[p.team].name}修正为${p.position}格：${p.reason.slice(0, 200)}`,
    );
  } else if (type === "undo") {
    hostOnly();
    const label = s.undo?.label;
    restore(s);
    record(s, "undo", `撤销：${label}`);
  } else if (type === "removePlayer" || type === "changePlayerTeam") {
    hostOnly();
    const target = s.players[p.playerId];
    requireThat(target && !target.removed, "员工不存在");
    requireThat(s.phase !== "answering", "请在答题结束后调整员工");
    if (type === "removePlayer") target.removed = true;
    else {
      requireThat(TEAM_ORDER.includes(p.team), "队伍无效");
      target.team = p.team;
    }
    for (const t of Object.values(s.teams))
      if (t.representativeId === target.id) t.representativeId = null;
    for (const id of TEAM_ORDER)
      if (s.representativeRoster?.[id] === target.id) delete s.representativeRoster[id];
    s.undo = null;
    s.prizeConfirmation = null;
    record(
      s,
      "player_admin",
      `主持人${type === "removePlayer" ? "移除" : "调整队伍"}：${target.nickname}`,
    );
  } else if (type === "saveQuestion" || type === "importQuestions") {
    hostOnly();
    requireThat(
      type === "saveQuestion" || Array.isArray(p.questions),
      "题库导入数据应为数组",
    );
    const questions =
      type === "saveQuestion"
        ? [validateQuestion(p)]
        : p.questions.map(validateQuestion);
    requireThat(
      questions.length > 0 && questions.length <= 1000,
      "一次导入1–1000题",
    );
    let saved = 0,
      skipped = 0;
    const used = usedQuestionKeys(s);
    for (const q of questions) {
      const key = questionKey(q);
      const duplicate = s.questions.find(
        (x) => x.id !== q.id && questionKey(x) === key,
      );
      if (duplicate && type === "importQuestions") {
        skipped++;
        continue;
      }
      requireThat(!duplicate, "题库已有相同问题，请编辑原题；本局不会重复出题");
      // IDs can change during import; keep the wording identity consumed too.
      requireThat(!used.has(key), "本局已使用相同问题，不能重新添加");
      const idx = s.questions.findIndex((x) => x.id === q.id);
      if (idx >= 0) {
        requireThat(!s.usedQuestions.includes(q.id), "已使用题目请新建版本");
        s.questions[idx] = q;
      } else s.questions.push(q);
      saved++;
    }
    record(s, "question", `保存${saved}道题目，跳过${skipped}道重复题目`);
  } else if (type === "deleteQuestion") {
    hostOnly();
    requireThat(!s.usedQuestions.includes(p.id), "不能删除本局已使用题目");
    s.questions = s.questions.filter((q) => q.id !== p.id);
    record(s, "question", "删除未使用题目");
  } else if (type === "savePositions") {
    hostOnly();
    requireThat(
      Array.isArray(p.positions) &&
        p.positions.length === 20 &&
        new Set(p.positions.map((x) => x.id)).size === 20,
      "需要20个独立坐标",
    );
    requireThat(
      p.positions.every(
        (x) =>
          Number.isInteger(x.id) &&
          x.id >= 1 &&
          x.id <= 20 &&
          Number.isFinite(x.x) &&
          x.x >= 0 &&
          x.x <= 100 &&
          Number.isFinite(x.y) &&
          x.y >= 0 &&
          x.y <= 100,
      ),
      "坐标必须在0–100范围",
    );
    s.positions = p.positions.map(({ id, x, y }) => ({ id, x, y }));
    record(s, "calibrate", "主持人保存棋盘坐标配置");
  } else if (type === "confirmPrizes") {
    hostOnly();
    requireThat(s.status === "finished", "请先结束游戏");
    const ranks = rankings(s.teams);
    const first = Array.isArray(p.first) ? p.first : [],
      second = Array.isArray(p.second) ? p.second : [];
    requireThat(
      first.length > 0 &&
        second.length > 0 &&
        new Set(first).size === first.length &&
        new Set(second).size === second.length &&
        first.every((id) => ranks.some((t) => t.id === id && t.rank === 1)) &&
        second.every((id) => ranks.some((t) => t.id === id && t.rank <= 3)),
      "确认名单应在对应排名资格内",
    );
    requireThat(
      first.every((id) => second.includes(id)),
      "一等奖候选队伍也应属于二等奖候选范围",
    );
    requireThat(
      ranks
        .filter((t) => t.rank <= 3)
        .every(
          (t) =>
            second.includes(t.id) ||
            ranks.filter((x) => x.rank === t.rank).length > 1,
        ),
      "不得排除无并列的前3名队伍",
    );
    s.prizeConfirmation = { first, second, at: now };
    s.undo = null;
    record(s, "prizes", "主持人确认并列排名的抽奖资格", "host", {
      first,
      second,
    });
  } else throw new GameError("未知操作");
}
function restore(s) {
  requireThat(s.undo, "没有可以安全撤销的操作");
  const paused = s.status === "paused",
    pausedAt = s.pausedAt;
  Object.assign(s, clone(s.undo.game));
  s.presentation = clone(s.undo.game.presentation ?? null);
  // Undoing a team change should leave time for the host to inspect/correct it.
  if (s.phase === "turn_complete") s.transitionAt = null;
  if (paused && s.status === "running") {
    s.status = "paused";
    s.pausedAt = pausedAt;
  }
  s.undo = null;
}
export function prizeCandidates(s) {
  const ranks = rankings(s.teams),
    tied = ranks.some(
      (t, i) => i > 0 && t.rank === ranks[i - 1].rank && t.rank <= 3,
    );
  if (tied && !s.prizeConfirmation)
    return { needsConfirmation: true, prizes: [] };
  const first =
    s.prizeConfirmation?.first ??
    ranks.filter((t) => t.rank === 1).map((t) => t.id);
  const second =
    s.prizeConfirmation?.second ??
    ranks.filter((t) => t.rank <= 3).map((t) => t.id);
  const employees = Object.values(s.players).filter(
    (p) => p.team && !p.removed,
  );
  return {
    needsConfirmation: false,
    prizes: [
      ["一等奖", 500, 1, first],
      ["二等奖", 300, 2, second],
      ["三等奖", 120, 5, TEAM_ORDER],
    ].map(([name, value, quantity, teams]) => ({
      name,
      value,
      quantity,
      teams,
      players: employees
        .filter((p) => teams.includes(p.team))
        .map(({ id, nickname, team }) => ({ id, nickname, team })),
    })),
  };
}
export function publicState(s, actor, online = new Set(), shared = null) {
  const host = actor.role === "host",
    me = s.players[actor.playerId],
    q = s.quiz;
  // The caller supplies a screen-safe snapshot for this exact room version.
  // Reuse shared counts and history while keeping each player's answer private.
  if (shared && !host)
    return {
      ...shared,
      me: me
        ? {
            id: me.id,
            nickname: me.nickname,
            team: me.team,
            removed: !!me.removed,
          }
        : null,
      quiz: shared.quiz
        ? {
            ...shared.quiz,
            myAnswer: q.answers[actor.playerId]?.option ?? null,
          }
        : null,
    };
  const result = {
    code: s.code,
    version: s.version,
    status: s.status,
    phase: s.phase,
    round: s.round,
    turnId: s.turnId,
    currentTeam: s.currentTeam,
    order: s.order,
    teams: Object.fromEntries(
      Object.entries(s.teams).map(([id, t]) => [
        id,
        {
          ...t,
          members: Object.values(s.players).filter(
            (p) => p.team === id && !p.removed,
          ).length,
          online: Object.values(s.players).filter(
            (p) => p.team === id && !p.removed && online.has(p.id),
          ).length,
          representativeName: s.players[t.representativeId]?.nickname ?? null,
        },
      ]),
    ),
    dice: s.dice,
    diceProbabilities: ACTIVITY_DICE_WEIGHTS,
    movement: s.movement,
    presentation: s.presentation ?? null,
    lastTile: s.lastTile,
    positions: s.positions,
    settings: s.settings,
    ...(host ? { representativeRoster: s.representativeRoster || {} } : {}),
    audio: audioState(s),
    autoNextAt:
      s.status === "running" && s.phase === "turn_complete" && canAutoAdvance(s)
        ? s.transitionAt
        : null,
    rankings: rankings(s.teams),
    events: s.events.filter((e) => host || !e.private).slice(-100),
    serverTime: Date.now(),
    pausedAt: s.pausedAt,
    onlineCount: online.size,
    quiz: q
      ? {
          id: q.id,
          tile: q.tile ?? (q.question.tile || s.lastTile),
          question: {
            id: q.question.id,
            tile: q.question.tile,
            text: q.question.text,
            options: q.question.options,
            ...(host || q.result
              ? {
                  answer: q.question.answer,
                  explanation: q.question.explanation,
                }
              : {}),
          },
          endsAt: q.endsAt,
          submitted: Object.keys(q.answers).length,
          eligible: Object.values(s.players).filter(
            (p) => p.team === s.currentTeam && !p.removed,
          ).length,
          myAnswer: q.answers[actor.playerId]?.option ?? null,
          result: q.result,
          ...(host
            ? {
                counts: tally(q.answers, q.question.answer).counts,
                answers: q.answers,
              }
            : {}),
        }
      : null,
    me: me
      ? {
          id: me.id,
          nickname: me.nickname,
          team: me.team,
          removed: !!me.removed,
        }
      : null,
  };
  if (host) {
    const used = usedQuestionKeys(s);
    Object.assign(result, {
      players: Object.values(s.players).map(({ tokenHash: _, ...p }) => ({
        ...p,
        online: online.has(p.id),
      })),
      questions: s.questions,
      usedQuestions: [
        ...new Set([
          ...s.usedQuestions,
          ...s.questions
            .filter((q) => used.has(questionKey(q)))
            .map((q) => q.id),
        ]),
      ],
      questionUsage: s.events
        .filter((e) => e.type === "quiz_start" && e.questionId)
        .map(({ questionId, tile, team, round, turnId, at }) => ({
          questionId,
          tile,
          team,
          round,
          turnId,
          at,
        })),
      canUndo: !!s.undo,
      undoLabel: s.undo?.label,
      prizes: s.status === "finished" ? prizeCandidates(s) : null,
    });
  } else if (s.status === "finished")
    result.prizes = {
      needsConfirmation: prizeCandidates(s).needsConfirmation,
      prizes: prizeCandidates(s).prizes.map(({ players: _, ...p }) => p),
    };
  return result;
}
