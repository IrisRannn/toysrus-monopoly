import { useState } from 'react'
import { GameState, TeamKey } from '../types'
import { Socket } from 'socket.io-client'

const TEAM_ORDER: TeamKey[] = ['east', 'west', 'central', 'north', 'shanghai']

function BigBtn({ onClick, children, color = '#1971c2', disabled = false }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#adb5bd' : color, color: '#fff',
        fontSize: 20, fontWeight: 800, padding: '16px 22px', borderRadius: 14,
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,.2)', flex: 1, minWidth: 130,
      }}
    >{children}</button>
  )
}

export default function Host({ state, socket }: { state: GameState; socket: Socket }) {
  const cur = state.currentTeam
  const curName = state.teamNames[cur]
  const curColor = state.teamColors[cur]
  const rep = state.representatives[cur]
  const cell = state.board[state.teams[cur].position]
  const isShanghai = cur === 'shanghai'
  const [repName, setRepName] = useState('')
  const [repYears, setRepYears] = useState('')

  const s = state.status
  const revealed = state.revealAnswer ? JSON.parse(state.revealAnswer) : null
  const waitingShanghaiMove = s === 'awaiting_host_move' && isShanghai

  return (
    <div style={{
      minHeight: '100vh', background: '#f1f3f5', padding: 16,
      fontFamily: 'inherit',
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        {/* 标题 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>🎮 主持人控制台（5队版）</h1>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            第 {state.round}/{state.totalRounds} 轮 · 当前：
            <span style={{ color: curColor, marginLeft: 6 }}>{curName}</span>
          </div>
        </div>

        {/* 状态条 */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,.06)', fontSize: 18,
        }}>
          <div>状态：<b>{s}</b>　|　落点格：<b>{cell?.label}</b>（{cell?.type}）{cell?.luckyEffect ? `[${cell.luckyEffect}]` : ''}</div>
          {/* 代表信息 */}
          <div style={{ marginTop: 8, color: '#555' }}>
            本轮代表：{rep.claimed ? `${rep.name || '（未填姓名）'}${rep.years ? ` / ${rep.years}` : ''}` : '尚未选出'}
          </div>
          {/* 骰子状态：线上/上海分开 */}
          <div style={{ marginTop: 8, color: '#333', fontWeight: 700 }}>
            {s === 'rolling' && `${curName} 骰子滚动中…`}
            {s === 'dice_result' && !isShanghai && `${curName}｜投出 ${state.dice.value} 点｜棋子已自动移动`}
            {waitingShanghaiMove && `上海Office｜实体骰子｜${state.dice.value} 点｜等待移动`}
            {s === 'moving' && `${curName} 棋子移动中…`}
          </div>
          {state.currentQuestion && (
            <div style={{ marginTop: 8, color: '#666' }}>
              当前题：{state.currentQuestion.question}（正确答案 {state.currentQuestion.answer}，奖励 {state.currentQuestion.reward} 格）
            </div>
          )}
          {revealed && (
            <div style={{ marginTop: 8, color: revealed.correct ? '#2b8a3e' : '#c92a2a', fontWeight: 700 }}>
              团队答案 {revealed.teamAnswer} {revealed.tie && '(平票)'} → {revealed.correct ? '✅ 答对（奖励自动移动）' : '❌ 答错'}
            </div>
          )}
        </div>

        {/* 本轮代表（主持人可代填/修改） */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,.06)',
        }}>
          <b>本轮投骰子代表（{curName}）</b>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input placeholder="姓名" value={repName || rep.name}
              onChange={e => setRepName(e.target.value)}
              style={{ padding: '8px 12px', fontSize: 16, borderRadius: 8, border: '1px solid #ccc' }} />
            <input placeholder="工龄（如 10年）" value={repYears || rep.years}
              onChange={e => setRepYears(e.target.value)}
              style={{ padding: '8px 12px', fontSize: 16, borderRadius: 8, border: '1px solid #ccc' }} />
            <button onClick={() => {
              socket.emit('host:setRepresentative', { team: cur, name: repName, years: repYears })
            }} style={btnStyle('#1971c2')}>保存代表信息</button>
            <span style={{ alignSelf: 'center', fontSize: 14, color: '#888' }}>
              {rep.claimed ? '（已由员工选出，可在此修改）' : '（员工手机端先到先得，主持人也可代填）'}
            </span>
          </div>
        </div>

        {/* 主流程按钮 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <BigBtn color="#868e96" onClick={() => socket.emit('host:startGame')} disabled={s !== 'idle'}>
            ▶ 开始游戏
          </BigBtn>
          {/* 上海Office专用：确认实体骰子移动 */}
          <BigBtn color="#9c36b5" onClick={() => socket.emit('host:confirmPhysicalMove')} disabled={!waitingShanghaiMove}>
            🎲 移动{curName} +{state.dice.value}
          </BigBtn>
          <BigBtn color="#e8590c" onClick={() => socket.emit('host:movePiece')} disabled={s !== 'dice_result'}>
            👣 手动移动（应急）
          </BigBtn>
          <BigBtn color="#2b8a3e" onClick={() => socket.emit('host:startQuiz')} disabled={!(s === 'cell_action' && state.currentQuestion)}>
            🧠 开始答题
          </BigBtn>
          <BigBtn color="#1971c2" onClick={() => socket.emit('host:endVoting')} disabled={s !== 'quiz_open'}>
            ⏹ 结束投票
          </BigBtn>
          <BigBtn color="#9c36b5" onClick={() => socket.emit('host:revealAnswer')} disabled={s !== 'quiz_closed'}>
            📢 公布答案
          </BigBtn>
          <BigBtn color="#2b8a3e" onClick={() => socket.emit('host:applyBonus')} disabled={s !== 'answer_revealed'}>
            ✅ 答对 +{state.currentQuestion?.reward || 3}（应急）
          </BigBtn>
          <BigBtn color="#f08c00" onClick={() => socket.emit('host:triggerLucky')} disabled={s !== 'lucky'}>
            🍀 触发幸运效果
          </BigBtn>
          <BigBtn color="#495057" onClick={() => socket.emit('host:nextTeam')} disabled={!['cell_action', 'answer_revealed', 'lucky'].includes(s)}>
            ⏭ 下一队
          </BigBtn>
          <BigBtn color="#c92a2a" onClick={() => socket.emit('host:endGame')} disabled={s === 'finished' || s === 'idle'}>
            🏁 结束游戏
          </BigBtn>
        </div>

        {/* 5队状态总览 */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,.06)',
        }}>
          <b>5队实时状态</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 10 }}>
            {TEAM_ORDER.map(t => (
              <div key={t} style={{
                border: `2px solid ${state.teamColors[t]}`, borderRadius: 10, padding: 8,
                opacity: t === cur ? 1 : .85,
                background: t === cur ? '#fff9db' : '#fff',
              }}>
                <div style={{ fontWeight: 800, color: state.teamColors[t] }}>{state.teamNames[t]}</div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  第 {state.teams[t].position} 格{state.teams[t].locked ? ' 🏁' : ''}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  代表：{state.representatives[t].claimed ? state.representatives[t].name || '已选' : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 现场应急工具 */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,.06)',
        }}>
          <b>🛠 现场应急工具</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {TEAM_ORDER.map(t => (
              <div key={t} style={{
                border: `2px solid ${state.teamColors[t]}`, borderRadius: 10, padding: 8, minWidth: 150,
              }}>
                <div style={{ fontWeight: 800, color: state.teamColors[t] }}>
                  {state.teamNames[t]}（第 {state.teams[t].position} 格）
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <button style={btnStyle('#868e96')} onClick={() => socket.emit('host:manualMove', { team: t, delta: -1 })}>-1</button>
                  <button style={btnStyle('#868e96')} onClick={() => socket.emit('host:manualMove', { team: t, delta: 1 })}>+1</button>
                  <button style={btnStyle('#868e96')} onClick={() => socket.emit('host:manualMove', { team: t, delta: -3 })}>-3</button>
                  <button style={btnStyle('#868e96')} onClick={() => socket.emit('host:manualMove', { team: t, delta: 3 })}>+3</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btnStyle('#9c36b5')} onClick={() => {
              const o = prompt('手动指定团队答案（A/B/C/D）：', 'A')
              if (o) socket.emit('host:setManualAnswer', { option: o.toUpperCase() })
            }} disabled={s !== 'quiz_closed'}>✋ 手动指定答案</button>
            <button style={btnStyle('#9c36b5')} onClick={() => {
              const v = prompt('修改上海Office实体骰子结果（1-6）：', '5')
              if (v) socket.emit('host:setPhysicalDice', { value: v })
            }} disabled={!isShanghai || (s !== 'dice_result' && s !== 'awaiting_host_move')}>
              🎲 修改实体骰子结果
            </button>
            <button style={btnStyle('#c92a2a')} onClick={() => {
              if (confirm('确定重置整个游戏？')) socket.emit('host:reset')
            }}>🔄 重置游戏</button>
          </div>
        </div>

        {/* 投票实时统计 */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,.06)',
        }}>
          <b>当前投票实时统计（{curName}）</b>
          {(['A','B','C','D'] as const).map(o => {
            const total = state.votes.A + state.votes.B + state.votes.C + state.votes.D
            const pct = total ? Math.round(state.votes[o] / total * 100) : 0
            return (
              <div key={o} className="bar-row">
                <span style={{ width: 24, fontWeight: 800 }}>{o}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: pct + '%', background: curColor }}>
                    {state.votes[o]} 票
                  </div>
                </div>
              </div>
            )
          })}
          <div style={{ marginTop: 8, color: '#666', fontSize: 14 }}>
            各队手机端人数：{TEAM_ORDER.map(t => `${state.teamNames[t]} ${state.teams[t].members}`).join(' · ')}
          </div>
        </div>
      </div>
    </div>
  )
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', padding: '8px 14px',
    borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
  }
}
