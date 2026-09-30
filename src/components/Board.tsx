import { GameState, TeamKey } from '../types'

// 5队棋子：队伍名直接显示在棋子本体，远距离可识别
export default function Board({ state }: { state: GameState }) {
  const order: TeamKey[] = ['east', 'west', 'central', 'north', 'shanghai']
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: "url('/board.png')",
      backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
    }}>
      {order.map((t) => {
        const cell = state.board[state.teams[t].position]
        if (!cell) return null
        const idx = order.indexOf(t)
        const dx = (idx - 2) * 2.2
        const name = state.teamNames[t]
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
            {name}
            <span className="dot">{idx + 1}</span>
          </div>
        )
      })}
    </div>
  )
}
