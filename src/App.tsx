import Host from "./pages/Host";
import Player from "./pages/Player";
import PlayerPreview from "./pages/PlayerPreview";
import Screen from "./pages/Screen";
import { Brand } from "./components/Common";
import "./preview.css";
export default function App() {
  const route = location.pathname;
  if (route.startsWith("/host")) return <Host />;
  if (route === "/player-preview") return <PlayerPreview />;
  if (route.startsWith("/player") || route === "/m") return <Player />;
  if (route.startsWith("/screen")) return <Screen />;
  return (
    <main className="entry">
      <div className="entry-glow" />
      <section className="landing-card">
        <Brand />
        <div className="eyebrow">20年童心不改 · 反斗精彩继续</div>
        <h1>
          一起玩，
          <br />
          <em>一起向前。</em>
        </h1>
        <p>五支队伍，一场属于所有人的周年冒险。</p>
        <div className="portal-grid">
          <a href="/player">
            <span>↗</span>
            <strong>我是玩家</strong>
            <small>加入队伍 · 投骰答题</small>
          </a>
          <a href="/screen">
            <span>✦</span>
            <strong>游戏大屏</strong>
            <small>实时棋盘 · 见证冲线</small>
          </a>
          <a href="/host">
            <span>⌘</span>
            <strong>主持人控制台</strong>
            <small>掌控节奏 · 连接全场</small>
          </a>
        </div>
        <footer>20格趣味棋盘 · 无限轮次 · 谁先冲线谁领先</footer>
      </section>
    </main>
  );
}
