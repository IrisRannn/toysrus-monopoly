import { useState, useEffect, useRef } from 'react'
import { GameState, TeamKey } from '../types'
import { Socket } from 'socket.io-client'

const TEAMS: { key: TeamKey; color: string; label: string }[] = [
  { key: 'east', color: '#e03131', label: '东区' },
  { key: 'west', color: '#2b8a3e', label: '西区' },
  { key: 'central', color: '#f08c00', label: '中南区' },
  { key: 'north', color: '#1971c2', label: '北区' },
  { key: 'shanghai', color: '#9c36b5', label: '上海Office' },
]

export default function Mobile({ state, socket }: { state: GameState; socket: Socket }) {
  const [team, setTeam] = useState<TeamKey | null>(null)
  const [voted, setVoted] = useState<string | null>(null)
  const [isRep, setIsRep] = useState(false)
  const [myRepName, setMyRepName] = useState('')
  const [myRepYears, setMyRepYears] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [physicalValue, setPhysicalValue] = useState<number | null>(null)
  const [submittedPhysical, setSubmittedPhysical] = useState(false)
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

  const claimRep = () => {
    if (claiming) return
    setClaiming(true)
    socket.emit('employee:claimRepresentative', { name: myRepName, years: myRepYears })
  }

  useEffect(() => {
    const onAck = (res: any) => {
      if (res?.ok) {
        setIsRep(true)
      } else {
        alert(res?.reason === 'already_claimed' ? '本轮代表已产生，不能重复成为代表' : '当前不是你的队伍回合')
      }
      setClaiming(false)
    }
    socket.on('rep:ack', onAck)
    socket.on('roll:ack', onAck)
    return () => {
      socket.off('rep:ack', onAck)
      socket.off('roll:ack', onAck)
    }
  }, [socket])

  const isMyTurn = state.currentTeam === team
  const repInfo = team ? state.representatives[team] : null

  // ---------- 选队页 ----------
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, width: '100%', maxWidth: 380 }}>
          {TEAMS.map(t => (
            <button key={t.key} onClick={() => chooseTeam(t.key)}
              style={{
                background: t.color, color: '#fff', fontSize: 22, fontWeight: 900,
                padding: '28px 0', borderRadius: 20, border: 'none',
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
  const isShanghai = team === 'shanghai'

  // ---------- 主界面 ----------
  return (
    <div style={{
      minHeight: '100vh', background: '#fff', padding: 16, boxSizing: 'border-box',
      fontFamily: 'inherit',
    }}>
      <div style={{
        background: state.teamColors[team], color: '#fff', padding: '10px 16px', borderRadius: 12,
        textAlign: 'center', fontWeight: 800, fontSize: 16, marginBottom: 16,
      }}>
        玩具反斗城20周年 · 你在【{TEAMS.find(t=>t.key===team)?.label}】
      </div>

      {/* ---------- 答题区（当前队成员可答） ---------- */}
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
                <button key={opt} onClick={() => {
                  if (voted) return
                  socket.emit('employee:vote', { option: opt })
                  setVoted(opt)
                }} disabled={!!voted}
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

      {/* 非本队答题时 */}
      {inQuiz && team !== state.currentTeam && (
        <div style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ fontSize: 48 }}>👀</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#555', marginTop: 12 }}>
            {state.teamNames[state.currentTeam]} 正在答题
          </div>
          <div style={{ fontSize: 16, color: '#999', marginTop: 8 }}>
            本题只有{state.teamNames[state.currentTeam]}成员可以作答，请等待结果
          </div>
        </div>
      )}

      {/* ---------- 非答题时：投骰子/等待区 ---------- */}
      {!inQuiz && (
        <div>
          {/* 不是本队回合 */}
          {!isMyTurn && (
            <div style={{ textAlign: 'center', marginTop: 60, color: '#888', fontSize: 18 }}>
              {state.status === 'idle' && '等待游戏开始…'}
              {state.status !== 'idle' && state.status !== 'finished' && (
                <>
                  <div>{state.teamNames[state.currentTeam]} 正在行动…</div>
                  <div style={{ fontSize: 15, color: '#aaa', marginTop: 8 }}>
                    轮到你们时，本页会自动出现投骰子入口
                  </div>
                </>
              )}
              {state.status === 'finished' && '🎉 游戏结束，恭喜全体！'}
            </div>
          )}

          {/* 本队回合 */}
          {isMyTurn && (
            <div>
              {/* 代表未产生：先成为代表（先到先得） */}
              {!repInfo?.claimed && !isRep && (
                <div style={{ textAlign: 'center', marginTop: 20 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#333', marginBottom: 16 }}>
                    你是本轮投骰子代表吗？<br />
                    <span style={{ fontSize: 14, fontWeight: 400, color: '#999' }}>
                      {isShanghai ? '上海Office：现场掷实体骰子并提交点数' : '点击成为代表，第一个成功者获得资格'}
                    </span>
                  </div>
                  <input placeholder="姓名" value={myRepName}
                    onChange={e => setMyRepName(e.target.value)}
                    style={{ width: '100%', padding: '12px', fontSize: 16, borderRadius: 10, border: '1px solid #ccc', marginBottom: 10, boxSizing: 'border-box' }} />
                  <input placeholder="工龄（如 10年）" value={myRepYears}
                    onChange={e => setMyRepYears(e.target.value)}
                    style={{ width: '100%', padding: '12px', fontSize: 16, borderRadius: 10, border: '1px solid #ccc', marginBottom: 16, boxSizing: 'border-box' }} />
                  <button onClick={claimRep} disabled={claiming}
                    style={{
                      width: '100%', background: state.teamColors[team], color: '#fff',
                      fontSize: 22, fontWeight: 900, padding: '18px 0', borderRadius: 16,
                      border: 'none', boxShadow: '0 6px 16px rgba(0,0,0,.2)',
                    }}>
                    {claiming ? '申请中…' : '成为本轮投骰子代表'}
                  </button>
                </div>
              )}

              {/* 已产生代表，但我不是代表 */}
              {repInfo?.claimed && !isRep && (
                <div style={{ textAlign: 'center', marginTop: 60, color: '#888', fontSize: 18 }}>
                  <div style={{ fontSize: 48 }}>🙋</div>
                  <div style={{ marginTop: 12, fontSize: 20, color: '#555', fontWeight: 700 }}>
                    本轮代表：{repInfo.name || '（已选出）'}
                    {repInfo.years ? `（${repInfo.years}）` : ''}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 15 }}>
                    请让代表在手机上操作投骰子
                  </div>
                </div>
              )}

              {/* 我是代表：投骰子/提交实体骰子 */}
              {isRep && (
                <div>
                  {isShanghai ? (
                    /* ---------- 上海Office：实体骰子 ---------- */
                    state.status === 'awaiting_dice' ? (
                      <div style={{ textAlign: 'center', marginTop: 20 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#333', marginBottom: 6 }}>
                          你是本轮代表：{myRepName || repInfo?.name}{myRepYears ? `（${myRepYears}）` : ''}
                        </div>
                        <div style={{ fontSize: 15, color: '#666', marginBottom: 20, lineHeight: 1.6 }}>
                          请在线下掷出巨大实体骰子<br />然后选择实际点数
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 16 }}>
                          {[1,2,3,4,5,6].map(n => (
                            <button key={n} onClick={() => setPhysicalValue(n)}
                              style={{
                                background: physicalValue === n ? '#9c36b5' : '#f3f0ff',
                                color: physicalValue === n ? '#fff' : '#9c36b5',
                                fontSize: 26, fontWeight: 900, padding: '16px 0', borderRadius: 12,
                                border: physicalValue === n ? '3px solid #9c36b5' : '3px solid transparent',
                              }}>
                              {n}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => {
                          if (!physicalValue) return alert('请先选择点数')
                          if (submittedPhysical) return
                          setSubmittedPhysical(true)
                          socket.emit('employee:submitPhysicalDice', { value: physicalValue })
                        }} disabled={!physicalValue || submittedPhysical}
                          style={{
                            width: '100%', background: submittedPhysical ? '#adb5bd' : '#9c36b5', color: '#fff',
                            fontSize: 22, fontWeight: 900, padding: '18px 0', borderRadius: 16,
                            border: 'none', boxShadow: '0 6px 16px rgba(0,0,0,.2)',
                          }}>
                          {submittedPhysical ? '已确认，等待主持人' : '确认实体骰子结果'}
                        </button>
                      </div>
                    ) : (
                      /* 上海：已提交/移动中 */
                      <div style={{ textAlign: 'center', marginTop: 60, color: '#555' }}>
                        <div style={{ fontSize: 48 }}>🎲</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 12 }}>
                          实体骰子结果已确认：{state.dice.value} 点
                        </div>
                        <div style={{ fontSize: 16, color: '#999', marginTop: 8 }}>
                          {state.status === 'awaiting_host_move' && '等待主持人移动棋子…'}
                          {state.status === 'moving' && '棋子正在移动……'}
                          {(state.status === 'cell_action' || state.status === 'lucky') && '移动完成，等待主持人操作…'}
                        </div>
                      </div>
                    )
                  ) : (
                    /* ---------- 线上四区：电子骰子 ---------- */
                    state.status === 'awaiting_dice' ? (
                      <div style={{ textAlign: 'center', marginTop: 20 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#333', marginBottom: 6 }}>
                          你是本轮代表：{myRepName || repInfo?.name}{myRepYears ? `（${myRepYears}）` : ''}
                        </div>
                        <div style={{ fontSize: 15, color: '#666', marginBottom: 24 }}>
                          点击投骰子，系统生成 1-6 点并自动移动棋子
                        </div>
                        <button onClick={() => socket.emit('employee:rollDice')}
                          style={{
                            width: '100%', background: state.teamColors[team], color: '#fff',
                            fontSize: 26, fontWeight: 900, padding: '24px 0', borderRadius: 20,
                            border: 'none', boxShadow: '0 8px 20px rgba(0,0,0,.25)',
                          }}>
                          🎲 投骰子
                        </button>
                      </div>
                    ) : (
                      /* 已投出/移动中 */
                      <div style={{ textAlign: 'center', marginTop: 60, color: '#555' }}>
                        <div style={{ fontSize: 48 }}>🎲</div>
                        <div style={{ fontSize: 22, fontWeight: 900, marginTop: 12 }}>
                          你投出了 {state.dice.value} 点
                        </div>
                        <div style={{ fontSize: 16, color: '#999', marginTop: 8 }}>
                          {state.status === 'rolling' && '骰子滚动中…'}
                          {(state.status === 'dice_result' || state.status === 'moving') && '棋子正在移动……'}
                          {(state.status === 'cell_action' || state.status === 'lucky') && '移动完成，等待主持人操作…'}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* 游戏结束 */}
          {state.status === 'finished' && (
            <div style={{ textAlign: 'center', marginTop: 60, color: '#555', fontSize: 18 }}>
              🎉 游戏结束，恭喜全体！
            </div>
          )}
        </div>
      )}
    </div>
  )
}
