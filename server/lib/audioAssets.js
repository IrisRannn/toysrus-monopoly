import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { GameError } from "./engine.js";
export const MAX_BGM_BYTES = 20 * 1024 * 1024;
const types = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" };
export function audioFormat(bytes) {
  if (bytes.length < 12) return null;
  if (bytes.toString("ascii", 0, 3) === "ID3" ||
      (bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 6) !== 0)) return "mp3";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (bytes.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (bytes.toString("ascii", 4, 8) === "ftyp") return "m4a";
  return null;
}
export async function saveBgm(directory, room, bytes, name) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BGM_BYTES)
    throw new GameError("请上传20MB以内的背景音乐");
  const format = audioFormat(bytes);
  if (!format) throw new GameError("只支持MP3、WAV、OGG或M4A音频文件");
  const id = createHash("sha256").update(bytes).digest("hex");
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `bgm-${id}.${format}`);
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return {
    id, format, mimeType: types[format], size: bytes.length,
    fileName: String(name || `背景音乐.${format}`).replace(/[\r\n]/g, "").slice(0, 160),
    url: `/api/rooms/${room}/bgm/${id}`,
  };
}
export function bgmPath(directory, bgm) {
  if (!bgm || !/^[a-f0-9]{64}$/.test(bgm.id) || !Object.hasOwn(types, bgm.format))
    throw new GameError("背景音乐不存在", 404);
  return path.join(directory, `bgm-${bgm.id}.${bgm.format}`);
}
