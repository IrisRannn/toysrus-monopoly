import { useEffect, useState } from "react";
import {
  useGame,
  request,
  tokenKey,
  download,
  type GameConnection,
} from "../hooks/useGame";
import {
  Brand,
  Network,
  ErrorBar,
  RoomForm,
  Status,
  Ranking,
  Countdown,
} from "../components/Common";
import { TILES, tileName, phaseNames } from "../config";
import Board from "../components/Board";
import Dice from "../components/Dice";
import type { GameState, Question, Position, TeamId } from "../types";
type Tab = "control" | "players" | "questions" | "events" | "prizes" | "board";
const tabs: [Tab, string, string][] = [
  ["control", "◈", "现场控制"],
  ["players", "♧", "队伍与员工"],
  ["questions", "▤", "题库管理"],
  ["events", "↺", "操作记录"],
  ["prizes", "♛", "排名与抽奖"],
  ["board", "⌖", "棋盘校准"],
];
export default function Host() {
  const game = useGame("host"),
    { state: s } = game,
    [tab, setTab] = useState<Tab>("control"),
    [qr, setQr] = useState(""),
    [joinBase, setJoinBase] = useState(location.origin),
    [newOrder, setNewOrder] = useState<TeamId[]>([]);
  useEffect(() => {
    if (s && newOrder.length === 0) setNewOrder(s.order);
  }, [s, newOrder.length]);
  useEffect(() => {
    if (!s) return;
    let active = true;
    let objectUrl = "";
    fetch(`/api/rooms/${s.code}/qr?base=${encodeURIComponent(joinBase)}`, {
      headers: {
        "x-game-role": "host",
        Authorization: `Bearer ${localStorage.getItem(tokenKey(s.code, "host")) || ""}`,
      },
    })
      .then(async (res) => {
        if (res.ok) {
          objectUrl = URL.createObjectURL(await res.blob());
          if (active) setQr(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [s?.code, joinBase]);
  if (!game.room || !game.credential) return <RoomForm role="host" />;
  if (!s)
    return (
      <main className="entry">
        <section className="entry-card">
          <Brand />
          <h2>正在连接控制台</h2>
          <ErrorBar game={game} />
          <button onClick={game.logout}>重新登录</button>
        </section>
      </main>
    );
  const team = s.teams[s.currentTeam],
    activePlayers = (s.players || []).filter((p) => !p.removed),
    isRunning = s.status === "running",
    disabled = game.busy || !game.connected;
  const guard = (text: string, type: string, payload: unknown = {}) => {
    if (confirm(text)) void game.cmd(type, payload);
  };
  const exportFile = async (kind: string, name: string) => {
    try {
      await download(s.code, kind, name);
    } catch (e) {
      game.setError((e as Error).message);
    }
  };
  function moveOrder(index: number, delta: number) {
    const next = [...newOrder],
      target = index + delta;
    if (target < 0 || target >= 5) return;
    [next[index], next[target]] = [next[target], next[index]];
    setNewOrder(next);
  }
  return (
    <div className="host-app">
      <aside className="host-sidebar">
        <a href="/">
          <Brand small />
        </a>
        <div className="sidebar-room">
          <span>年会游戏房间</span>
          <b>{s.code}</b>
          <Network connected={game.connected} />
        </div>
        <nav>
          {tabs.map(([id, icon, text]) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              onClick={() => setTab(id)}
            >
              <span aria-hidden="true">{icon}</span>
              {text}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a target="_blank" rel="noreferrer" href={`/screen?room=${s.code}`}>
            ↗ 打开游戏大屏
          </a>
          <a target="_blank" rel="noreferrer" href={`/player?room=${s.code}`}>
            ↗ 打开玩家页面
          </a>
          <button onClick={game.logout}>退出主持人会话</button>
        </div>
      </aside>
      <main className="host-main">
        <header className="host-topbar">
          <div>
            <div className="eyebrow">TOYS“R”US · 20TH ANNIVERSARY</div>
            <h1>{tabs.find((t) => t[0] === tab)?.[2]}</h1>
          </div>
          <div className="topbar-stats">
            <span>
              <b>{activePlayers.length}</b> 位员工
            </span>
            <span>
              <b>{s.onlineCount}</b> 人在线
            </span>
            <Status state={s} />
          </div>
        </header>
        <ErrorBar game={game} />
        {tab === "control" && (
          <>
            <div className="control-top">
              <section
                className="panel current-turn"
                style={{ "--team-color": team.color } as React.CSSProperties}
              >
                <div className="section-heading">
                  <span className="eyebrow">
                    第 {s.round} 轮 · 第 {s.turnId} 回合
                  </span>
                  <span className="pill">{team.position} / 20 格</span>
                </div>
                <h2>
                  {team.name}
                  <span>当前行动</span>
                </h2>
                <p>
                  {s.status === "waiting"
                    ? "等待开场，确认所有队伍已经加入。"
                    : phaseNames[s.phase]}
                </p>
                <div className="turn-details">
                  <div>
                    <small>当前落点</small>
                    <b>{tileName(team.position)}</b>
                  </div>
                  <div>
                    <small>投骰代表</small>
                    <b>
                      {team.id === "shanghai"
                        ? "现场实体骰子"
                        : team.representativeName || "等待指定"}
                    </b>
                  </div>
                </div>
                {s.dice && (
                  <div className="host-dice">
                    <Dice
                      value={s.dice.value}
                      rolling={s.phase === "rolling" && isRunning}
                    />
                    <span>
                      {s.dice.value} 点 ·{" "}
                      {s.dice.source === "physical" ? "实体骰子" : "线上骰子"}
                    </span>
                  </div>
                )}
                <div className="button-row">
                  {s.status === "waiting" && (
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() => void game.cmd("start")}
                    >
                      ▶ 开始游戏
                    </button>
                  )}
                  {isRunning && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() => void game.cmd("pause")}
                    >
                      Ⅱ 暂停
                    </button>
                  )}
                  {s.status === "paused" && (
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() => void game.cmd("resume")}
                    >
                      ▶ 恢复游戏
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={
                      disabled || !isRunning || s.phase !== "turn_complete"
                    }
                    onClick={() => void game.cmd("next")}
                  >
                    下一队 →
                  </button>
                  <button
                    className="danger-subtle"
                    disabled={
                      disabled || !["running", "paused"].includes(s.status)
                    }
                    onClick={() =>
                      guard(
                        "确定提前结束本场游戏？未冲线队伍按位置排名。",
                        "end",
                      )
                    }
                  >
                    结束游戏
                  </button>
                </div>
              </section>
              <section className="panel join-panel">
                <div className="eyebrow">扫码加入 · 童心集结</div>
                <h2>让全场一起玩</h2>
                {qr ? (
                  <img src={qr} alt="员工加入二维码" />
                ) : (
                  <div className="qr-placeholder">生成二维码中…</div>
                )}
                <p>
                  房间号 <b>{s.code}</b>
                </p>
                <label>
                  手机可访问的站点地址
                  <input
                    aria-label="加入站点地址"
                    value={joinBase}
                    onChange={(e) => setJoinBase(e.target.value)}
                  />
                </label>
                <small>现场请填写局域网 IP 或已部署的 HTTPS 域名。</small>
                <a
                  href={`${joinBase}/player?room=${s.code}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看员工加入链接 ↗
                </a>
              </section>
            </div>
            {team.id === "shanghai" &&
              isRunning &&
              s.phase === "awaiting_dice" && (
                <section className="panel physical-control">
                  <div>
                    <div className="eyebrow">上海SSC · 实体大骰子</div>
                    <h2>现场投掷后，点击实际点数</h2>
                    <p>录入后自动移动；误录可在安全范围内撤销。</p>
                  </div>
                  <div className="physical-buttons">
                    {[1, 2, 3, 4, 5, 6].map((value) => (
                      <button
                        key={value}
                        disabled={disabled}
                        onClick={() => void game.cmd("physicalDice", { value })}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            {isRunning &&
              s.phase === "awaiting_dice" &&
              team.id !== "shanghai" && (
                <section className="panel">
                  <div className="section-heading">
                    <h2>指定本回合投骰代表</h2>
                    <span className="muted">也允许本队员工先到先得申请</span>
                  </div>
                  <div className="representative-choices">
                    {activePlayers
                      .filter((p) => p.team === team.id)
                      .map((p) => (
                        <button
                          className={
                            team.representativeId === p.id ? "selected" : ""
                          }
                          key={p.id}
                          disabled={disabled}
                          onClick={() =>
                            void game.cmd("assignRepresentative", {
                              playerId: p.id,
                            })
                          }
                        >
                          {p.nickname}
                          <span>{p.online ? "● 在线" : "○ 离线"}</span>
                        </button>
                      ))}
                    {!activePlayers.some((p) => p.team === team.id) && (
                      <p className="muted">本队还没有员工加入。</p>
                    )}
                  </div>
                </section>
              )}
            {(s.phase === "quiz_ready" || s.quiz) && (
              <QuizControl game={game} state={s} />
            )}
            <section className="panel">
              <div className="section-heading">
                <h2>五队实时状态</h2>
                <span className="muted">无限轮次 · 冲线先后决定名次</span>
              </div>
              <div className="team-overview">
                {s.order.map((id) => {
                  const t = s.teams[id];
                  return (
                    <div
                      key={id}
                      className={t.id === team.id ? "current" : ""}
                      style={{ "--team-color": t.color } as React.CSSProperties}
                    >
                      <div>
                        <span
                          className="team-dot"
                          style={{ background: t.color }}
                        />
                        <b>{t.name}</b>
                      </div>
                      <strong>
                        {t.position}
                        <small>/20</small>
                      </strong>
                      <span>
                        {t.finishOrder
                          ? `第${t.finishOrder}名 · 已冲线`
                          : t.id === team.id
                            ? phaseNames[s.phase]
                            : "等待回合"}
                      </span>
                      <p>
                        {t.members} 人加入 · {t.online} 人在线
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
            <div className="two-columns">
              <section className="panel">
                <h2>现场设置</h2>
                <label className="inline-label">
                  <span>答题时间（秒）</span>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    defaultValue={s.settings.answerSeconds}
                    onBlur={(e) =>
                      void game.cmd("settings", {
                        answerSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={s.settings.autoAdvance}
                    onChange={(e) =>
                      void game.cmd("settings", {
                        autoAdvance: e.target.checked,
                      })
                    }
                  />
                  完成格子事件后自动切换下一队
                </label>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={disabled || !s.canUndo}
                    onClick={() =>
                      guard(`确认撤销「${s.undoLabel}」？`, "undo")
                    }
                  >
                    ↶ 撤销 {s.undoLabel || ""}
                  </button>
                  <button
                    className="secondary"
                    disabled={disabled || s.phase !== "rolling"}
                    onClick={() => void game.cmd("cancelDice")}
                  >
                    取消未生效投骰
                  </button>
                </div>
              </section>
              <section className="panel">
                <h2>最近发生</h2>
                <div className="mini-events">
                  {s.events
                    .slice(-4)
                    .reverse()
                    .map((e) => (
                      <div key={e.id}>
                        <time>{new Date(e.at).toLocaleTimeString()}</time>
                        <span>{e.text}</span>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          </>
        )}
        {tab === "players" && (
          <>
            <section className="panel">
              <h2>队伍行动顺序</h2>
              <p className="muted">
                开场前可调整，已冲线队伍在后续回合自动跳过。
              </p>
              <div className="order-editor">
                {newOrder.map((id, i) => (
                  <div key={id}>
                    <b>
                      {i + 1}. {s.teams[id].name}
                    </b>
                    <button
                      aria-label={`${s.teams[id].name}前移`}
                      disabled={i === 0 || s.status !== "waiting"}
                      onClick={() => moveOrder(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`${s.teams[id].name}后移`}
                      disabled={i === 4 || s.status !== "waiting"}
                      onClick={() => moveOrder(i, 1)}
                    >
                      ↓
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="primary"
                disabled={disabled || s.status !== "waiting"}
                onClick={() => void game.cmd("setOrder", { order: newOrder })}
              >
                保存行动顺序
              </button>
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>员工名单</h2>
                <span className="muted">{activePlayers.length} 位员工</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>员工昵称</th>
                      <th>队伍</th>
                      <th>在线状态</th>
                      <th>管理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePlayers.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.nickname}
                          {s.teams[p.team].representativeId === p.id && (
                            <span className="pill">代表</span>
                          )}
                        </td>
                        <td>
                          <select
                            aria-label={`${p.nickname}所属队伍`}
                            value={p.team}
                            disabled={s.phase === "answering"}
                            onChange={(e) =>
                              guard(
                                `确认调整${p.nickname}的队伍？`,
                                "changePlayerTeam",
                                { playerId: p.id, team: e.target.value },
                              )
                            }
                          >
                            {s.order.map((id) => (
                              <option key={id} value={id}>
                                {s.teams[id].name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span
                            className={
                              "network " + (p.online ? "online" : "offline")
                            }
                          >
                            <i />
                            {p.online ? "在线" : "离线"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="text-button danger-text"
                            disabled={s.phase === "answering"}
                            onClick={() =>
                              guard(
                                `确定移除 ${p.nickname}？`,
                                "removePlayer",
                                { playerId: p.id },
                              )
                            }
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!activePlayers.length && (
                  <div className="empty">
                    还没有员工加入，先邀请大家扫码吧。
                  </div>
                )}
              </div>
            </section>
            <ManualControl game={game} state={s} />
          </>
        )}
        {tab === "questions" && <QuestionManager game={game} state={s} />}
        {tab === "events" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>操作日志</h2>
                <p className="muted">数据库保留完整日志，页面展示最近100条。</p>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() =>
                    void exportFile("export/events", "game-events.json")
                  }
                >
                  导出日志
                </button>
                <button
                  className="primary"
                  disabled={!s.canUndo || disabled}
                  onClick={() => guard(`确定撤销「${s.undoLabel}」？`, "undo")}
                >
                  ↶ 安全撤销
                </button>
              </div>
            </div>
            <div className="event-list">
              {[...s.events].reverse().map((e) => (
                <article key={e.id}>
                  <time>{new Date(e.at).toLocaleString()}</time>
                  <span className="pill">{e.type}</span>
                  <p>{e.text}</p>
                </article>
              ))}
            </div>
            <div className="danger-zone">
              <h3>重置游戏</h3>
              <p>保留房间员工、题库和历史日志，棋子回到起点。</p>
              <button
                className="danger"
                onClick={() => {
                  const code = prompt(`请输入房间号 ${s.code} 确认重置`);
                  if (code && confirm("再次确认：重置本场游戏？"))
                    void game.cmd("reset", { confirm: code });
                }}
              >
                重置本场游戏
              </button>
            </div>
          </section>
        )}
        {tab === "prizes" && <PrizeManager game={game} state={s} />}
        {tab === "board" && <BoardCalibration game={game} state={s} />}
      </main>
    </div>
  );
}
function QuizControl({
  game,
  state: s,
}: {
  game: GameConnection;
  state: GameState;
}) {
  const [selected, setSelected] = useState(""),
    [seconds, setSeconds] = useState(s.settings.answerSeconds);
  const questions = (s.questions || []).filter(
      (q) =>
        q.tile === s.teams[s.currentTeam].position &&
        !s.usedQuestions?.includes(q.id),
    ),
    quiz = s.quiz;
  return (
    <section className="panel host-quiz">
      <div className="section-heading">
        <div>
          <div className="eyebrow">集体答题控制台</div>
          <h2>
            {s.phase === "quiz_ready"
              ? tileName(s.teams[s.currentTeam].position)
              : quiz?.question.text}
          </h2>
        </div>
        {quiz && <Countdown state={s} offset={game.offset} />}
      </div>
      {s.phase === "quiz_ready" ? (
        <>
          <div className="form-row">
            <label>
              选择题目
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">从本格未使用题目中随机抽取</option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.text}
                  </option>
                ))}
              </select>
            </label>
            <label>
              答题时间
              <input
                type="number"
                min={5}
                max={300}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
            </label>
          </div>
          {!questions.length && (
            <p className="notice">
              此格没有未使用题目，请先在「题库管理」添加。系统不会使用虚构品牌题目。
            </p>
          )}
          <button
            className="primary"
            disabled={game.busy || s.status !== "running"}
            onClick={() =>
              void game.cmd("startQuiz", {
                questionId: selected || undefined,
                seconds,
              })
            }
          >
            开始答题
          </button>
        </>
      ) : (
        quiz && (
          <>
            <div className="answer-bars">
              {Object.entries(quiz.question.options).map(([key, text]) => (
                <div key={key}>
                  <b>{key}</b>
                  <span>
                    {text}
                    <i
                      style={{
                        width:
                          (quiz.eligible
                            ? ((quiz.counts?.[key] || 0) / quiz.eligible) * 100
                            : 0) + "%",
                      }}
                    />
                  </span>
                  <strong>{quiz.counts?.[key] || 0}票</strong>
                </div>
              ))}
            </div>
            <p>
              {quiz.submitted} / {quiz.eligible} 人已提交 ·
              正确答案仅主持人可见：<b>{quiz.question.answer}</b>
            </p>
            <details className="answer-details">
              <summary>查看员工答题明细</summary>
              {Object.entries(quiz.answers || {}).map(([id, answer]) => (
                <p key={id}>
                  {s.players?.find((p) => p.id === id)?.nickname ||
                    "已移除员工"}{" "}
                  · {answer.option} · {new Date(answer.at).toLocaleTimeString()}
                </p>
              ))}
            </details>
            <div className="button-row">
              <button
                className="secondary"
                disabled={
                  game.busy || s.status !== "running" || s.phase !== "answering"
                }
                onClick={() => void game.cmd("closeQuiz")}
              >
                提前结束答题
              </button>
              <button
                className="primary"
                disabled={
                  game.busy ||
                  s.status !== "running" ||
                  s.phase !== "quiz_closed"
                }
                onClick={() => void game.cmd("reveal")}
              >
                公布答案
              </button>
              <button
                className="secondary"
                disabled={
                  game.busy || s.status !== "running" || s.phase !== "revealed"
                }
                onClick={() => void game.cmd("applyAnswer")}
              >
                立即执行答题结果
              </button>
            </div>
            {quiz.result && (
              <p className="notice">
                最终选择：{quiz.result.majority || "无唯一最多选项"} ·{" "}
                {quiz.result.correct
                  ? "答对，执行格子前进效果"
                  : "未答对，原地不动"}
                。{quiz.question.explanation}
              </p>
            )}
          </>
        )
      )}
    </section>
  );
}
const blankQuestion = () => ({
  id: "",
  tile: 4,
  text: "",
  options: { A: "", B: "", C: "", D: "" },
  answer: "A",
  explanation: "",
});
function QuestionManager({
  game,
  state: s,
}: {
  game: GameConnection;
  state: GameState;
}) {
  const [draft, setDraft] = useState(blankQuestion),
    [filter, setFilter] = useState(0),
    [importing, setImporting] = useState(false),
    [message, setMessage] = useState("");
  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    game.setError("");
    setMessage("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("文件不能超过5MB");
      const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
      let content = await file.text();
      if (format === "xlsx")
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      await request(
        `/api/rooms/${s.code}/commands`,
        "POST",
        { type: "importQuestions", payload: { format, content } },
        s.code,
      );
      setMessage("导入成功，所有题目已通过格式校验。");
    } catch (e) {
      game.setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  async function template(format: string) {
    try {
      await download(
        s.code,
        `template/${format}`,
        `questions-template.${format}`,
      );
    } catch (e) {
      game.setError((e as Error).message);
    }
  }
  function edit(q: Question) {
    setDraft({
      id: q.id,
      tile: q.tile,
      text: q.text,
      options: {
        A: q.options.A,
        B: q.options.B,
        C: q.options.C,
        D: q.options.D,
      },
      answer: q.answer || "A",
      explanation: q.explanation || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{draft.id ? "编辑题目" : "添加正式题目"}</h2>
            <p className="muted">请由品牌方提供正式题目，题库默认保持为空。</p>
          </div>
          <button
            className="secondary"
            onClick={() => setDraft(blankQuestion())}
          >
            新建题目
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void game
              .cmd("saveQuestion", { ...draft, id: draft.id || undefined })
              .then((ok) => {
                if (ok) {
                  setDraft(blankQuestion());
                  setMessage("题目已保存");
                }
              });
          }}
        >
          <div className="form-row">
            <label>
              所属格子
              <select
                value={draft.tile}
                onChange={(e) =>
                  setDraft({ ...draft, tile: Number(e.target.value) })
                }
              >
                {TILES.filter((t) => t.type === "quiz").map((t) => (
                  <option value={t.id} key={t.id}>
                    {String(t.id).padStart(2, "0")} · {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              正确答案
              <select
                value={draft.answer}
                onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
              >
                {["A", "B", "C", "D"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            题目内容
            <textarea
              required
              value={draft.text}
              maxLength={2000}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </label>
          <div className="two-columns">
            {["A", "B", "C", "D"].map((key) => (
              <label key={key}>
                {key} 选项
                <input
                  required
                  maxLength={1000}
                  value={draft.options[key as keyof typeof draft.options]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      options: { ...draft.options, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            答案解析
            <textarea
              value={draft.explanation}
              onChange={(e) =>
                setDraft({ ...draft, explanation: e.target.value })
              }
            />
          </label>
          <button className="primary" disabled={game.busy}>
            保存题目
          </button>
          {message && (
            <span className="success-message" role="status">
              {message}
            </span>
          )}
        </form>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>批量导入</h2>
          <div className="button-row">
            <button className="secondary" onClick={() => void template("csv")}>
              CSV 模板 ↓
            </button>
            <button className="secondary" onClick={() => void template("xlsx")}>
              Excel 模板 ↓
            </button>
            <label className="file-button">
              {importing ? "正在导入…" : "导入 CSV / XLSX"}
              <input
                type="file"
                accept=".csv,.xlsx"
                disabled={importing}
                onChange={(e) => {
                  void importFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <p className="muted">
          列名：tile, question, A, B, C, D, answer,
          explanation。一次最多1000题；任何一行错误将整批拒绝，避免导入一半。
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>全部题目 · {s.questions?.length || 0}</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(Number(e.target.value))}
          >
            <option value={0}>所有答题格</option>
            {[4, 8, 12, 15, 16].map((n) => (
              <option key={n} value={n}>
                {n}号格
              </option>
            ))}
          </select>
        </div>
        <div className="question-list">
          {(s.questions || [])
            .filter((q) => !filter || q.tile === filter)
            .map((q) => (
              <article key={q.id}>
                <span className="pill">{q.tile}号格</span>
                <div>
                  <h3>{q.text}</h3>
                  <p className="muted">
                    答案 {q.answer} ·{" "}
                    {s.usedQuestions?.includes(q.id)
                      ? "本局已使用"
                      : "尚未使用"}
                  </p>
                  <details className="answer-details">
                    <summary>
                      使用记录（
                      {s.questionUsage?.filter((u) => u.questionId === q.id)
                        .length || 0}
                      次）
                    </summary>
                    {s.questionUsage
                      ?.filter((u) => u.questionId === q.id)
                      .map((u) => (
                        <p key={u.turnId + ":" + u.at}>
                          {new Date(u.at).toLocaleString()} · 第{u.round}轮 ·{" "}
                          {s.teams[u.team].name}
                        </p>
                      ))}
                  </details>
                </div>
                <button
                  className="text-button"
                  disabled={s.usedQuestions?.includes(q.id)}
                  onClick={() => edit(q)}
                >
                  编辑
                </button>
                <button
                  className="text-button danger-text"
                  disabled={s.usedQuestions?.includes(q.id)}
                  onClick={() => {
                    if (confirm("确定删除这道题目？"))
                      void game.cmd("deleteQuestion", { id: q.id });
                  }}
                >
                  删除
                </button>
              </article>
            ))}
        </div>
        {!s.questions?.length && (
          <div className="empty">
            还没有正式题目。请添加，或下载模板后批量导入。
          </div>
        )}
      </section>
    </>
  );
}
function ManualControl({
  game,
  state: s,
}: {
  game: GameConnection;
  state: GameState;
}) {
  const [team, setTeam] = useState<TeamId>("east"),
    [position, setPosition] = useState(0),
    [reason, setReason] = useState("");
  return (
    <section className="panel">
      <h2>主持人应急修正</h2>
      <p className="muted">
        请先暂停正在进行的回合。每次修正都记录原因，可在安全范围内撤销。
      </p>
      <div className="form-row">
        <label>
          队伍
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value as TeamId)}
          >
            {s.order.map((id) => (
              <option key={id} value={id}>
                {s.teams[id].name}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标格子
          <input
            type="number"
            min={0}
            max={20}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
        </label>
        <label>
          修正原因
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="必须填写"
          />
        </label>
      </div>
      <button
        className="secondary"
        disabled={game.busy || !reason}
        onClick={() => {
          if (
            confirm(
              `确认把${s.teams[team].name}改为${position}格？原因：${reason}`,
            )
          )
            void game.cmd("manualMove", { team, position, reason });
        }}
      >
        记录并执行修正
      </button>
    </section>
  );
}
function PrizeManager({
  game,
  state: s,
}: {
  game: GameConnection;
  state: GameState;
}) {
  const [first, setFirst] = useState<TeamId[]>([]),
    [second, setSecond] = useState<TeamId[]>([]);
  const select = (ids: TeamId[], id: TeamId) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  return (
    <div className="two-columns">
      <section className="panel">
        <div className="eyebrow">
          {s.status === "finished" ? "最终排名" : "实时排名"}
        </div>
        <h2>谁先冲线，谁先闪耀。</h2>
        <Ranking state={s} />
        <p className="muted">
          冲线队伍按到达顺序排名；未冲线队伍同格允许并列。
        </p>
      </section>
      <section className="panel">
        <h2>周年大奖 · 抽奖资格</h2>
        <div className="prize-summary">
          <div>
            <b>一等奖</b>
            <strong>
              ¥500 <small>× 1</small>
            </strong>
            <span>第1名队伍</span>
          </div>
          <div>
            <b>二等奖</b>
            <strong>
              ¥300 <small>× 2</small>
            </strong>
            <span>前3名队伍</span>
          </div>
          <div>
            <b>三等奖</b>
            <strong>
              ¥120 <small>× 5</small>
            </strong>
            <span>全体员工</span>
          </div>
        </div>
        {s.status !== "finished" ? (
          <p className="notice">游戏结束后生成候选员工名单，不执行额外抽奖。</p>
        ) : s.prizes?.needsConfirmation ? (
          <div className="tie-confirm">
            <p className="notice">
              存在并列排名，请主持人确认抽奖资格。确认将写入操作日志。
            </p>
            <h3>一等奖候选队伍</h3>
            {s.rankings
              .filter((t) => t.rank === 1)
              .map((t) => (
                <label className="check-label" key={t.id}>
                  <input
                    type="checkbox"
                    checked={first.includes(t.id)}
                    onChange={() => setFirst(select(first, t.id))}
                  />
                  {t.name}
                </label>
              ))}
            <h3>二等奖候选队伍</h3>
            {s.rankings
              .filter((t) => t.rank! <= 3)
              .map((t) => (
                <label className="check-label" key={t.id}>
                  <input
                    type="checkbox"
                    checked={second.includes(t.id)}
                    onChange={() => setSecond(select(second, t.id))}
                  />
                  {t.name}
                </label>
              ))}
            <button
              className="primary"
              onClick={() => {
                if (confirm("确认以上队伍的抽奖资格？"))
                  void game.cmd("confirmPrizes", { first, second });
              }}
            >
              记录并确认资格
            </button>
          </div>
        ) : (
          <>
            <div className="candidate-counts">
              {s.prizes?.prizes.map((p) => (
                <p key={p.name}>
                  <b>{p.name}</b> ·{" "}
                  {p.teams.map((id) => s.teams[id].name).join("、")}
                  <span>{p.players?.length || 0} 位候选员工</span>
                </p>
              ))}
            </div>
            <button
              className="primary"
              onClick={() =>
                void download(
                  s.code,
                  "export/prizes",
                  "lottery-candidates.csv",
                ).catch((e) => game.setError(e.message))
              }
            >
              导出抽奖候选名单 ↓
            </button>
          </>
        )}
      </section>
    </div>
  );
}
function BoardCalibration({
  game,
  state: s,
}: {
  game: GameConnection;
  state: GameState;
}) {
  const [positions, setPositions] = useState<Position[]>(s.positions),
    [message, setMessage] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过8MB");
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await request(
        `/api/rooms/${s.code}/background`,
        "POST",
        { content },
        s.code,
      );
      setMessage("原图已原样保存，请刷新大屏以立即显示。");
      location.reload();
    } catch (e) {
      game.setError((e as Error).message);
    }
  }
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>原始棋盘与坐标校准</h2>
            <p className="muted">
              拖动20个编号点。百分比坐标始终相对16:9图片容器，缩放时保持对齐。
            </p>
          </div>
          <label className="file-button">
            上传原始 JPG / PNG
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
        </div>
        <p className="notice">
          保留原图，不重绘棋盘。当前初始坐标来自你提供的20格参考表；请在原图导入后现场校准。
        </p>
        <div className="calibration-preview">
          <Board state={{ ...s, positions }} debug onPositions={setPositions} />
        </div>
        <div className="button-row">
          <button
            className="primary"
            onClick={() =>
              void game.cmd("savePositions", { positions }).then((ok) => {
                if (ok) setMessage("坐标已保存，其他页面将实时更新。");
              })
            }
          >
            保存并同步坐标
          </button>
          <button
            className="secondary"
            onClick={() =>
              void download(
                s.code,
                "export/positions",
                "tilePositions.json",
              ).catch((e) => game.setError(e.message))
            }
          >
            导出已保存配置 ↓
          </button>
          <label className="file-button">
            导入坐标 JSON
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void file
                    .text()
                    .then((text) => {
                      const parsed = JSON.parse(text);
                      return game.cmd("savePositions", { positions: parsed });
                    })
                    .catch((error) => game.setError(error.message));
              }}
            />
          </label>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
      <section className="panel">
        <h2>精确坐标</h2>
        <div className="coordinate-grid">
          {positions.map((p) => (
            <div key={p.id}>
              <b>{String(p.id).padStart(2, "0")}</b>
              {(["x", "y"] as const).map((axis) => (
                <label key={axis}>
                  {axis.toUpperCase()}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={Number(p[axis].toFixed(2))}
                    onChange={(e) =>
                      setPositions(
                        positions.map((v) =>
                          v.id === p.id
                            ? { ...v, [axis]: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
