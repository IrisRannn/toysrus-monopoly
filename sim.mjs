// 模拟：真实28格 + 加权骰子，统计"反斗知识"和"特殊格"的实际触发率
const BOARD = [
  'start','normal','quiz','normal','quiz','normal','lucky','normal','quiz',
  'normal','normal','lucky',
  'normal','normal','normal','quiz','normal','normal','lucky','normal','lucky',
  'normal','normal','normal','lucky','normal','normal','end'
]
// lucky 效果：6=roll_again, 11=advance_3, 18=back_2, 20=advance_3, 24=advance_3
const LUCKY = { 6:'roll_again', 11:'advance_3', 18:'back_2', 20:'advance_3', 24:'advance_3' }
const L = BOARD.length
const W_SPECIAL = 0.22, W_NORMAL = 0.06

function weighted(pos) {
  const w = []
  for (let d=1; d<=6; d++) {
    const t = Math.min(pos+d, L-1)
    w.push(BOARD[t]==='quiz' || BOARD[t]==='lucky' ? W_SPECIAL : W_NORMAL)
  }
  const sum = w.reduce((a,b)=>a+b,0)
  let r = Math.random()*sum
  for (let d=1; d<=6; d++) { r -= w[d-1]; if (r<=0) return d }
  return 6
}

function simulate(answerRate) {
  // 5队 × 3轮
  const teams = [0,0,0,0,0]
  let landQuiz = 0, landLucky = 0, landNormal = 0, totalLands = 0, bonusMoves = 0
  for (let round=0; round<3; round++) {
    for (let t=0; t<5; t++) {
      let pos = teams[t]
      let guard = 0
      while (guard++ < 6) {
        if (pos >= L-1) break
        const d = weighted(pos)
        pos = Math.min(pos + d, L-1)
        totalLands++
        const type = BOARD[pos]
        if (type === 'quiz') {
          landQuiz++
          if (Math.random() < answerRate) {
            pos = Math.min(pos + 3, L-1)
            bonusMoves++
          }
        } else if (type === 'lucky') {
          landLucky++
          const eff = LUCKY[pos]
          if (eff === 'advance_3') pos = Math.min(pos + 3, L-1)
          else if (eff === 'back_2') pos = Math.max(0, pos - 2)
          else if (eff === 'roll_again') continue  // 再投一次
        } else {
          landNormal++
        }
        break
      }
      teams[t] = pos
    }
  }
  return { landQuiz, landLucky, landNormal, totalLands }
}

for (const rate of [0.4, 0.6, 0.8]) {
  let q=0, l=0, n=0, tot=0
  const N = 2000
  for (let i=0; i<N; i++) {
    const r = simulate(rate)
    q+=r.landQuiz; l+=r.landLucky; n+=r.landNormal; tot+=r.totalLands
  }
  console.log(`答对率=${rate} 局数=${N}`)
  console.log(`  总落点=${tot} 反斗知识=${q}(${ (100*q/tot).toFixed(1)}%) 幸运格=${l}(${ (100*l/tot).toFixed(1)}%) 普通=${n}(${(100*n/tot).toFixed(1)}%)`)
  console.log(`  特殊格合计(反斗知识+幸运)=${(100*(q+l)/tot).toFixed(1)}%，平均每局落点=${(tot/N).toFixed(1)}`)
}
