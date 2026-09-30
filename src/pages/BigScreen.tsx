import { useEffect, useState } from 'react'
import { GameState, TeamKey } from '../types'
import { Socket } from 'socket.io-client'
import Board from '../components/Board'
import Dice from '../components/Dice'

const TEAM_ORDER: TeamKey[] = ['east', 'west', 'central', 'north', 'shanghai']

export default function BigScreen({ state }: { state: GameState; socket: Socket }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [])

  const remain = Math.max(0, Math.ceil((state.quizTimerEndsAt - now) / 1000))
  const revealed = state.revealAnswer ? JSON.parse(state.revealAnswer) : null
  const curTeam = state.currentTeam
  const curColor = state.teamColors[curTeam]
  const curName = state.teamNames[curTeam]
  const rep = state.representatives[curTeam]
  const isShanghai = curTeam === 'shanghai'
  const showDice = ['rolling', 'dice_result', 'awaiting_host_move', 'moving'].includes(state.status)
  const awaitingHostMove = state.status === 'awaiting_host_move' && isShanghai

  return (
    <div style={{
      position: 'relative', width: '100vw', height: '100vh',
      background: 'radial-gradient(circle at 50% 40%, #ffd98a, #f7a940)',
      overflow: 'hidden',
    }}>
      <Board state={state} />

      {/* 顶部信息条 */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 24, alignItems: 'center',
        background: 'rgba(0,0,0,.55)', color: '#fff', padding: '10px 28px',
        borderRadius: 999, fontSize: 22, fontWeight: 700, zIndex: 40,
      }}>
        <span>第 {state.round} / {state.totalRounds} 轮</span>
        <span style={{ color: curColor, background:'#fff', padding:'2px 12px', borderRadius:999 }}>
          {curName} 行动中
        </span>
        {rep.claimed && rep.name && (
          <span style={{ fontSize: 16, opacity: .9 }}>
            代表：{rep.name}{rep.years ? `（${rep.years}）` : ''}
          </span>
        )}
        {isShanghai && (
          <span style={{ fontSize: 16, opacity: .9, color: '#ffd43b' }}>🎲 实体骰子</span>
        )}
      </div>

      {/* 右侧5队实时位置 */}
      <div style={{
        position: 'absolute', top: 80, right: 16, zIndex: 40,
        background: 'rgba(0,0,0,.55)', color: '#fff', padding: '12px 16px',
        borderRadius: 12, fontSize: 16, minWidth: 190,
      }}>
        <div style={{ fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>实时位置</div>
        {TEAM_ORDER.map(t => (
          <div key={t} style={{ display:'flex', justifyContent:'space-between', margin:'3px 0' }}>
            <span style={{ color: state.teamColors[t], fontWeight: 700 }}>{state.teamNames[t]}</span>
            <span>第 {state.teams[t].position} 格 {state.teams[t].locked && '🏁'}</span>
          </div>
        ))}
      </div>

      {/* 骰子区 */}
      {showDice && (
        <div style={{
          position: 'absolute', right: 60, bottom: 60, zIndex: 50,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }} className="pop-in">
          <div style={{ color:'#fff', fontSize: 28, fontWeight: 900, textShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
            {curName}
          </div>
          {isShanghai && <div style={{ color:'#ffd43b', fontSize: 18, fontWeight: 700 }}>现场实体骰子</div>}
          <Dice value={state.dice.value} rolling={state.dice.rolling} />
          {!state.dice.rolling && state.dice.value > 0 && (
            <div className="big-bounce" style={{
              background:'#fff', color: curColor, fontSize: 40, fontWeight: 900,
              padding: '4px 24px', borderRadius: 12,
            }}>
              {awaitingHostMove ? `${state.dice.value} 点 · 等待主持人` : `+${state.dice.value}`}
            </div>
          )}
        </div>
      )}

      {/* 一次性事件 toast */}
      {state.lastEvent && now - state.lastEvent.ts < 2600 && (
        <div key={state.lastEvent.ts} style={{
          position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'linear-gradient(135deg,#ffd43b,#ff922b)',
          color: '#7a3b00', fontSize: 56, fontWeight: 900, padding: '20px 60px',
          borderRadius: 24, zIndex: 60, boxShadow: '0 12px 40px rgba(0,0,0,.3)',
        }} className="big-bounce">
          {state.lastEvent.text}
        </div>
      )}

      {/* 答题弹窗 */}
      {(state.status === 'quiz_open' || state.status === 'quiz_closed' || state.status === 'answer_revealed') && state.currentQuestion && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 70,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="pop-in" style={{
            background: '#fff', borderRadius: 24, padding: 32,
            width: state.currentQuestion.type === 'challenge' ? '900px' : '820px',
            maxWidth: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,.4)',
            border: state.currentQuestion.type === 'challenge' ? '6px solid #9c36b5' : '6px solid #2b8a3e',
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12 }}>
              <span style={{
                background: state.currentQuestion.type === 'challenge' ? '#9c36b5' : '#2b8a3e',
                color:'#fff', padding:'4px 14px', borderRadius:999, fontWeight:800,
              }}>
                {state.currentQuestion.type === 'challenge' ? '🔥 超级挑战' : '🧠 反斗知识'}
              </span>
              <span style={{ fontSize: 18, fontWeight: 800, color: curColor }}>
                {curName} 作答中
              </span>
              {state.status === 'quiz_open' && (
                <span style={{ fontSize: 40, fontWeight: 900, color: remain <= 5 ? '#e03131' : '#333' }}>
                  {remain}s
                </span>
              )}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 20, lineHeight: 1.4 }}>
              {state.currentQuestion.question}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {(['A','B','C','D'] as const).map(opt => {
                const v = state.votes[opt]
                const total = state.votes.A + state.votes.B + state.votes.C + state.votes.D
                const pct = total ? Math.round(v / total * 100) : 0
                const showResult = state.status !== 'quiz_open'
                const isCorrect = state.status === 'answer_revealed' && revealed?.correctAnswer === opt
                const isTeamAns = revealed && revealed.teamAnswer === opt
                return (
                  <div key={opt} style={{
                    background: isCorrect ? '#d3f9d8' : isTeamAns && state.status==='answer_revealed' ? '#fff3bf' : '#f1f3f5',
                    borderRadius: 12, padding: '14px 16px', position: 'relative', overflow: 'hidden',
                    border: isCorrect ? '3px solid #2b8a3e' : '3px solid transparent',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>
                      {opt}. {state.currentQuestion!.options[opt]}
                      {isCorrect && ' ✅'}
                      {isTeamAns && state.status === 'answer_revealed' && !revealed.manual && ' 📢团队选择'}
                    </div>
                    {showResult && (
                      <div className="bar-row" style={{ marginTop: 8 }}>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: pct + '%', background: curColor }}>
                            {v}票 · {pct}%
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {state.status === 'answer_revealed' && revealed && (
              <div className="pop-in" style={{
                marginTop: 16, textAlign: 'center', fontSize: 26, fontWeight: 900,
                color: revealed.correct ? '#2b8a3e' : '#c92a2a',
              }}>
                {revealed.correct
                  ? `回答正确！团队答案 ${revealed.teamAnswer}，+${state.currentQuestion!.reward} 格！`
                  : revealed.tie
                    ? `平票！视为答题失败（正确答案 ${revealed.correctAnswer}）`
                    : `回答错误…团队答案 ${revealed.teamAnswer}（正确答案 ${revealed.correctAnswer}）`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 游戏结束 */}
      {state.status === 'finished' && state.rankings && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 80,
          background: 'linear-gradient(135deg, #7048e8, #9c36b5, #e64980)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
        }}>
          <div className="big-bounce" style={{ fontSize: 72, fontWeight: 900, marginBottom: 24, textShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
            🏆 最终排名
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'center' }}>
            {state.rankings.map((r: any, i: number) => (
              <div key={r.team} className="pop-in" style={{
                background: 'rgba(255,255,255,.18)', borderRadius: 20, padding: '24px 28px',
                textAlign: 'center', backdropFilter: 'blur(8px)',
                animationDelay: (i * 0.2) + 's',
                minWidth: 160,
                transform: i === 0 ? 'scale(1.15)' : 'none',
                border: i === 0 ? '3px solid #ffd43b' : '3px solid rgba(255,255,255,.3)',
              }}>
                <div style={{ fontSize: 40 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🎖️'}</div>
                <div style={{ fontSize: 26, fontWeight: 900 }}>{r.name}</div>
                <div style={{ fontSize: 18, opacity: .9, marginTop: 6 }}>第 {r.position} 格</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 10, color: '#ffd43b' }}>
                  抽奖名额：{r.lotterySlots}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 30, fontSize: 20, opacity: .9 }}>
            共计 {state.rankings.reduce((s: number, r: any) => s + r.lotterySlots, 0)} 个抽奖名额 · 一起玩 · 一起赢 · 一路同行
          </div>
        </div>
      )}

      {/* 开始等待 */}
      {state.status === 'idle' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 75,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.4)',
        }}>
          <div className="big-bounce" style={{
            color: '#fff', fontSize: 56, fontWeight: 900,
            textShadow: '0 4px 20px rgba(0,0,0,.5)',
          }}>
            等待主持人开始游戏…
          </div>
        </div>
      )}
    </div>
  )
}
