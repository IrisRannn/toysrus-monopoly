import { randomInt } from "node:crypto";
import { dieFromTicket } from "../../shared/diceRules.js";
export const rollActivityDie = () => dieFromTicket(randomInt(100));
