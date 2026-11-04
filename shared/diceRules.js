// Approved event distribution; fixed for all online teams and all positions.
export const ACTIVITY_DICE_WEIGHTS = Object.freeze([4, 4, 4, 4, 64, 20]);
export function dieFromTicket(ticket) {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= 100)
    throw new RangeError("Dice ticket must be an integer from 0 to 99");
  let boundary = 0;
  for (let index = 0; index < ACTIVITY_DICE_WEIGHTS.length; index++) {
    boundary += ACTIVITY_DICE_WEIGHTS[index];
    if (ticket < boundary) return index + 1;
  }
  throw new RangeError("Invalid dice distribution");
}
