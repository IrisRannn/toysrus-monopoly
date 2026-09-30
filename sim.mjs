// 棋盘落点模拟：统计完整游戏中「反斗知识」(quiz+challenge) 的触发率
// 用法: node sim.mjs <答对率0-1> <局数>
const QUIZ_RATE = process.argv[2] ? parseFloat(process.argv[2]) : 0.6
const GAMES = process.argv[3] ? parseInt(process.argv[3]) : 1000

// 格子类型配置（28格路径，0起点 27终点）——调整这里
// quiz 反斗知识 / challenge 超级挑战 / lucky 幸运格 / normal 普通 / start / end
const CELLS = [
  'start',     // 0
  'quiz',      // 1
  'normal',    // 2
  'quiz',      // 3
  'quiz',      // 4
  'quiz',      // 5
  'lucky',     // 6 roll_again
  'quiz',      // 7
  'quiz',      // 8
  'quiz',      // 9
  'quiz',      // 10
  'lucky',     // 11 advance_3
  'quiz',      // 12
  'quiz',      // 13
  'quiz',      // 14
  'challenge', // 15
  'quiz',      // 16
  'quiz',      // 17
  'lucky',     // 18 back_2
  'quiz',      // 19
  'quiz',      // 20
  'quiz',      // 21
  'quiz',      // 22
  'quiz',      // 23
  'normal',    // 24
  'quiz',      // 25
  'quiz',      // 26
  'end',       // 27
]
const LUCKY_EFFECT = {
  6: 'roll_again',
  11: 'advance_3',
  18: 'back_2',
}
const LEN = CELLS.length
const REWARD = { quiz: 3, challenge: 5 }
const TEAMS = ['east', 'west', 'central', 'north', 'shanghai']
const ROUNDS = 3

function rollDie() { return 1 + Math.floor(Math.random() * 6) }

function playOneGame() {
  let quizCount = 0   // 触发反斗知识的停靠
  let stopCount = 0   // 总停靠数
  const positions = { east: 0, west: 0, central: 0, north: 0, shanghai: 0 }

  for (let round = 1; round <= ROUNDS; round++) {
    for (const team of TEAMS) {
      let pos = positions[team]
      let extraRolls = 0 // roll_again 保护（防死循环）
      for (;;) {
        // 投骰（本轮第一次必然投；roll_again 后继续投）
        const step = rollDie()
        pos = Math.min(pos + step, LEN - 1)
        stopCount++
        const cell = CELLS[pos]
        if (cell === 'quiz' || cell === 'challenge') {
          quizCount++
          // 答题：答对则奖励移动（不重新判定落点）
          if (Math.random() < QUIZ_RATE) {
            pos = Math.min(pos + REWARD[cell], LEN - 1)
          }
          break
        } else if (cell === 'lucky') {
          const eff = LUCKY_EFFECT[pos]
          if (eff === 'roll_again') {
            if (++extraRolls > 5) break // 防极端死循环
            continue // 再投一次
          } else if (eff === 'advance_3') {
            pos = Math.min(pos + 3, LEN - 1)
          } else if (eff === 'back_2') {
            pos = Math.max(0, pos - 2)
          }
          break
        } else {
          break // start/normal/end
        }
      }
      positions[team] = pos
    }
  }
  return { quizCount, stopCount }
}

// 跑多局
let totalQuiz = 0, totalStop = 0
for (let g = 0; g < GAMES; g++) {
  const r = playOneGame()
  totalQuiz += r.quizCount
  totalStop += r.stopCount
}
const rate = (totalQuiz / totalStop * 100).toFixed(1)
console.log(`答对率=${QUIZ_RATE} 局数=${GAMES}`)
console.log(`总停靠=${totalStop} 反斗知识停靠=${totalQuiz} 触发率=${rate}%`)
// 每队平均触发次数
const perTeamQuiz = (totalQuiz / GAMES / TEAMS.length).toFixed(1)
console.log(`平均每队每局触发答题次数: ${perTeamQuiz}`)
console.log(`平均每局总答题次数: ${(totalQuiz / GAMES).toFixed(1)}`)
console.log(`目标: 75%-80%`)
