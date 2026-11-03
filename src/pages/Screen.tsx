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
import Dice from "../components/Dice";
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
      (["answering", "quiz_closed", "revealed"].includes(s.phase) ||
        !!quiz.result),
    latest = s.events[s.events.length - 1],
    tile = TILES.find((t) => t.id === s.lastTile);
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
        <div
          className="screen-focus"
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
          {s.dice && (
            <div className="screen-dice">
              <Dice
                value={s.dice.value}
                rolling={s.phase === "rolling" && s.status === "running"}
              />
              <strong>
                {s.dice.value}
                <small>点</small>
              </strong>
            </div>
          )}
          {tile && (
            <div className="landing-caption">
              {tile.icon} {tile.name}
            </div>
          )}
        </div>
        <aside className="screen-ranking">
          <div className="eyebrow">实时进度 · 先冲线者领先</div>
          <Ranking state={s} />
        </aside>
        <div className="screen-footer">
          <span>
            手机加入 <b>{location.host}/player</b> · 输入房间号 <b>{s.code}</b>
          </span>
          <span>{s.onlineCount} 人在线</span>
        </div>
        {latest && now - latest.at < 6000 && !showQuiz && (
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
              <div className="screen-options">
                {Object.entries(quiz.question.options).map(([key, text]) => (
                  <div
                    className={
                      quiz.result?.correctAnswer === key ? "correct" : ""
                    }
                    key={key}
                  >
                    <b>{key}</b>
                    {text}
                    {quiz.result && <small>{quiz.result.counts[key]}票</small>}
                  </div>
                ))}
              </div>
              <div className="quiz-stage-bottom">
                {quiz.result ? (
                  <>
                    <strong>
                      {quiz.result.correct
                        ? "回答正确！"
                        : quiz.result.tie
                          ? "最高票并列，未答对"
                          : quiz.result.submitted === 0
                            ? "无人提交，未答对"
                            : "未答对"}
                    </strong>
                    <span>
                      本队选择 {quiz.result.majority || "—"} · 正确答案{" "}
                      {quiz.result.correctAnswer}
                    </span>
                    <p>
                      {quiz.result.correct
                        ? quiz.question.tile === 15
                          ? "终极挑战答对，直达20号终点！"
                          : "答对，按格子规则前进3格。"
                        : "未答对，本队棋子保持原位。"}{" "}
                      当前棋子位置：{team.position} / 20
                    </p>
                    <p>{quiz.question.explanation}</p>
                  </>
                ) : (
                  <>
                    <b>
                      {quiz.submitted} / {quiz.eligible} 人已提交
                    </b>
                    <span>
                      {s.phase === "quiz_closed"
                        ? "等待主持人公布答案"
                        : "拿起手机，为队伍做出选择"}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {s.status === "finished" && (
          <div className="finish-overlay">
            <div className="confetti" />
            <section>
              <div className="eyebrow">20年童心不改，反斗精彩继续</div>
              <h1>每一步，都精彩。</h1>
              <Ranking state={s} />
              <div className="prize-ranges">
                <span>一等奖 ¥500 × 1 · 第1名队伍</span>
                <span>二等奖 ¥300 × 2 · 前3名队伍</span>
                <span>三等奖 ¥120 × 5 · 全体员工</span>
              </div>
              {s.prizes?.needsConfirmation && (
                <p>存在并列排名，抽奖资格等待主持人确认。</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
