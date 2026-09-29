import { GameState, TeamKey } from '../types'

const teamColors: Record<TeamKey, string> = {
  red: '#e03131',
  blue: '#1971c2',
  yellow: '#f08c00',
  green: '#2b8a3e',
}
const teamLetter: Record<TeamKey, string> = { red: '红', blue: '蓝', yellow: '黄', green: '绿' }

// 棋盘 = board.png 底图 + 棋子/特效作为覆盖层
export default function Board({ state }: { state: GameState }) {
  const order: TeamKey[] = ['red', 'blue', 'yellow', 'green']
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: "url('/board.png')",
      backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
    }}>
      {/* 棋子 */}
      {order.map((t) => {
        const cell = state.board[state.teams[t].position]
        if (!cell) return null
        // 同一格多枚棋子时轻微错位，避免完全重叠
        const idx = order.indexOf(t)
        const dx = (idx - 1.5) * 1.6
        return (
          <div
            key={t}
            className={`piece piece-${t}`}
            style={{
              left: `calc(${cell.x}% + ${dx}%)`,
              top: `${cell.y}%`,
              zIndex: 20 + idx,
            }}
          >
            {teamLetter[t]}
            <span className="dot">{t === 'red' ? 'R' : t === 'blue' ? 'B' : t === 'yellow' ? 'Y' : 'G'}</span>
          </div>
        )
      })}
    </div>
  )
}
