// 玩具反斗城 20周年全员大富翁 —— 服务端（5队版）
// 单一游戏状态源：大屏 / 主持人 / 手机三端都监听这里的 gameState。
// 双骰子流程：
//   - 东区/西区/中南区/北区（线上）：员工代表在手机端点【投骰子】，服务端生成1-6，棋子自动移动
//   - 上海Office（线下）：代表现场掷实体骰子后在手机端提交点数，等主持人点【移动】才走棋
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
const TEAM_ORDER = ['east', 'west', 'central', 'north', 'shanghai']
const TEAM_NAMES = {
  east: '东区', west: '西区', central: '中南区', north: '北区', shanghai: '上海Office',
}
const TEAM_COLORS = {
  east: '#e03131', west: '#2b8a3e', central: '#f08c00', north: '#1971c2', shanghai: '#9c36b5',
}
// 线上四区用电子骰子自动走棋；上海Office用实体骰子等主持人确认
const ONLINE_TEAMS = ['east', 'west', 'central', 'north']

// ---------------------------------------------------------------------------
// 棋盘 28 格（0=起点，27=终点）。坐标为相对于棋盘图片的百分比 (x%, y%)。
// 坐标依据上传的 board.png (2156x1214) 实测标定，与已完成棋盘视觉一致。
// 类型分布经 2000 局模拟调优：反斗知识触发率约 77%-78%（目标 75%-80%）。
//   quiz=20 challenge=1 lucky=3 normal=2 start=1 end=1
// type: start | normal | quiz | challenge | lucky | end
// luckyEffect: 'roll_again' | 'advance_2' | 'advance_3' | 'back_2'
// ---------------------------------------------------------------------------
const BOARD = [
  { id: 0,  type: 'start',    x: 8.5,  y: 86,   label: '起点' },
  { id: 1,  type: 'quiz',     x: 17.8, y: 86,   label: '反斗知识' },
  { id: 2,  type: 'normal',   x: 27.5, y: 86,   label: '2' },
  { id: 3,  type: 'quiz',     x: 37.2, y: 86,   label: '反斗知识' },
  { id: 4,  type: 'quiz',     x: 46.2, y: 86,   label: '反斗知识' },
  { id: 5,  type: 'quiz',     x: 55.8, y: 86,   label: '反斗知识' },
  { id: 6,  type: 'lucky',    x: 65.0, y: 86,   label: '再掷一次', luckyEffect: 'roll_again' },
  { id: 7,  type: 'quiz',     x: 73.8, y: 86,   label: '反斗知识' },
  { id: 8,  type: 'quiz',     x: 83.5, y: 86,   label: '反斗知识' },
  { id: 9,  type: 'quiz',     x: 89.5, y: 71.5, label: '反斗知识' },
  { id: 10, type: 'quiz',     x: 89.5, y: 55.5, label: '反斗知识' },
  { id: 11, type: 'lucky',    x: 89.5, y: 39.0, label: '前进三格', luckyEffect: 'advance_3' },
  { id: 12, type: 'quiz',     x: 89.5, y: 23.5, label: '反斗知识' },
  { id: 13, type: 'quiz',     x: 79.5, y: 23.5, label: '反斗知识' },
  { id: 14, type: 'quiz',     x: 69.8, y: 23.5, label: '反斗知识' },
  { id: 15, type: 'challenge',x: 69.8, y: 39.0, label: '超级挑战' },
  { id: 16, type: 'quiz',     x: 69.8, y: 55.5, label: '反斗知识' },
  { id: 17, type: 'quiz',     x: 55.5, y: 71.5, label: '反斗知识' },
  { id: 18, type: 'lucky',    x: 46.5, y: 71.5, label: '后退两格', luckyEffect: 'back_2' },
  { id: 19, type: 'quiz',     x: 38.2, y: 71.5, label: '反斗知识' },
  { id: 20, type: 'quiz',     x: 27.5, y: 55.5, label: '反斗知识' },
  { id: 21, type: 'quiz',     x: 27.5, y: 39.0, label: '反斗知识' },
  { id: 22, type: 'quiz',     x: 27.5, y: 23.5, label: '反斗知识' },
  { id: 23, type: 'quiz',     x: 17.8, y: 23.5, label: '反斗知识' },
  { id: 24, type: 'normal',   x: 8.5,  y: 23.5, label: '24' },
  { id: 25, type: 'quiz',     x: 8.5,  y: 39.0, label: '反斗知识' },
  { id: 26, type: 'quiz',     x: 8.5,  y: 55.5, label: '反斗知识' },
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
    bonusSteps: 0,     // 答题/幸运累计奖励步
    locked: false,     // 是否已到达终点锁定排名
    correct: 0,        // 答对题数
    answered: 0,       // 答题次数
    members: 0,        // 加入手机端的员工数
  }
}

function freshRepState() {
  return {
    name: '',
    years: '',
    claimed: false,    // 本轮是否已产生代表
    socketId: null,    // 代表 socket（服务端权限校验用）
  }
}

function freshState() {
  return {
    status: 'idle',    // idle | awaiting_dice | rolling | dice_result | awaiting_host_move | moving | cell_action | quiz_open | quiz_closed | answer_revealed | lucky | finished
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    currentTeam: 'east',
    turnIndex: 0,      // 0..14（5队×3轮）
    dice: { value: 0, rolling: false, source: 'online' },  // source: online | physical
    teams: {},
    representatives: {},
    currentQuestion: null,
    questionPool: shuffle([...QUESTIONS]),
    questionIdx: 0,
    votes: { A: 0, B: 0, C: 0, D: 0 },
    votedBySocket: {},
    quizTimerEndsAt: 0,
    revealAnswer: '',
    luckyEffect: null,
    lastEvent: null,
    questionStats: [],
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
// 构造 5 队
for (const t of TEAM_ORDER) {
  game.teams[t] = { ...freshTeamState(), name: TEAM_NAMES[t] }
  game.representatives[t] = freshRepState()
}

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
  if (process.env.TRACE) {
    const t = game.teams[game.currentTeam]
    console.log('[T]', game.status, game.currentTeam, 'round', game.round, 'pos', t?.position, 'locked', t?.locked, 'q', game.currentQuestion?.id, 'rep', JSON.stringify(game.representatives[game.currentTeam]))
  }
  io.emit('state:update', publicState())
}

function publicState() {
  // 对外暴露：代表只给 name/years/claimed，不给 socketId
  const reps = {}
  for (const t of TEAM_ORDER) {
    reps[t] = { name: game.representatives[t].name, years: game.representatives[t].years, claimed: game.representatives[t].claimed }
  }
  return {
    status: game.status,
    round: game.round,
    totalRounds: game.totalRounds,
    currentTeam: game.currentTeam,
    turnIndex: game.turnIndex,
    dice: game.dice,
    diceSource: game.dice.source,
    teams: game.teams,
    representatives: reps,
    teamNames: TEAM_NAMES,
    teamColors: TEAM_COLORS,
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

function currentTeamName() { return TEAM_NAMES[game.currentTeam] }
function currentTeamObj() { return game.teams[game.currentTeam] }
function isOnlineTeam() { return ONLINE_TEAMS.includes(game.currentTeam) }
function isCurrentRep(socket) {
  return game.representatives[game.currentTeam].socketId === socket.id
}

function pickQuestion(type) {
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
  arr.sort((a, b) => {
    const aEnd = a.position >= BOARD_LEN - 1
    const bEnd = b.position >= BOARD_LEN - 1
    if (aEnd && bEnd) return b.bonusSteps - a.bonusSteps
    if (aEnd) return -1
    if (bEnd) return 1
    if (b.position !== a.position) return b.position - a.position
    return b.bonusSteps - a.bonusSteps
  })
  // 抽奖名额总计 70：25 / 15 / 10 / 10 / 10
  const prizes = [25, 15, 10, 10, 10]
  return arr.map((a, i) => ({ ...a, rank: i + 1, lotterySlots: prizes[i] }))
}

// ---------------------------------------------------------------------------
// 棋子移动核心：从 dice_result / awaiting_host_move 触发，移动后判定落点
// 移动动画按 steps*0.32s 完成后再判断格子类型
// ---------------------------------------------------------------------------
function doMove() {
  if (game.status !== 'dice_result' && game.status !== 'awaiting_host_move' && game.status !== 'moving') return
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
  const genD = game.generation
  setTimeout(() => { if (game.generation !== genD) return; resolveLanding() }, Math.max(600, steps * 320))
}

// 落点判定：答题格/超级挑战 → cell_action(主持人开始答题)；幸运格 → lucky；其余 → cell_action
function resolveLanding() {
  const team = game.teams[game.currentTeam]
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
}

io.on('connection', (socket) => {
  socket.emit('state:update', publicState())

  // ---------------- 员工手机端 ----------------
  socket.on('employee:join', ({ team } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    game.teams[team].members += 1
    socket.data.team = team
    broadcast()
  })

  // 成为本轮投骰子代表（服务端控制：仅当前队伍成员，仅本轮未产生代表，先到先得）
  socket.on('employee:claimRepresentative', ({ name, years } = {}) => {
    if (socket.data.team !== game.currentTeam) {
      socket.emit('rep:ack', { ok: false, reason: 'not_current_team' })
      return
    }
    const rep = game.representatives[game.currentTeam]
    if (rep.claimed) {
      socket.emit('rep:ack', { ok: false, reason: 'already_claimed' })
      return
    }
    rep.claimed = true
    rep.name = (name || '').toString().trim().slice(0, 20)
    rep.years = (years || '').toString().trim().slice(0, 10)
    rep.socketId = socket.id
    socket.data.isRepresentative = true
    socket.emit('rep:ack', { ok: true, name: rep.name, years: rep.years })
    setEvent('rep', `${TEAM_NAMES[game.currentTeam]} 代表：${rep.name || '（未填姓名）'}${rep.years ? ' / ' + rep.years : ''}`)
    broadcast()
  })

  // 员工投票：仅当前答题队伍的成员可投，每 socket 每题一次（服务端统计）
  socket.on('employee:vote', ({ option } = {}) => {
    if (game.status !== 'quiz_open') return
    if (socket.data.team !== game.currentTeam) return
    if (socket.data.hasVoted) return
    socket.data.hasVoted = true
    if (['A', 'B', 'C', 'D'].includes(option)) game.votes[option] += 1
    broadcast()
  })

  // 线上四区：代表点击投骰子，服务端生成 1-6
  socket.on('employee:rollDice', () => {
    if (!isOnlineTeam()) { console.log('[rollDice] blocked: not online', socket.data.team, 'cur=', game.currentTeam); return }
    if (game.status !== 'awaiting_dice') { console.log('[rollDice] blocked: status=', game.status, 'team=', socket.data.team, 'rep=', JSON.stringify(game.representatives[socket.data.team])); return }
    if (!isCurrentRep(socket)) {
      socket.emit('roll:ack', { ok: false, reason: 'not_representative' })
      return
    }
    // 防重复：一旦开始投骰，状态离开 awaiting_dice，按钮即锁定
    game.dice.rolling = true
    game.dice.value = 0
    game.dice.source = 'online'
    game.status = 'rolling'
    broadcast()
    socket.emit('roll:ack', { ok: true })
    // 1.6s 滚动动画后定骰
    const genA = game.generation
    setTimeout(() => {
      if (game.generation !== genA) return
      game.dice.value = 1 + Math.floor(Math.random() * 6)
      game.dice.rolling = false
      game.status = 'dice_result'
      setEvent('dice', `${currentTeamName()} 投出 ${game.dice.value} 点`)
      broadcast()
      // 展示 0.9s 后自动移动棋子（主持人无需介入）
      const genB = game.generation
      setTimeout(() => { if (game.generation !== genB) return; doMove() }, 900)
    }, 1600)
  })

  // 上海Office：代表提交实体骰子实际点数（现场掷出后选择 1-6）
  socket.on('employee:submitPhysicalDice', ({ value } = {}) => {
    if (game.currentTeam !== 'shanghai') { console.log('[submitPhys] blocked: not shanghai turn', game.currentTeam); return }
    if (game.status !== 'awaiting_dice') { console.log('[submitPhys] blocked: status=', game.status); return }
    if (!isCurrentRep(socket)) {
      socket.emit('roll:ack', { ok: false, reason: 'not_representative' })
      return
    }
    const v = parseInt(value, 10)
    if (![1, 2, 3, 4, 5, 6].includes(v)) return
    game.dice.value = v
    game.dice.rolling = false
    game.dice.source = 'physical'
    game.status = 'dice_result'
    socket.emit('roll:ack', { ok: true })
    setEvent('dice', `上海Office 实体骰子投出 ${v} 点，等待主持人移动`)
    broadcast()
    // 上海Office 不自动移动 → 进入等待主持人确认
    game.status = 'awaiting_host_move'
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
    game.generation = (game.generation || 0) + 1
    for (const t of TEAM_ORDER) {
      game.teams[t] = { ...freshTeamState(), name: TEAM_NAMES[t] }
      game.representatives[t] = freshRepState()
    }
    game.status = 'awaiting_dice'
    setEvent('start', '游戏开始！请东区选出本轮投骰子代表')
    broadcast()
  })

  // 主持人确认上海Office实体骰子移动
  socket.on('host:confirmPhysicalMove', () => {
    if (game.status !== 'awaiting_host_move') return
    if (game.currentTeam !== 'shanghai') return
    doMove()
  })

  // 应急兜底：主持人手动触发移动（线上自动移动异常时才用）
  socket.on('host:movePiece', () => {
    if (game.status === 'dice_result') doMove()
  })

  // 答题流程
  socket.on('host:startQuiz', () => {
    if (game.status !== 'cell_action' || !game.currentQuestion) return
    game.votes = { A: 0, B: 0, C: 0, D: 0 }
    game.votedBySocket = {}
    io.sockets.sockets.forEach(s => { s.data.hasVoted = false })
    game.status = 'quiz_open'
    game.quizTimerEndsAt = Date.now() + 15000
    setEvent('quiz', `答题开始：${game.currentQuestion.question}`)
    broadcast()
    clearTimeout(quizTimer)
    const genQ = game.generation
    quizTimer = setTimeout(() => {
      if (game.generation !== genQ) return
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
    // 答对：延时 1.8s 自动执行奖励移动（无需主持人再点）；答错：延时后进入下一队待命
    const genR = game.generation
    setTimeout(() => {
      if (game.generation !== genR || game.status !== 'answer_revealed') return
      const r = JSON.parse(game.revealAnswer)
      if (r.correct) {
        applyBonusReward()
      } else {
        game.currentQuestion = null
        game.revealAnswer = ''
        game.status = 'cell_action'
        broadcast()
      }
    }, 1800)
  })

  // 答对奖励移动：自动执行（主持人端保留手动按钮作为应急）
  function applyBonusReward() {
    if (game.status !== 'answer_revealed') return
    const reward = game.currentQuestion.reward
    const t = game.currentTeam
    const team = game.teams[t]
    if (!team.locked) {
      team.position = Math.min(team.position + reward, BOARD_LEN - 1)
      team.bonusSteps += reward
      if (team.position >= BOARD_LEN - 1) team.locked = true
    }
    setEvent('bonus', `答对！${team.name} +${reward} 格`)
    game.status = 'moving'
    broadcast()
    const genB2 = game.generation
    setTimeout(() => {
      if (game.generation !== genB2) return
      game.currentQuestion = null
      game.revealAnswer = ''
      game.status = 'cell_action'
      broadcast()
    }, reward * 320 + 500)
  }

  // 主持人手动应用奖励（应急，防止自动未触发）
  socket.on('host:applyBonus', () => {
    applyBonusReward()
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
    const genM = game.generation
    setTimeout(() => {
      if (game.generation !== genM || game.status !== 'answer_revealed') return
      const r = JSON.parse(game.revealAnswer)
      if (r.correct) {
        applyBonusReward()
      } else {
        game.currentQuestion = null
        game.revealAnswer = ''
        game.status = 'cell_action'
        broadcast()
      }
    }, 1800)
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
      // 再投一次：同一队代表再次投骰（线上=点投骰子，上海=重新提交实体骰子）
      text = '幸运格：再掷一次！'
      game.luckyEffect = null
      game.status = 'awaiting_dice'
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
    let nextTeam
    if (idx < TEAM_ORDER.length - 1) {
      nextTeam = TEAM_ORDER[idx + 1]
    } else {
      if (game.round >= game.totalRounds) {
        game.rankings = computeRankings()
        game.status = 'finished'
        setEvent('finished', '游戏结束！')
        broadcast()
        return
      }
      game.round += 1
      nextTeam = TEAM_ORDER[0]
    }
    game.currentTeam = nextTeam
    game.turnIndex += 1
    // 新一轮队伍代表资格重置（先到先得，服务端控制）
    game.representatives[nextTeam].claimed = false
    game.representatives[nextTeam].socketId = null
    game.representatives[nextTeam].name = ''
    game.representatives[nextTeam].years = ''
    game.status = 'awaiting_dice'
    setEvent('next', `${TEAM_NAMES[nextTeam]} 回合开始，请选出本轮投骰子代表`)
    broadcast()
  })

  socket.on('host:endGame', () => {
    game.rankings = computeRankings()
    game.status = 'finished'
    setEvent('finished', '游戏结束！')
    broadcast()
  })

  // 手动修正
  socket.on('host:manualMove', ({ team, delta } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    game.teams[team].position = Math.max(0, Math.min(BOARD_LEN - 1, game.teams[team].position + (delta | 0)))
    broadcast()
  })

  socket.on('host:setPosition', ({ team, position } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    game.teams[team].position = Math.max(0, Math.min(BOARD_LEN - 1, position | 0))
    broadcast()
  })

  // 主持人修改代表信息（应急）
  socket.on('host:setRepresentative', ({ team, name, years } = {}) => {
    if (!TEAM_ORDER.includes(team)) return
    const rep = game.representatives[team]
    if (name !== undefined) rep.name = String(name).slice(0, 20)
    if (years !== undefined) rep.years = String(years).slice(0, 10)
    rep.claimed = true
    broadcast()
  })

  // 管理员修改实体骰子结果（录入错误时用）
  socket.on('host:setPhysicalDice', ({ value } = {}) => {
    const v = parseInt(value, 10)
    if (![1, 2, 3, 4, 5, 6].includes(v)) return
    if (game.currentTeam !== 'shanghai') return
    if (game.status !== 'dice_result' && game.status !== 'awaiting_host_move') return
    game.dice.value = v
    game.dice.source = 'physical'
    setEvent('dice', `上海Office 实体骰子结果修改为 ${v} 点`)
    game.status = 'awaiting_host_move'
    broadcast()
  })

  socket.on('host:reset', () => {
    game = freshState()
    for (const t of TEAM_ORDER) {
      game.teams[t] = { ...freshTeamState(), name: TEAM_NAMES[t] }
      game.representatives[t] = freshRepState()
    }
    broadcast()
  })
})

let quizTimer = null

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎲 玩具反斗城 20周年大富翁（5队版）服务端已启动`)
  console.log(`   游戏服务 (Socket.IO): http://0.0.0.0:${PORT}`)
})
