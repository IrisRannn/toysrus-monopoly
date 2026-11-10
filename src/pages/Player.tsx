import { useGame } from "../hooks/useGame";
import {
  Brand,
  Network,
  ErrorBar,
  RoomForm,
  Status,
} from "../components/Common";
import { phaseNames, tileName } from "../config";
import Dice from "../components/Dice";
import PlayerQuiz from "../components/PlayerQuiz";
import { PREVIEW_ROOM_CODE } from "../../shared/siteSettings.js";
export default function Player() {
  const game = useGame("player"),
    { state: s } = game;
  if (!game.room || !game.credential) return <RoomForm role="player" />;
  if (!s)
    return (
      <main className="entry">
        <section className="entry-card">
          <Brand />
          <h2>正在连接房间 {game.room}</h2>
          <ErrorBar game={game} />
          <button onClick={game.logout}>重新加入</button>
        </section>
      </main>
    );
  const me = s.me!,
    team = s.teams[me.team],
    myTurn = s.currentTeam === me.team,
    representative = team.representativeId === me.id,
    canRoll =
      myTurn &&
      s.phase === "awaiting_dice" &&
      s.status === "running" &&
      representative &&
      me.team !== "shanghai";
  return (
    <main
      className="player-app"
      style={{ "--team-color": team.color } as React.CSSProperties}
    >
      <header className="mobile-header">
        <Brand small />
        <Network connected={game.connected} />
      </header>
      <ErrorBar game={game} />
      <section className="player-hero">
        <div className="eyebrow">
          房间 {s.code} · 第 {s.round} 轮
        </div>
        <h1>
          {team.name}
          <span>你好，{me.nickname}</span>
        </h1>
        <div className="player-progress">
          <strong>{String(team.position).padStart(2, "0")}</strong>
          <span>
            / 20 格<br />
            {tileName(team.position)}
          </span>
          <i>{team.finishOrder ? "🏁" : "✦"}</i>
        </div>
        <div className="progress-track">
          <span style={{ width: team.position * 5 + "%" }} />
        </div>
        <p>
          {team.members} 位队友 · {team.online} 人在线
        </p>
      </section>
      <section className="mobile-card">
        <Status state={s} />
        <h2>
          {s.status === "finished"
            ? "本场旅程已完成"
            : s.status === "paused"
              ? "稍作休息，童心继续"
              : myTurn
                ? "轮到我们向前！"
                : `${s.teams[s.currentTeam].name} 正在行动`}
        </h2>
        <p className="muted">
          {team.finishOrder
            ? `已获得第${team.finishOrder}名，继续为大家加油！`
            : s.autoNextAt
              ? "本队回合完成，即将自动切换下一队"
              : phaseNames[s.phase]}
        </p>
        {s.status === "running" &&
          myTurn &&
          s.phase === "awaiting_dice" &&
          !team.finishOrder && (
            <>
              {me.team === "shanghai" ? (
                <div className="physical-note">
                  <span>🎲</span>
                  <b>请在现场投掷实体骰子</b>
                  <p>由主持人录入点数，棋子随后自动移动。</p>
                </div>
              ) : (
                <>
                  {!team.representativeId && !s.settings.hostOnlyRepresentatives ? (
                    <button
                      className="primary wide"
                      disabled={game.busy || !game.connected}
                      onClick={() => void game.cmd("claimRepresentative")}
                    >
                      {game.pendingCommand === "claimRepresentative"
                        ? "正在申请…"
                        : "成为本回合投骰代表"}
                    </button>
                  ) : (
                    <p>
                      本回合代表：<b>{team.representativeName || `等待${team.name}产生代表`}</b>
                      {representative ? "（你）" : ""}
                    </p>
                  )}
                  {canRoll && (
                    <button
                      className="primary wide roll-button"
                      disabled={game.busy || !game.connected}
                      onClick={() => void game.cmd("roll")}
                    >
                      {game.pendingCommand === "roll"
                        ? "正在投骰…"
                        : "🎲 投骰子"}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        {myTurn && s.dice && (
          <div className="player-dice">
            <Dice
              value={s.dice.value}
              rolling={s.phase === "rolling" && s.status === "running"}
            />
            <p>
              {s.dice.source === "physical" ? "主持人录入实体骰子" : "本队骰子"}{" "}
              · {s.dice.value} 点
            </p>
          </div>
        )}
        {me.team !== "shanghai" && (
          <details className="dice-rules">
            <summary>活动骰子规则</summary>
            <p>本活动提高大点数概率，各线上队伍规则相同。</p>
            <p>{s.diceProbabilities.map((chance, index) => `${index + 1}点 ${chance}%`).join(" · ")}</p>
          </details>
        )}
      </section>
      <PlayerQuiz game={game} state={s} />
      <section className="mobile-card">
        <div className="eyebrow">刚刚发生</div>
        {s.events
          .slice(-3)
          .reverse()
          .map((e) => (
            <p key={e.id}>{e.text}</p>
          ))}
      </section>
      <footer className="mobile-footer">
        <span>房间 {s.code}</span>
        {s.code === PREVIEW_ROOM_CODE && <a href={`/player?room=${PREVIEW_ROOM_CODE}`}>返回棋盘界面</a>}
        <button className="text-button" onClick={game.logout}>
          退出当前会话
        </button>
      </footer>
    </main>
  );
}
