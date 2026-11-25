import { useEffect, useState } from "react";
import { useNow, type GameConnection } from "../hooks/useGame";
import { Countdown } from "./Common";
import type { GameState } from "../types";
import { votePercentage } from "../../shared/votePercentages.js";

export default function PlayerQuiz({ game, state: s, onSubmitted }: {
  game: GameConnection; state: GameState; onSubmitted?: () => void;
}) {
  const [choice, setChoice] = useState("");
  const now = useNow(game.offset);
  const quiz = s.quiz;
  useEffect(() => setChoice(quiz?.myAnswer || ""), [quiz?.ballotId, quiz?.myAnswer]);
  if (!quiz) return null;
  if (quiz.replacementPending) return (
    <section className="mobile-card quiz-card">
      <h2>平票换题</h2>
      <p>等待主持人补充新题并开始加赛，本题仍由{s.teams[s.currentTeam].name}作答。</p>
    </section>
  );
  const currentTeam = s.teams[s.currentTeam];
  const myTurn = s.currentTeam === s.me?.team;
  const canAnswer = myTurn && s.phase === "answering" && s.status === "running" && now < quiz.endsAt;
  return (
    <section className="mobile-card quiz-card">
      <div className="section-heading">
        <span className="eyebrow">
          记忆大考验 · {currentTeam.name}
        </span>
        <Countdown state={s} offset={game.offset} />
      </div>
      <h2>{quiz.question.text}</h2>
      {quiz.revote && <p className="quiz-revote"><b>平票换题</b> · 全新题目，四个选项重新作答；再次平票不前进。</p>}
      <p className="quiz-audience-note">
        {myTurn ? "轮到本队答题，截止前可以修改答案。" : `本题由${currentTeam.name}作答。`}
      </p>
      <div className="answer-options">
        {Object.entries(quiz.question.options).filter(([key]) => quiz.allowedOptions.includes(key)).map(([key, text]) => (
          <button
            key={key}
            disabled={!canAnswer || game.pendingCommand === "answer"}
            className={choice === key ? "selected" : ""}
            onClick={() => setChoice(key)}
          >
            <b>{key}</b>
            <span>{text}</span>
            <span className="option-votes" aria-label={`${key}选项${votePercentage(quiz.counts, key)}`}>
              {votePercentage(quiz.counts, key)}
            </span>
            {myTurn && choice === key && <span>✓</span>}
          </button>
        ))}
      </div>
      {canAnswer ? (
        <>
          <button
            className="primary wide"
            disabled={!choice || game.busy || !game.connected}
            onClick={async () => {
              if (await game.cmd("answer", { option: choice, ballotId: quiz.ballotId })) onSubmitted?.();
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
          {!myTurn
            ? `仅${currentTeam.name}玩家可以提交答案。`
            : s.phase === "quiz_closed"
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
              : quiz.result.tie
                ? "最高票并列，原地不动。"
              : "未答对，下一次再接再厉。"}
          </b>
          <p>
            正确答案 {quiz.result.correctAnswer} · 本队选择{" "}
            {quiz.result.majority || (quiz.result.tie ? "最高票并列" : "无人提交")}
          </p>
          <p>{quiz.question.explanation}</p>
        </div>
      )}
    </section>
  );
}
