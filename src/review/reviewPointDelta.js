export function pointDeltaLabel(pointDelta) {
  const delta = Number(pointDelta || 0);
  if (delta === 0) return "本次积分不变";
  return `本次预计 ${delta > 0 ? "+" : ""}${delta} 分`;
}
