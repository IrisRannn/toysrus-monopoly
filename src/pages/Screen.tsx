import { useGame, useNow } from "../hooks/useGame";
import {
  Brand,
  Network,
  RoomForm,
  ErrorBar,
  Ranking,
  Countdown,
} from "../components/Common";
import { phaseNames, TILES } from "../config";
import Board from "../components/Board";
import StageDice, { stageDiceVisible } from "../components/StageDice";
import { playerEntryPath } from "../../shared/siteSettings.js";
import EventSpotlight from "../components/EventSpotlight";
import ScreenAudio from "../components/ScreenAudio";
import AnniversaryCelebration from "../components/AnniversaryCelebration";
import { votePercentage } from "../../shared/votePercentages.js";
export default function Screen() {
  const game = useGame("screen"),
    { state: s } = game,
    now = useNow(game.offset);
  if (!game.room) return <RoomForm role="screen" />;
  if (!s)
    return (
      <main className="entry">
        <section className="entry-card">
          <Brand />
          <h2>正在连接房间 {game.room}</h2>
          <ErrorBar game={game} />
          <a href="/screen?room=">选择房间</a>
        </section>
      </main>
    );
  const team = s.teams[s.currentTeam],
    quiz = s.quiz,
    showQuiz =
      quiz &&
      !["champion", "finished"].includes(s.status) &&
      !s.presentation &&
      (["answering", "quiz_closed", "revealed"].includes(s.phase) ||
        (s.phase === "turn_complete" && !!quiz.result)),
    latest = s.events[s.events.length - 1],
    tile = TILES.find((t) => t.id === s.lastTile),
    showDice = stageDiceVisible(s, now);
  return (
    <main className="screen-app">
      <div className="screen-stage">
        <Board state={s} offset={game.offset} />
        <header className="screen-header">
          <Brand small />
          <div>
            <span className="eyebrow">全员一起玩 · 第 {s.round} 轮</span>
            <Network connected={game.connected} />
          </div>
          <div className="screen-room">
            ROOM <b>{s.code}</b>
          </div>
        </header>
        <ScreenAudio state={s} offset={game.offset} />
        <div
          className={"screen-focus" + (showDice ? " dice-active" : "")}
          style={{ "--team-color": team.color } as React.CSSProperties}
        >
          <div className="eyebrow">
            {s.status === "paused"
              ? "现场暂停"
              : s.status === "waiting"
                ? "童心集结中"
                : "当前行动队伍"}
          </div>
          <h1>{team.name}</h1>
          <p>
            {s.status === "waiting"
              ? "扫码加入队伍，等待主持人开场"
              : s.autoNextAt
                ? "本队回合完成，即将自动切换下一队"
                : phaseNames[s.phase]}
          </p>
          {tile && (
            <div className="landing-caption">
              {tile.icon} {tile.name}
            </div>
          )}
        </div>
        {showDice && <StageDice state={s} />}
        <aside className="screen-ranking">
          <div className="eyebrow">实时进度 · 先冲线者领先</div>
          <Ranking state={s} />
        </aside>
        <div className="screen-footer">
          <span>
            手机加入 <b>{location.host}{playerEntryPath(s.code)}</b> · 输入房间号 <b>{s.code}</b>
          </span>
          <span>{s.onlineCount} 人在线</span>
        </div>
        {latest && now - latest.at < 6000 && !showQuiz && !s.presentation && !showDice && (
          <div
            key={latest.id}
            className={"event-toast event-" + latest.type + " tile-" + tile?.id}
          >
            <span>{tile?.icon || "✦"}</span>
            <p>{latest.text}</p>
          </div>
        )}
        {showQuiz && (
          <div className="screen-quiz">
            <div className="quiz-stage">
              <div className="section-heading">
                <span className="eyebrow">{team.name} · 全队答题</span>
                <Countdown state={s} offset={game.offset} />
              </div>
              <h2>{quiz.question.text}</h2>
              {quiz.revote && <p className="quiz-revote"><b>平票加投</b> · 仅{quiz.allowedOptions.join("、")}选项</p>}
              <div className="screen-options">
                {Object.entries(quiz.question.options).filter(([key]) => quiz.allowedOptions.includes(key)).map(([key, text]) => (
                  <div
                    className={
                      quiz.result?.correctAnswer === key ? "correct" : ""
                    }
                    key={key}
                  >
                    <b>{key}</b>
                    {text}
                    <small>{votePercentage(quiz.counts, key)}</small>
                  </div>
                ))}
              </div>
              <div className="quiz-stage-bottom">
                {quiz.result ? (
                  <>
                    <strong>
                      {quiz.result.tiedAccepted ? "加投仍平票，按答对奖励！" : quiz.result.correct
                        ? "回答正确！"
                        : quiz.result.tie
                          ? "最高票并列"
                          : quiz.result.submitted === 0
                            ? "无人提交，未答对"
                            : "未答对"}
                    </strong>
                    <span>
                      本队选择 {quiz.result.majority || (quiz.result.tie ? "加投最高票并列" : "—")} · 正确答案{" "}
                      {quiz.result.correctAnswer}
                    </span>
                    <p>
                      {quiz.result.correct
                        ? quiz.tile === 15
                          ? "终极挑战答对，直达20号终点！"
                          : "答对，按格子规则前进3格。"
                        : "未答对，本队棋子保持原位。"}{" "}
                      当前棋子位置：{team.position} / 20
                    </p>
                    <p>{quiz.question.explanation}</p>
                  </>
                ) : (
                  <>
                    <span>
                      {s.phase === "quiz_closed"
                        ? "等待主持人公布答案"
                        : `本题由${team.name}作答`}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        <EventSpotlight state={s} now={now} />
        <AnniversaryCelebration state={s} />
      </div>
    </main>
  );
}
