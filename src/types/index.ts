export type TeamKey = 'east' | 'west' | 'central' | 'north' | 'shanghai'

export type CellType = 'start' | 'normal' | 'quiz' | 'challenge' | 'lucky' | 'end'

export interface BoardCell {
  id: number
  type: CellType
  x: number // 百分比
  y: number // 百分比
  label: string
  luckyEffect?: 'roll_again' | 'advance_2' | 'advance_3' | 'back_2'
}

export interface TeamState {
  name: string
  position: number
  bonusSteps: number
  locked: boolean
  correct: number
  answered: number
  members: number
}

export interface Representative {
  name: string
  years: string
  claimed: boolean
}

export interface Question {
  id: number
  type: 'normal' | 'challenge'
  reward: number
  question: string
  options: { A: string; B: string; C: string; D: string }
  answer: 'A' | 'B' | 'C' | 'D'
}

export interface GameState {
  status: string
  round: number
  totalRounds: number
  currentTeam: TeamKey
  turnIndex: number
  dice: { value: number; rolling: boolean; source: 'online' | 'physical' }
  diceSource: 'online' | 'physical'
  teams: Record<TeamKey, TeamState>
  representatives: Record<TeamKey, Representative>
  teamNames: Record<TeamKey, string>
  teamColors: Record<TeamKey, string>
  currentQuestion: Question | null
  votes: { A: number; B: number; C: number; D: number }
  quizTimerEndsAt: number
  revealAnswer: string
  luckyEffect: string | null
  lastEvent: { type: string; text: string; ts: number } | null
  questionStats: any[]
  rankings: any
  board: BoardCell[]
  totalCells: number
}
