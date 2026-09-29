import { useState, useEffect, useRef } from 'react'
import { GameState, TeamKey } from '../types'
import { Socket } from 'socket.io-client'

const TEAMS: { key: TeamKey; color: string; label: string }[] = [
  { key: 'red', color: '#e03131', label: '红队' },
  { key: 'blue', color: '#1971c2', label: '蓝队' },
  { key: 'yellow', color: '#f08c00', label: '黄队' },
  { key: 'green', color: '#2b8a3e', label: '绿队' },
]

export default function Mobile({ state, socket }: { state: GameState; socket: Socket }) {
  const [team, setTeam] = useState<TeamKey | null>(null)
  const [voted, setVoted] = useState<string | null>(null)
  const lastQid = useRef<number | undefined>(undefined)

  // 题目 id 变化时重置"已投票"
  const qid = state.currentQuestion?.id
  useEffect(() => {
    if (lastQid.current !== undefined && lastQid.current !== qid) {
      setVoted(null)
    }
    lastQid.current = qid
  }, [qid])

  const chooseTeam = (t: TeamKey) => {
    setTeam(t)
    socket.emit('employee:join', { team: t })
  }

  const vote = (opt: 'A' | 'B' | 'C' | 'D') => {
    if (voted) return
    socket.emit('employee:vote', { option: opt })
    setVoted(opt)
  }

  if (!team) {
    return (
      <div style={{
        minHeight: '100vh', background: 'linear-gradient(160deg,#ffd98a,#f7a940)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: 24, boxSizing: 'border-box',
      }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: '#7a3b00', marginTop: 20 }}>
          玩具反斗城 20周年
        </div>
        <div style={{ fontSize: 18, color: '#7a3b00', margin: '8px 0 30px' }}>请选择你的队伍</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: '100%', maxWidth: 380 }}>
          {TEAMS.map(t => (
            <button key={t.key} onClick={() => chooseTeam(t.key)}
              style={{
                background: t.color, color: '#fff', fontSize: 24, fontWeight: 900,
                padding: '32px 0', borderRadius: 20, border: 'none',
                boxShadow: '0 6px 16px rgba(0,0,0,.2)',
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 30, color: '#7a3b00', fontSize: 14, opacity: .8 }}>
          加入后请保持本页面打开
        </div>
      </div>
    )
  }

  const inQuiz = state.status === 'quiz_open' && state.currentQuestion

  return (
    <div style={{
      minHeight: '100vh', background: '#fff', padding: 16, boxSizing: 'border-box',
      fontFamily: 'inherit',
    }}>
      <div style={{
        background: '#f7a940', color: '#fff', padding: '10px 16px', borderRadius: 12,
        textAlign: 'center', fontWeight: 800, fontSize: 16, marginBottom: 16,
      }}>
        玩具反斗城20周年 · 你在【{TEAMS.find(t=>t.key===team)?.label}】
      </div>

      {!inQuiz && (
        <div style={{ textAlign: 'center', marginTop: 60, color: '#888', fontSize: 18 }}>
          {state.status === 'idle' && '等待游戏开始…'}
          {state.status === 'awaiting_roll' && `${state.teams[state.currentTeam].name} 正在投骰子…`}
          {state.status === 'rolling' && '骰子滚动中…'}
          {state.status === 'rolled' && '棋子移动中…'}
          {state.status === 'moving' && '棋子移动中…'}
          {state.status === 'cell_action' && '等待主持人操作…'}
          {state.status === 'lucky' && '触发幸运格效果…'}
          {state.status === 'quiz_closed' && '投票已截止，等待主持人公布结果…'}
          {state.status === 'answer_revealed' && '结果已公布！'}
          {state.status === 'finished' && '🎉 游戏结束，恭喜全体！'}
        </div>
      )}

      {inQuiz && team !== state.currentTeam && (
        <div style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ fontSize: 48 }}>👀</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#555', marginTop: 12 }}>
            {state.teams[state.currentTeam].name} 正在答题
          </div>
          <div style={{ fontSize: 16, color: '#999', marginTop: 8 }}>
            本题只有{state.teams[state.currentTeam].name}成员可以作答，请等待结果
          </div>
        </div>
      )}

      {inQuiz && team === state.currentTeam && (
        <div>
          <div style={{ fontSize: 14, color: '#999', marginBottom: 8 }}>
            {state.currentQuestion!.type === 'challenge' ? '🔥 超级挑战' : '🧠 反斗知识'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.5, marginBottom: 20 }}>
            {state.currentQuestion!.question}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(['A','B','C','D'] as const).map(opt => {
              const selected = voted === opt
              return (
                <button key={opt} onClick={() => vote(opt)} disabled={!!voted}
                  style={{
                    background: selected ? '#2b8a3e' : '#e7f5ff',
                    color: selected ? '#fff' : '#1971c2',
                    fontSize: 18, fontWeight: 700, padding: '18px 16px',
                    borderRadius: 14, border: selected ? '3px solid #2b8a3e' : '3px solid transparent',
                    textAlign: 'left', width: '100%',
                  }}>
                  <b style={{ marginRight: 8 }}>{opt}.</b>
                  {state.currentQuestion!.options[opt]}
                </button>
              )
            })}
          </div>
          {voted && (
            <div style={{
              marginTop: 20, textAlign: 'center', padding: 16,
              background: '#d3f9d8', color: '#2b8a3e', borderRadius: 12, fontWeight: 800,
            }}>
              ✅ 已提交（{voted}），等待全队结果…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
