import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { GameError } from "./engine.js";
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function equal(a, b) {
  const aa = Buffer.from(hash(String(a))),
    bb = Buffer.from(hash(String(b)));
  return timingSafeEqual(aa, bb);
}
export function authorize(s, role, credential, trustedPlayerId) {
  if (!s) throw new GameError("房间不存在", 404);
  if (role === "screen") return { role: "screen" };
  if (
    role === "host" &&
    typeof credential === "string" &&
    equal(s.hostHash, hash(credential))
  )
    return { role: "host" };
  if (role === "player" && typeof credential === "string") {
    const credentialHash = hash(credential);
    const candidates = trustedPlayerId
      ? [s.players[trustedPlayerId]]
      : Object.values(s.players);
    const player = candidates.find(
      (p) => p && !p.removed && equal(p.tokenHash, credentialHash),
    );
    if (player) return { role: "player", playerId: player.id };
  }
  throw new GameError("身份凭证无效，请重新进入房间或联系主持人", 401);
}
