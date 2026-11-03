import type { GameState } from "../types";

export default function EventSpotlight({ state, now }: { state: GameState; now: number }) {
  const effect = state.presentation;
  if (!effect || state.status === "finished") return null;
  const time = state.status === "paused" ? state.pausedAt ?? now : now;
  const remaining = Math.max(0, Math.min(1,
    (effect.endsAt - time) / (effect.endsAt - effect.startedAt),
  ));
  return (
    <div
      className={`special-event special-event-${effect.kind}`}
      data-kind={effect.kind}
      data-tile={effect.tile}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <section className="special-event-card" key={effect.id}>
        <div className="special-event-sparkles" aria-hidden="true">✦ ✧ ✦</div>
        <div className="special-event-team">
          {state.teams[effect.team].name} · {effect.kind === "correct" ? "挑战成功" : "特殊格事件"}
        </div>
        <div className="special-event-icon" aria-hidden="true">{effect.icon}</div>
        <h2>{effect.title}</h2>
        <strong className="special-event-action">{effect.effect}</strong>
        <p>
          {state.status === "paused"
            ? "游戏已暂停"
            : effect.kind === "quiz"
              ? "全队准备，一起迎接挑战！"
              : effect.kind === "finish"
                ? "恭喜完成这场童心之旅！"
                : "棋子即将移动"}
        </p>
        <div className="special-event-progress" aria-hidden="true">
          <span style={{ width: `${remaining * 100}%` }} />
        </div>
      </section>
    </div>
  );
}
