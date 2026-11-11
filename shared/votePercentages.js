// Percentages use submitted ballots; unsubmitted employees never enter the denominator.
export function votePercentage(counts, key) {
  const values = Object.values(counts);
  const total = values.reduce((sum, count) => sum + count, 0);
  if (!total) return "0%";
  const rounded = (count) => (count / total * 100).toFixed(1);
  const crowded = values.some((a, i) => values.some((b, j) => i < j && a !== b && rounded(a) === rounded(b)));
  return `${Number(((counts[key] || 0) / total * 100).toFixed(crowded ? 2 : 1))}%`;
}
