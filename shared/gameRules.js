export const TEAM_ORDER = ["east", "central", "north", "west", "shanghai"];
export const TEAM_INFO = {
  east: { name: "东区", color: "#2F80ED" },
  central: { name: "中南区", color: "#27AE60" },
  north: { name: "北区", color: "#E0A100" },
  west: { name: "西区", color: "#9B51E0" },
  shanghai: { name: "上海SSC", color: "#00B8D9" },
};
export const TILES = [
  [1, "童心发射站", "normal", 0, "🚀"],
  [2, "反斗赛车手", "reward", 2, "🏎️"],
  [3, "成长脚印", "normal", 0, "🌱"],
  [4, "记忆大考验①", "quiz", 3, "❓"],
  [5, "快乐能量耗尽", "penalty", -1, "🔋"],
  [6, "恐龙挡路啦", "penalty", -2, "🦖"],
  [7, "童心收藏馆", "normal", 0, "🏰"],
  [8, "记忆大考验②", "quiz", 3, "❓"],
  [9, "天降玩具盲盒", "reward", 3, "🎁"],
  [10, "十年时光机", "normal", 0, "⏰"],
  [11, "玩具熊迷路啦", "penalty", -2, "🧸"],
  [12, "记忆大考验③", "quiz", 3, "❓"],
  [13, "购物车失控", "reward", 5, "🛒"],
  [14, "玩具零件丢失", "penalty", -2, "🧩"],
  [15, "终极周年挑战", "quiz", 20, "🏆"],
  [16, "记忆大考验④", "quiz", 3, "❓"],
  [17, "幸运杰菲星", "reward", 2, "🌟"],
  [18, "下一站未来", "normal", 0, "🏰"],
  [19, "终点加速器", "reward", 1, "🏁"],
  [20, "20周年荣耀殿堂", "finish", 0, "👑"],
].map(([id, name, type, effect, icon]) => ({ id, name, type, effect, icon }));
export const QUIZ_TILES = [4, 8, 12, 15, 16];
export const clampPosition = (p) => Math.max(0, Math.min(20, p));
export function landing(position) {
  return TILES.find((t) => t.id === position);
}
export function destination(position, delta) {
  return clampPosition(position + delta);
}
export function tally(answers, correct) {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const answer of Object.values(answers))
    if (Object.hasOwn(counts, answer.option)) counts[answer.option]++;
  const maximum = Math.max(...Object.values(counts));
  const leaders = Object.keys(counts).filter((k) => counts[k] === maximum);
  const majority = maximum > 0 && leaders.length === 1 ? leaders[0] : null;
  return {
    counts,
    submitted: Object.values(counts).reduce((a, b) => a + b, 0),
    majority,
    tie: maximum > 0 && leaders.length > 1,
    correct: majority !== null && majority === correct,
    correctAnswer: correct,
  };
}
export function rankings(teams) {
  const sorted = Object.values(teams).sort((a, b) => {
    if (a.finishOrder && b.finishOrder) return a.finishOrder - b.finishOrder;
    if (a.finishOrder) return -1;
    if (b.finishOrder) return 1;
    return b.position - a.position;
  });
  let rank = 1;
  return sorted.map((t, i) => {
    if (
      i === 0 ||
      t.finishOrder ||
      sorted[i - 1].finishOrder ||
      t.position !== sorted[i - 1].position
    )
      rank = i + 1;
    return { ...t, rank };
  });
}
