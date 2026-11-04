import { TILES, clampPosition } from "../shared/gameRules.js";
import { dieFromTicket, ACTIVITY_DICE_WEIGHTS } from "../shared/diceRules.js";
const games = Number(process.env.SIMULATION_GAMES || 50000);
const accuracy = Number(process.env.SIMULATION_ACCURACY || 0.8);
if (!Number.isInteger(games) || games < 1 || games > 1000000 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1)
  throw Error("Use 1–1000000 games and an answer accuracy between0 and1");
function simulate(weighted, racer) {
  let seed = 20261104;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let totalRounds = 0, totalTurns = 0, memories = 0, quizzes = 0, by3 = 0, by5 = 0, timedOut = 0;
  for (let game = 0; game < games; game++) {
    const positions = [0, 0, 0, 0, 0];
    let round = 0;
    while (positions.some((p) => p < 20) && round < 100) {
      round++;
      for (let team = 0; team < 5; team++) {
        if (positions[team] === 20) continue;
        totalTurns++;
        const value = weighted && team < 4 ? dieFromTicket(Math.floor(random() * 100)) : Math.floor(random() * 6) + 1;
        let position = clampPosition(positions[team] + value);
        const tile = TILES[position - 1];
        if (tile.type === "quiz") {
          quizzes++;
          memories += tile.id !== 15 ? 1 : 0;
          if (random() < accuracy) position = tile.id === 15 ? 20 : clampPosition(position + tile.effect);
        } else if (tile.type === "reward" || tile.type === "penalty")
          position = clampPosition(position + (tile.id === 2 ? racer : tile.effect));
        positions[team] = position;
      }
    }
    totalRounds += round;
    if (positions.some((p) => p < 20)) timedOut++;
    else { by3 += round <= 3 ? 1 : 0; by5 += round <= 5 ? 1 : 0; }
  }
  const fixed = (n) => Number(n.toFixed(3));
  return {
    meanRounds: fixed(totalRounds / games), allFinishBy3Percent: fixed(by3 / games * 100),
    allFinishBy5Percent: fixed(by5 / games * 100), memoryEventsPerGame: fixed(memories / games),
    memoryEventsPerRollPercent: fixed(memories / totalTurns * 100), totalQuizzesPerGame: fixed(quizzes / games), timedOut,
  };
}
console.log(JSON.stringify({
  games, answerAccuracy: accuracy, onlineDiceWeights: ACTIVITY_DICE_WEIGHTS, shanghaiDice: "uniform physical-dice model",
  assumptions: "Independent dice and team answer outcomes; no chained events; memory excludes tile15; unlimited question supply; no hard round limit. This is gameplay simulation, not a network or capacity test.",
  originalRules: simulate(false, 2), racerOnly: simulate(false, 5), approvedRules: simulate(true, 5),
}, null, 2));
