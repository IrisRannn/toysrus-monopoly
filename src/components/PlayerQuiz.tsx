import { useEffect, useState } from "react";
import { useNow, type GameConnection } from "../hooks/useGame";
import { Countdown } from "./Common";
import type { GameState } from "../types";

export default function PlayerQuiz({ game, state: s, onSubmitted }: {
  game: GameConnection; state: GameState; onSubmitted?: () => void;
}) {
  const [choice, setChoice] = useState("");
  const now = useNow(game.offset);
  const quiz = s.quiz;
  useEffect(() => setChoice(quiz?.myAnswer || ""), [quiz?.id, quiz?.myAnswer]);
  if (!quiz || s.currentTeam !== s.me?.team) return null;
  const canAnswer = s.phase === "answering" && s.status === "running" && now < quiz.endsAt;
  return (
    <section className="mobile-card quiz-card">
      <div className="section-heading">
        <span className="eyebrow">
          全队一起答 · {quiz.submitted} / {quiz.eligible} 人
        </span>
        <Countdown state={s} offset={game.offset} />
      </div>
      <h2>{quiz.question.text}</h2>
      <div className="answer-options">
        {Object.entries(quiz.question.options).map(([key, text]) => (
          <button
            key={key}
            disabled={!canAnswer || game.pendingCommand === "answer"}
            className={choice === key ? "selected" : ""}
            onClick={() => setChoice(key)}
          >
            <b>{key}</b>
            <span>{text}</span>
            {choice === key && <span>✓</span>}
          </button>
        ))}
      </div>
      {canAnswer ? (
        <>
          <button
            className="primary wide"
            disabled={!choice || game.busy || !game.connected}
            onClick={async () => {
              if (await game.cmd("answer", { option: choice })) onSubmitted?.();
            }}
          >
            {game.pendingCommand === "answer"
              ? "正在提交…"
              : quiz.myAnswer
                ? "更新我的答案"
                : "提交答案"}
          </button>
          <p className="muted">
            {quiz.myAnswer
              ? `已提交 ${quiz.myAnswer}，截止前可修改。`
              : "每人仅保留一份有效答案，截止后锁定。"}
          </p>
        </>
      ) : (
        <p className="muted">
          {s.phase === "quiz_closed"
            ? "答案已锁定，等待主持人公布。"
            : s.status === "paused"
              ? "游戏暂停，暂不可提交。"
              : ""}
        </p>
      )}
      {quiz.result && (
        <div
          className={
            "quiz-result " + (quiz.result.correct ? "success" : "")
          }
        >
          <b>
            {quiz.result.correct
              ? "答对了，向前出发！"
              : "未答对，下一次再接再厉。"}
          </b>
          <p>
            正确答案 {quiz.result.correctAnswer} · 本队选择{" "}
            {quiz.result.majority || "无唯一最多选项"}
          </p>
          <p>{quiz.question.explanation}</p>
        </div>
      )}
    </section>
  );
}
