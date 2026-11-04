import Dice from "./Dice";
import type { GameState } from "../types";

export function stageDiceVisible(s: GameState, now: number) {
  return !!(s.dice && !s.presentation && !s.quiz && s.status !== "finished" &&
    (s.phase === "rolling" || (s.phase === "moving" && s.movement?.kind === "dice" && now < s.movement.startedAt + 1100)));
}
export default function StageDice({ state: s }: { state: GameState }) {
  if (!s.dice) return null;
  return (
    <div className="screen-dice" data-rolling={s.phase === "rolling"}>
      <div className="screen-dice-content">
        <div className="screen-dice-label">{s.teams[s.currentTeam].name} · {s.phase === "rolling" ? "正在投骰" : "投骰结果"}</div>
        <Dice value={s.dice.value} rolling={s.phase === "rolling" && s.status === "running"} />
        <strong aria-live="polite">
          {s.phase === "rolling" ? "好运转起来！" : <>{s.dice.value}<small>点</small></>}
        </strong>
      </div>
    </div>
  );
}
