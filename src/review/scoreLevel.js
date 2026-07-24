export const LEVEL_TO_SCORE = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 10,
};

export function scoreToLevel(rawScore) {
  const score = Number(rawScore);

  if (!Number.isFinite(score) || score <= 0) return 0;

  return Math.min(5, Math.max(1, Math.ceil(score / 2)));
}
