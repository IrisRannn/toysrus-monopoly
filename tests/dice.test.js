import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_DICE_WEIGHTS, dieFromTicket } from "../shared/diceRules.js";
import { newRoom, command, publicState, tick } from "../server/lib/engine.js";
test("100 crypto tickets map to the approved 4/4/4/4/64/20 distribution", () => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let ticket = 0; ticket < 100; ticket++) counts[dieFromTicket(ticket) - 1]++;
  assert.deepEqual(counts, [4, 4, 4, 4, 64, 20]);
  assert.deepEqual(ACTIVITY_DICE_WEIGHTS, counts);
  assert(counts[0] + counts[1] < 10);
  for (const bad of [-1, 100, 0.5, NaN, Infinity]) assert.throws(() => dieFromTicket(bad), RangeError);
});
test("Shanghai physical dice stay literal, movement is slower and probabilities are visible to all roles", () => {
  const s = newRoom("123456", "host");
  s.currentTeam = "shanghai";
  command(s, { role: "host" }, "start", {}, 1000);
  command(s, { role: "host" }, "physicalDice", { value: 1 }, 1000);
  assert.equal(s.dice.value, 1);
  tick(s, s.transitionAt);
  assert.equal(s.movement.duration, 900);
  assert(s.movement.id);
  for (const role of ["host", "screen"])
    assert.deepEqual(publicState(s, { role }).diceProbabilities, [4, 4, 4, 4, 64, 20]);
});
