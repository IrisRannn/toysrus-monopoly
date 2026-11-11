import { TEAM_ORDER, TEAM_INFO, TILES as tiles } from "../shared/gameRules.js";
import type { TeamId, Tile } from "./types";
export const order = TEAM_ORDER as TeamId[];
export const teamInfo = TEAM_INFO;
export const TILES = tiles as Tile[];
export const phaseNames: Record<string, string> = {
  awaiting_dice: "等待投骰",
  rolling: "骰子滚动中",
  moving: "棋子移动中",
  tile_event: "特殊格特效展示中",
  quiz_ready: "等待主持人开启答题",
  answering: "全队答题中",
  quiz_closed: "答题结束 · 等待公布",
  revealed: "答案揭晓",
  turn_complete: "本队回合完成",
};
export const statusNames: Record<string, string> = {
  champion: "冠军已产生 · 等待颁奖",
  waiting: "等待开场",
  running: "游戏进行中",
  paused: "游戏已暂停",
  finished: "游戏已结束",
};
export const tileName = (id: number) =>
  id === 0 ? "棋盘外起点" : TILES.find((t) => t.id === id)?.name;
