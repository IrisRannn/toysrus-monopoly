import { useEffect, useRef, useState } from "react";
import { useGame, useNow } from "../hooks/useGame";
import { Brand, ErrorBar, Network, RoomForm } from "../components/Common";
import { phaseNames } from "../config";
import Board from "../components/Board";
import EventSpotlight from "../components/EventSpotlight";
import StageDice, { stageDiceVisible } from "../components/StageDice";
import PlayerQuiz from "../components/PlayerQuiz";
import ScreenAudio from "../components/ScreenAudio";

export default function PlayerPreview() {
  const game = useGame("player");
  const s = game.state;
  const now = useNow(game.offset);
  const stage = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissed, setDismissed] = useState("");
  const [fullscreenError, setFullscreenError] = useState("");
  const myTurn = !!s && s.currentTeam === s.me?.team;
  const quiz = s?.quiz;
  const quizKey = quiz ? `${quiz.id}:${quiz.result ? "result" : "answer"}` : "";
  const showQuiz = !!quizKey && dismissed !== quizKey && !s?.presentation &&
    ["answering", "quiz_closed", "revealed", "turn_complete"].includes(s?.phase || "");
  useEffect(() => {
    if (!quiz) setDismissed("");
  }, [quiz?.id]);
  useEffect(() => {
    const element = dialog.current;
    if (showQuiz && element && !element.open) element.showModal();
    else if (!showQuiz && element?.open) element.close();
  }, [showQuiz]);

  if (!game.room || !game.credential) return <RoomForm role="player" />;
  if (!s || !s.me) return (
    <main className="entry"><section className="entry-card">
      <Brand /><h2>正在连接年会棋盘</h2><ErrorBar game={game} />
      <button onClick={game.logout}>重新加入</button>
    </section></main>
  );
  const me = s.me;
  const team = s.teams[me.team];
  const current = s.teams[s.currentTeam];
  const canRoll = myTurn && team.representativeId === me.id && me.team !== "shanghai" &&
    s.status === "running" && s.phase === "awaiting_dice" && !team.finishOrder;
  const status = s.status === "waiting" ? "等待主持人开场"
    : s.status === "paused" ? "游戏已暂停"
      : s.status === "finished" ? "游戏已结束"
        : s.autoNextAt ? "即将切换下一队"
          : s.phase === "awaiting_dice" ? current.id === "shanghai" ? "现场投骰 · 主持人录入"
            : current.representativeName ? `等待${current.representativeName}投骰` : `等待${current.name}产生代表`
            : phaseNames[s.phase];
  const dismissQuiz = () => setDismissed(quizKey);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
      setFullscreenError("");
    } catch { setFullscreenError("当前浏览器未开启全屏，可继续横屏游玩"); }
  }
  return (
    <main ref={stage} className="player-experience" style={{ "--team-color": team.color } as React.CSSProperties}>
      <div className="experience-portrait-hint">↻ 横屏看棋盘更清楚，答题时所有人都能观看题目与实时进度</div>
      <section className="experience-board-area" aria-label="实时游戏棋盘">
        <div className="experience-board">
          <Board state={s} offset={game.offset} />
          {stageDiceVisible(s, now) && <StageDice state={s} />}
          <EventSpotlight state={s} now={now} />
          {s.status === "finished" && <div className="experience-finish">童心之旅圆满结束 · 恭喜{s.rankings[0]?.name}</div>}
        </div>
      </section>
      <aside className="experience-rail">
        <header className="experience-header">
          <span className="experience-badge">20周年 · 全员大富翁</span>
          <span className="experience-room">房间 {s.code}</span>
          <Network connected={game.connected} />
          {document.fullscreenEnabled && <button className="experience-fullscreen" onClick={() => void fullscreen()} aria-label="切换全屏">⛶</button>}
        </header>
        <div className="experience-identity"><b>{team.name}</b><span>{me.nickname}</span></div>
        <div className="experience-turn" aria-live="polite"><span>第{s.round}轮 · 当前行动</span><strong>{current.name}</strong><p>{status}</p></div>
        <ol className="experience-progress" aria-label="五队实时进度">
          {s.order.map((id) => {
            const t = s.teams[id];
            return <li key={id} className={id === me.team ? "my-team" : ""} style={{ "--progress-color": t.color } as React.CSSProperties}>
              <div><span><i />{t.name}</span><b>{t.finishOrder ? `第${t.finishOrder}名` : `${t.position}/20`}</b></div>
              <div className="experience-progress-track"><span style={{ width: `${t.position * 5}%` }} /></div>
            </li>;
          })}
        </ol>
        <div className="experience-actions">
          <ErrorBar game={game} />
          {canRoll && <>
            <p className="experience-representative">你是本队投骰代表</p>
            <button className="primary experience-roll" disabled={game.busy || !game.connected} onClick={() => void game.cmd("roll")}>
              {game.pendingCommand === "roll" ? "正在投骰…" : "🎲 投骰子"}
            </button>
          </>}
          {quiz && !s.presentation && s.phase !== "moving" && <button className="primary experience-answer" onClick={() => setDismissed("")}>
            {quiz.result ? "查看答题结果" : !myTurn ? "查看题目与实时进度" : quiz.myAnswer ? `已提交 ${quiz.myAnswer} · ${s.phase === "answering" && s.status === "running" && now < quiz.endsAt ? "修改答案" : "查看作答"}` : "参与本队答题"}
          </button>}
          {quiz && <p className="experience-quiz-progress">{current.name} · {quiz.submitted} / {quiz.eligible} 人已提交</p>}
          {!canRoll && !quiz && <p className="experience-waiting">{myTurn && me.team === "shanghai" ? "请在现场投掷实体骰子" : "观看棋盘 · 记忆大考验全员可见"}</p>}
          {fullscreenError && <p className="experience-waiting">{fullscreenError}</p>}
        </div>
        <ScreenAudio state={s} offset={game.offset} surface="player" />
        <footer className="experience-footer"><span>{s.onlineCount}人在线</span><a href={`/player-classic?room=${s.code}`}>简洁界面 ↗</a></footer>
      </aside>
      <dialog ref={dialog} className="experience-quiz-dialog" aria-label="记忆大考验窗口" onCancel={dismissQuiz}>
        <header><b>{current.name} · 记忆大考验</b><button aria-label="关闭答题窗口" onClick={dismissQuiz}>×</button></header>
        <PlayerQuiz game={game} state={s} />
        <button className="experience-return" onClick={dismissQuiz}>返回棋盘</button>
      </dialog>
    </main>
  );
}
