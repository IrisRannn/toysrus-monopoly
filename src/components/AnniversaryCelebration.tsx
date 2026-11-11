import type { CSSProperties } from "react";
import type { GameState } from "../types";
import "../celebration.css";

export default function AnniversaryCelebration({ state: s }: { state: GameState }) {
  const final = s.status === "finished";
  if (!final && s.status !== "champion") return null;
  const winner = s.victory ? s.teams[s.victory.team] : s.rankings.find((team) => team.finishOrder === 1);
  const slots = [3, 1, 0, 2, 4].map((index) => s.rankings[index]).filter(Boolean);
  const rankLabel = (rank: number) => `${s.rankings.filter((team) => team.rank === rank).length > 1 ? "并列" : ""}第${rank}名`;
  return <section className={`anniversary-celebration ${final ? "ceremony-final" : "ceremony-victory"}`}
    aria-label={final ? "20周年荣耀颁奖台" : "冠军庆祝"}>
    <div className="ceremony-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) =>
      <i key={i} style={{ "--i": i, "--paper": ["#0f4dbc", "#69be28", "#ff6e00", "#f01450", "#ffc940"][i % 5] } as CSSProperties} />)}</div>
    <header className="ceremony-heading">
      <span className="ceremony-anniversary">20年童心不改 · 反斗精彩继续</span>
      <h1>{final ? "20周年荣耀榜" : "冠军诞生啦！"}</h1>
      <p>{final ? "每一支队伍，都值得掌声！" : "这一刻，为你们欢呼！"}</p>
    </header>
    {final ? <>
      <div className="ceremony-awards">
        <div className="ceremony-presenter">
          <span className="geoffrey-bubble">荣耀时刻到啦！</span>
          <img src="/assets/geoffrey/presenter.png" alt="杰菲伸手为五支队伍颁奖" width="816" height="1600" />
        </div>
        <div className="podium-stage" aria-label="五队最终排名">
          {slots.map((team) => <article key={team.id} className={`podium-entry ${team.id === s.me?.team ? "podium-mine" : ""}`}
            style={{ "--team": team.color, "--podium-ink": ["central", "north"].includes(team.id) ? "#3d2b12" : "#fff", "--podium-height": `${60 - ((team.rank || 1) - 1) * 9}%` } as CSSProperties}
            aria-label={`${team.name}，${rankLabel(team.rank || 1)}`}>
            <div className="podium-team"><span aria-hidden="true">{team.rank === 1 ? "👑" : "⭐"}</span><strong>{team.name}</strong>
              <small>{team.finishOrder ? "率先冲线" : `停在第${team.position}格`}</small>
            </div>
            <div className="podium-gift"><b>{rankLabel(team.rank || 1)}</b>
              <span title="可参与的抽奖奖项">{s.prizes?.needsConfirmation && (team.rank || 1) > 1 ? "资格待确认" : team.rank === 1 ? "一、二、三等奖" : (team.rank || 1) <= 3 ? "二、三等奖" : "三等奖"}</span>
            </div>
          </article>)}
        </div>
      </div>
      <div className="ceremony-prizes" aria-label="抽奖奖项与名额">
        <div><b>一等奖</b><strong>¥500 <em>× 1名</em></strong><span>冠军队伍参与抽奖</span></div>
        <div><b>二等奖</b><strong>¥300 <em>× 3名</em></strong><span>前三名队伍共享名额</span></div>
        <div><b>三等奖</b><strong>¥120 <em>× 5名</em></strong><span>全体员工参与抽奖</span></div>
      </div>
      {s.prizes?.needsConfirmation && <p className="ceremony-tie-note">存在并列排名，相关队伍的抽奖资格等待主持人确认。</p>}
    </> : <div className="victory-moment" role="status">
      <img className="geoffrey-cheer" src="/assets/geoffrey/cheer.png" alt="杰菲张开双臂庆祝冠军" width="816" height="1600" />
      <div className="victory-team" style={{ "--team": winner?.color || "#c92830" } as CSSProperties}>
        <span className="victory-crown" aria-hidden="true">🏆</span>
        <span className="victory-ribbon">20周年童心冠军</span>
        <h2>{winner?.name}</h2><p>率先抵达荣耀殿堂！</p>
        <small>等待主持人揭晓最终荣耀榜</small>
      </div>
    </div>}
  </section>;
}
