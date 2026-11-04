export type TeamId = "east" | "central" | "north" | "west" | "shanghai";
export interface Team {
  id: TeamId;
  name: string;
  color: string;
  position: number;
  representativeId: string | null;
  representativeName: string | null;
  finishOrder: number | null;
  finishedAt: number | null;
  rank?: number;
  members: number;
  online: number;
}
export interface Tile {
  id: number;
  name: string;
  type: "normal" | "reward" | "penalty" | "quiz" | "finish";
  effect: number;
  icon: string;
}
export interface Position {
  id: number;
  x: number;
  y: number;
}
export interface Question {
  id: string;
  tile: number;
  text: string;
  options: Record<string, string>;
  answer?: string;
  explanation?: string;
}
export interface Employee {
  id: string;
  nickname: string;
  team: TeamId;
  joinedAt: number;
  removed: boolean;
  online: boolean;
}
export interface GameEvent {
  id: string;
  type: string;
  text: string;
  at: number;
  actor: string;
}
export interface Quiz {
  id: string;
  tile: number;
  question: Question;
  endsAt: number;
  submitted: number;
  eligible: number;
  myAnswer: string | null;
  counts?: Record<string, number>;
  answers?: Record<string, { option: string; at: number }>;
  result: null | {
    counts: Record<string, number>;
    submitted: number;
    majority: string | null;
    tie: boolean;
    correct: boolean;
    correctAnswer: string;
  };
}
export interface Prize {
  name: string;
  value: number;
  quantity: number;
  teams: TeamId[];
  players?: { id: string; nickname: string; team: TeamId }[];
}
export interface GameState {
  code: string;
  version: number;
  status: string;
  phase: string;
  round: number;
  turnId: number;
  currentTeam: TeamId;
  order: TeamId[];
  teams: Record<TeamId, Team>;
  dice: null | { value: number; source: string; at: number };
  diceProbabilities: number[];
  movement: null | {
    id?: string;
    team: TeamId;
    from: number;
    to: number;
    kind: string;
    startedAt: number;
    duration: number;
  };
  presentation: null | {
    id: string;
    team: TeamId;
    tile: number;
    kind: "reward" | "penalty" | "quiz" | "finish" | "correct";
    icon: string;
    title: string;
    effect: string;
    startedAt: number;
    endsAt: number;
  };
  lastTile: number | null;
  positions: Position[];
  settings: { answerSeconds: number; autoAdvance: boolean };
  audio: {
    effectsEnabled: boolean;
    effectsVolume: number;
    bgmEnabled: boolean;
    bgmVolume: number;
    bgm: null | { id: string; format: string; mimeType: string; size: number; fileName: string; url: string; source?: "builtin"; durationSeconds?: number };
  };
  autoNextAt: number | null;
  rankings: Team[];
  events: GameEvent[];
  serverTime: number;
  pausedAt: number | null;
  onlineCount: number;
  quiz: Quiz | null;
  me: Employee | null;
  players?: Employee[];
  questions?: Question[];
  usedQuestions?: string[];
  questionUsage?: {
    questionId: string;
    tile: number;
    team: TeamId;
    round: number;
    turnId: number;
    at: number;
  }[];
  canUndo?: boolean;
  undoLabel?: string;
  prizes?: { needsConfirmation: boolean; prizes: Prize[] };
}
