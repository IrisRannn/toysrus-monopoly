// 玩具反斗城 20周年全员大富翁 —— 服务端
// 单一游戏状态源：大屏 / 主持人 / 手机三端都监听这里的 gameState。
import express from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 3001
const TOTAL_ROUNDS = 3
const TEAM_ORDER = ['red', 'blue', 'yellow', 'green']
const TEAM_NAMES = { red: '红队', blue: '蓝队', yellow: '黄队', green: '绿队' }

// ---------------------------------------------------------------------------
// 棋盘 28 格（0=起点，27=终点）。坐标为相对于棋盘图片的百分比 (x%, y%)。
// 坐标依据上传的 board.png (2156x1214) 实测标定。
// type: start | normal | quiz | challenge | lucky | end
// luckyEffect: 'roll_again' | 'advance_2' | 'advance_3' | 'back_2'
// ---------------------------------------------------------------------------
const BOARD = [
  { id: 0,  type: 'start',    x: 8.5,  y: 86,  label: '起点' },
  { id: 1,  type: 'normal',   x: 17.8, y: 86,  label: '1' },
  { id: 2,  type: 'normal',   x: 27.5, y: 86,  label: '2' },
  { id: 3,  type: 'normal',   x: 37.2, y: 86,  label: '3' },
  { id: 4,  type: 'quiz',     x: 46.2, y: 86,  label: '反斗知识' },
  { id: 5,  type: 'normal',   x: 55.8, y: 86,  label: '5' },
  { id: 6,  type: 'lucky',    x: 65.0, y: 86,  label: '再掷一次', luckyEffect: 'roll_again' },
  { id: 7,  type: 'normal',   x: 73.8, y: 86,  label: '7' },
  { id: 8,  type: 'quiz',     x: 83.5, y: 86,  label: '反斗知识' },
  { id: 9,  type: 'normal',   x: 89.5, y: 71.5, label: '9' },
  { id: 10, type: 'normal',   x: 89.5, y: 55.5, label: '10' },
  { id: 11, type: 'lucky',    x: 89.5, y: 39.0, label: '前进三格', luckyEffect: 'advance_3' },
  { id: 12, type: 'normal',   x: 89.5, y: 23.5, label: '12' },
  { id: 13, type: 'normal',   x: 79.5, y: 23.5, label: '13' },
  { id: 14, type: 'normal',   x: 69.8, y: 23.5, label: '14' },
  { id: 15, type: 'challenge',x: 69.8, y: 39.0, label: '反斗知识' },
  { id: 16, type: 'normal',   x: 69.8, y: 55.5, label: '16' },
  { id: 17, type: 'normal',   x: 55.5, y: 71.5, label: '17' },
  { id: 18, type: 'lucky',    x: 46.5, y: 71.5, label: '后退两格', luckyEffect: 'back_2' },
  { id: 19, type: 'normal',   x: 38.2, y: 71.5, label: '19' },
  { id: 20, type: 'lucky',    x: 27.5, y: 55.5, label: '前进三格', luckyEffect: 'advance_3' },
  { id: 21, type: 'normal',   x: 27.5, y: 39.0, label: '21' },
  { id: 22, type: 'normal',   x: 27.5, y: 23.5, label: '22' },
  { id: 23, type: 'normal',   x: 17.8, y: 23.5, label: '23' },
  { id: 24, type: 'lucky',    x: 8.5,  y: 23.5, label: '前进三格', luckyEffect: 'advance_3' },
  { id: 25, type: 'normal',   x: 8.5,  y: 39.0, label: '25' },
  { id: 26, type: 'normal',   x: 8.5,  y: 55.5, label: '26' },
  { id: 27, type: 'end',      x: 8.5,  y: 71.5, label: '终点' },
]
const BOARD_LEN = BOARD.length // 28

// ---------------------------------------------------------------------------
// 题库（可自行扩充）。reward: 普通答题 3，超级挑战 5。
// ---------------------------------------------------------------------------
const QUESTIONS = [
  { id: 1, type: 'normal', reward: 3,
    question: '玩具反斗城今年是第几周年？',
    options: { A: '18周年', B: '19周年', C: '20周年', D: '21周年' },
    answer: 'C' },
  { id: 2, type: 'normal', reward: 3,
    question: '玩具反斗城的官方吉祥物叫什么名字？',
    options: { A: '杰菲 (Geoffrey)', B: '米奇', C: '哆啦A梦', D: '芭比' },
    answer: 'A' },
  { id: 3, type: 'normal', reward: 3,
    question: '"一起玩" 的下一句 slogan 是什么？',
    options: { A: '一起赢', B: '一起飞', C: '一起乐', D: '一起长大' },
    answer: 'A' },
  { id: 4, type: 'normal', reward: 3,
    question: '玩具反斗城门店内标志性的颜色主调是？',
    options: { A: '粉色', B: '橙色', C: '蓝色', D: '紫色' },
    answer: 'B' },
  { id: 5, type: 'normal', reward: 3,
    question: '以下哪个是玩具反斗城的兄弟品牌？',
    options: { A: "Babies R Us", B: 'Toys R Us', C: '反斗乐园', D: '玩具王国' },
    answer: 'A' },
  { id: 6, type: 'normal', reward: 3,
    question: '杰菲是一只什么动物？',
    options: { A: '斑马', B: '长颈鹿', C: '梅花鹿', D: '马' },
    answer: 'B' },
  { id: 7, type: 'challenge', reward: 5,
    question: '【超级挑战】玩具反斗城进入中国内地市场是在哪一年？',
    options: { A: '2005年', B: '2006年', C: '2007年', D: '2008年' },
    answer: 'C' },
  { id: 8, type: 'challenge', reward: 5,
    question: '【超级挑战】20周年庆的主题口号是？',
    options: { A: '一起玩·一起赢·一路同行', B: '快乐成长', C: '玩具总动员', D: '梦想起航' },
    answer: 'A' },
]

// ---------------------------------------------------------------------------
// 初始游戏状态
// ---------------------------------------------------------------------------
function freshTeamState() {
  return {
    name: '',
    position: 0,
    bonusSteps: 0,     // 答题累计奖励步
    locked: false,     // 是否已到达终点锁定排名
    correct: 0,        // 答对题数
    answered: 0,       // 答题次数
    members: 0,        // 加入手机端的员工数
  }
}

function freshState() {
  return {
    status: 'idle',            // idle | awaiting_roll | rolling | rolled | moving | cell_action | quiz_open | quiz_closed | answer_revealed | lucky | finished
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    currentTeam: 'red',
    turnIndex: 0,              // 0..11
    dice: { value: 0, rolling: false },
    teams: {
      red:    { ...freshTeamState(), name: TEAM_NAMES.red },
      blue:   { ...freshTeamState(), name: TEAM_NAMES.blue },
      yellow: { ...freshTeamState(), name: TEAM_NAMES.yellow },
      green:  { ...freshTeamState(), name: TEAM_NAMES.green },
    },
    representatives: {
      red: { name: '', years: '' },
      blue: { name: '', years: '' },
      yellow: { name: '', years: '' },
      green: { name: '', years: '' },
    },
    currentQuestion: null,     // 正在答的题
    questionPool: shuffle([...QUESTIONS]),
    questionIdx: 0,
    votes: { A: 0, B: 0, C: 0, D: 0 },
    votedBySocket: {},         // socketId -> 'A'..'D'
    quizTimerEndsAt: 0,
    revealAnswer: '',          // 公布答案时显示
    luckyEffect: null,         // 待处理的幸运格效果
    lastEvent: null,           // 一次性 UI 事件: {type, text}
    questionStats: [],         // 每题统计
    rankings: null,
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

let game = freshState()

// ---------------------------------------------------------------------------
// Express + Socket.IO
// ---------------------------------------------------------------------------
const app = express()
app.use(cors())
app.use(express.static(path.join(__dirname, '..', 'dist')))

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

function broadcast() {
  io.emit('state:update', publicState())
}

// 对外暴露的状态（去掉 votedBySocket 这类内部结构）
function publicState() {
  return {
    status: game.status,
    round: game.round,
    totalRounds: game.totalRounds,
    currentTeam: game.currentTeam,
    turnIndex: game.turnIndex,
    dice: game.dice,
    teams: game.teams,
    representatives: game.representatives,
    currentQuestion: game.currentQuestion,
    votes: game.votes,
    quizTimerEndsAt: game.quizTimerEndsAt,
    revealAnswer: game.revealAnswer,
    luckyEffect: game.luckyEffect,
    lastEvent: game.lastEvent,
    questionStats: game.questionStats,
    rankings: game.rankings,
    board: BOARD,
    totalCells: BOARD_LEN,
  }
}

function currentTeamObj() { return game.teams[game.currentTeam] }

function pickQuestion(type) {
  // 从题库里挑一道指定类型的题；池子里没有就退而求其次。
  let q = game.questionPool[game.questionIdx]
  if (!q) { game.questionIdx = 0; q = game.questionPool[0] }
  game.questionIdx++
  return q
}

function setEvent(type, text) {
  game.lastEvent = { type, text, ts: Date.now() }
}

// 计算排名（距终点越近越高；同距比 bonusSteps；再同则并列）
function computeRankings() {
  const arr = TEAM_ORDER.map(t => ({
    team: t,
    name: game.teams[t].name,
    position: game.teams[t].position,
    bonusSteps: game.teams[t].bonusSteps,
    locked: game.teams[t].locked,
  }))
  // 到达终点(position>=27)的先按到达顺序排；其余按 position 降序，再按 bonusSteps 降序
  arr.sort((a, b) => {
    const aEnd = a.position >= BOARD_LEN - 1
    const bEnd = b.position >= BOARD_LEN - 1
    if (aEnd && bEnd) return b.bonusSteps - a.bonusSteps
    if (aEnd) return -1
    if (bEnd) return 1
    if (b.position !== a.position) return b.position - a.position
    return b.bonusSteps - a.bonusSteps
  })
  const prizes = [25, 15, 15, 15]
  return arr.map((a, i) => ({ ...a, rank: i + 1, lotterySlots: prizes[i] }))
}

io.on('connection', (socket) => {
  // 新客户端一上来就拿到完整状态 + 棋盘 + 题库
  socket.emit('state:update', publicState())

  // ---------------- 员工手机端 ----------------
  socket.on('employee:join', ({ team } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    game.teams[team].members += 1
    socket.data.team = team
    broadcast()
  })

  socket.on('employee:vote', ({ option } = {}) => {
    if (game.status !== 'quiz_open') return
    if (!['A', 'B', 'C', 'D'].includes(option)) return
    // 只有当前答题队伍的成员才能投票，其他队不能参与
    if (socket.data.team !== game.currentTeam) {
      socket.emit('vote:ack', { ok: false, reason: 'not_current_team' })
      return
    }
    if (socket.data.hasVoted) return // 同一题只能投一次
    // 作废旧票
    if (game.votedBySocket[socket.id]) {
      game.votes[game.votedBySocket[socket.id]] = Math.max(0, game.votes[game.votedBySocket[socket.id]] - 1)
    }
    game.votes[option] += 1
    game.votedBySocket[socket.id] = option
    socket.data.hasVoted = true
    socket.emit('vote:ack', { ok: true, option })
    broadcast()
  })

  socket.on('disconnect', () => {
    const t = socket.data.team
    if (t && game.teams[t]) game.teams[t].members = Math.max(0, game.teams[t].members - 1)
    broadcast()
  })

  // ---------------- 主持人端 ----------------
  socket.on('host:startGame', () => {
    game = freshState()
    game.status = 'awaiting_roll'
    setEvent('start', '游戏开始！')
    broadcast()
  })

  socket.on('host:rollDice', () => {
    if (game.status !== 'awaiting_roll') return
    game.dice.rolling = true
    game.dice.value = 0
    game.status = 'rolling'
    broadcast()
    // 1.6 秒后定骰
    setTimeout(() => {
      game.dice.value = 1 + Math.floor(Math.random() * 6)
      game.dice.rolling = false
      game.status = 'rolled'
      setEvent('dice', `${currentTeamObj().name} 投出 ${game.dice.value}`)
      broadcast()
      // 展示骰子 0.9 秒后，棋子自动前进（无需主持人手动点）
      setTimeout(() => doMove(), 900)
    }, 1600)
  })

  // 棋子移动逻辑（自动调用，也保留为手动兜底）
  function doMove() {
    if (game.status !== 'rolled' && game.status !== 'moving') return
    const t = game.currentTeam
    const steps = game.dice.value
    const team = game.teams[t]
    if (!team.locked) {
      team.position = Math.min(team.position + steps, BOARD_LEN - 1)
      if (team.position >= BOARD_LEN - 1) team.locked = true
    }
    game.status = 'moving'
    setEvent('move', `${team.name} 前进 ${steps} 格`)
    broadcast()
    // 移动动画约 steps*0.32 秒后判定落点
    setTimeout(() => {
      const cell = BOARD[team.position]
      if (cell.type === 'quiz' || cell.type === 'challenge') {
        game.currentQuestion = pickQuestion(cell.type)
        game.status = 'cell_action'
      } else if (cell.type === 'lucky') {
        game.luckyEffect = cell.luckyEffect
        game.status = 'lucky'
      } else {
        game.status = 'cell_action'
      }
      broadcast()
    }, Math.max(600, steps * 320))
  }

  socket.on('host:movePiece', () => {
    // 手动兜底：万一自动移动没触发，主持人可手动补一次
    if (game.status === 'rolled') doMove()
  })

  // 答题流程
  socket.on('host:startQuiz', () => {
    if (game.status !== 'cell_action' || !game.currentQuestion) return
    game.votes = { A: 0, B: 0, C: 0, D: 0 }
    game.votedBySocket = {}
    // 重置所有 socket 的投票标记
    io.sockets.sockets.forEach(s => { s.data.hasVoted = false })
    game.status = 'quiz_open'
    game.quizTimerEndsAt = Date.now() + 15000
    setEvent('quiz', `答题开始：${game.currentQuestion.question}`)
    broadcast()
    // 15 秒自动关闭
    clearTimeout(quizTimer)
    quizTimer = setTimeout(() => {
      if (game.status === 'quiz_open') {
        game.status = 'quiz_closed'
        broadcast()
      }
    }, 15000)
  })

  socket.on('host:endVoting', () => {
    if (game.status !== 'quiz_open') return
    game.status = 'quiz_closed'
    broadcast()
  })

  socket.on('host:revealAnswer', () => {
    if (game.status !== 'quiz_closed') return
    // 统计最高票选项；平票视为失败
    const v = game.votes
    const entries = Object.entries(v).sort((a, b) => b[1] - a[1])
    let teamAnswer = entries[0][0]
    let tie = false
    if (entries.length >= 2 && entries[0][1] === entries[1][1] && entries[0][1] > 0) tie = true
    const correct = !tie && teamAnswer === game.currentQuestion.answer
    game.revealAnswer = JSON.stringify({
      teamAnswer, tie, correct,
      correctAnswer: game.currentQuestion.answer,
      votes: { ...v },
    })
    game.status = 'answer_revealed'
    const team = game.teams[game.currentTeam]
    team.answered += 1
    if (correct) team.correct += 1
    game.questionStats.push({
      team: game.currentTeam,
      question: game.currentQuestion.question,
      votes: { ...v },
      teamAnswer,
      correctAnswer: game.currentQuestion.answer,
      correct,
      tie,
    })
    broadcast()
  })

  socket.on('host:setManualAnswer', ({ option } = {}) => {
    if (game.status !== 'quiz_closed') return
    const correct = option === game.currentQuestion.answer
    game.revealAnswer = JSON.stringify({
      teamAnswer: option, tie: false, correct,
      correctAnswer: game.currentQuestion.answer,
      votes: { ...game.votes },
      manual: true,
    })
    game.status = 'answer_revealed'
    const team = game.teams[game.currentTeam]
    team.answered += 1
    if (correct) team.correct += 1
    broadcast()
  })

  // 答对后应用奖励步数
  socket.on('host:applyBonus', () => {
    if (game.status !== 'answer_revealed') return
    const revealed = JSON.parse(game.revealAnswer)
    if (!revealed.correct) {
      game.status = 'cell_action'
      game.currentQuestion = null
      game.revealAnswer = ''
      broadcast()
      return
    }
    const reward = game.currentQuestion.reward
    const t = game.currentTeam
    const team = game.teams[t]
    if (!team.locked) {
      team.position = Math.min(team.position + reward, BOARD_LEN - 1)
      team.bonusSteps += reward
      if (team.position >= BOARD_LEN - 1) team.locked = true
    }
    setEvent('bonus', `答对！${team.name} +${reward} 格`)
    game.status = 'cell_action'
    game.currentQuestion = null
    game.revealAnswer = ''
    broadcast()
  })

  // 幸运格
  socket.on('host:triggerLucky', () => {
    if (game.status !== 'lucky') return
    const eff = game.luckyEffect
    const t = game.currentTeam
    const team = game.teams[t]
    let text = ''
    if (eff === 'advance_3' && !team.locked) {
      team.position = Math.min(team.position + 3, BOARD_LEN - 1)
      team.bonusSteps += 3
      text = '幸运格：前进 3 格！'
    } else if (eff === 'advance_2' && !team.locked) {
      team.position = Math.min(team.position + 2, BOARD_LEN - 1)
      team.bonusSteps += 2
      text = '幸运格：前进 2 格！'
    } else if (eff === 'back_2' && !team.locked) {
      team.position = Math.max(0, team.position - 2)
      text = '幸运格：后退 2 格…'
    } else if (eff === 'roll_again') {
      text = '幸运格：再掷一次！'
      // 同一队立即再投一次（状态回到 awaiting_roll，主持人点投骰子即可）
      game.luckyEffect = null
      game.status = 'awaiting_roll'
      setEvent('lucky', text)
      broadcast()
      return
    }
    if (team.position >= BOARD_LEN - 1) team.locked = true
    setEvent('lucky', text)
    game.luckyEffect = null
    game.status = 'cell_action'
    broadcast()
  })

  // 下一队 / 下一轮
  socket.on('host:nextTeam', () => {
    if (!['cell_action', 'answer_revealed'].includes(game.status) && game.status !== 'lucky') return
    game.currentQuestion = null
    game.revealAnswer = ''
    game.votes = { A: 0, B: 0, C: 0, D: 0 }

    const idx = TEAM_ORDER.indexOf(game.currentTeam)
    if (idx < TEAM_ORDER.length - 1) {
      game.currentTeam = TEAM_ORDER[idx + 1]
    } else {
      // 本轮结束
      if (game.round >= game.totalRounds) {
        game.rankings = computeRankings()
        game.status = 'finished'
        setEvent('finished', '游戏结束！')
        broadcast()
        return
      }
      game.round += 1
      game.currentTeam = TEAM_ORDER[0]
    }
    game.turnIndex += 1
    game.status = 'awaiting_roll'
    broadcast()
  })

  socket.on('host:endGame', () => {
    game.rankings = computeRankings()
    game.status = 'finished'
    setEvent('finished', '游戏结束！')
    broadcast()
  })

  // 手动修正棋子位置
  socket.on('host:manualMove', ({ team, delta } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    const t = game.teams[team]
    t.position = Math.max(0, Math.min(BOARD_LEN - 1, t.position + (delta | 0)))
    broadcast()
  })

  socket.on('host:setPosition', ({ team, position } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    game.teams[team].position = Math.max(0, Math.min(BOARD_LEN - 1, position | 0))
    broadcast()
  })

  socket.on('host:setRepresentative', ({ team, name, years } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    game.representatives[team] = { name: name || '', years: years || '' }
    broadcast()
  })

  socket.on('host:reset', () => {
    game = freshState()
    broadcast()
  })
})

let quizTimer = null

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎲 玩具反斗城 20周年大富翁 服务端已启动`)
  console.log(`   游戏服务 (Socket.IO): http://0.0.0.0:${PORT}`)
})
