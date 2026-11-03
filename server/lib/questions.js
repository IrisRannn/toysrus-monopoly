import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const QUESTION_BANK_VERSION = "20th-2026-11-03-v1";
export const BUILTIN_QUESTIONS = JSON.parse(
  readFileSync(new URL("../data/anniversary-questions.json", import.meta.url), "utf8"),
);

// Identity follows the question wording, regardless of row ID, tile or options.
// Re-importing or rearranging choices must not make a used question available.
export function questionKey(question) {
  const text = question.text
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .toLowerCase();
  return createHash("sha256").update(text).digest("hex");
}

export function usedQuestionKeys(state) {
  const usedIds = new Set(state.usedQuestions || []);
  return new Set([
    ...(state.usedQuestionKeys || []),
    ...state.questions.filter((q) => usedIds.has(q.id)).map(questionKey),
  ]);
}

export function availableQuestions(state, tile) {
  const used = usedQuestionKeys(state);
  return state.questions.filter(
    (q) => (q.tile === 0 || q.tile === tile) && !used.has(questionKey(q)),
  );
}
