export function calculatePoolDropTarget({
  pointerClientY,
  timelineTop,
  timelineScrollTop = 0,
  timelineStartMinutes,
  timelineEndMinutes,
  pxPerMinute,
  durationMinutes,
}) {
  const values = [
    pointerClientY,
    timelineTop,
    timelineScrollTop,
    timelineStartMinutes,
    timelineEndMinutes,
    pxPerMinute,
    durationMinutes,
  ].map(Number);
  if (!values.every(Number.isFinite) || pxPerMinute <= 0 || durationMinutes < 0) return null;

  [pointerClientY, timelineTop, timelineScrollTop, timelineStartMinutes, timelineEndMinutes, pxPerMinute, durationMinutes] = values;

  const latestStart = timelineEndMinutes - durationMinutes;
  if (latestStart < timelineStartMinutes) return null;

  const relativeY = pointerClientY - timelineTop + timelineScrollTop;
  const snappedStart = Math.round((timelineStartMinutes + relativeY / pxPerMinute) / 5) * 5;
  const start = Math.max(timelineStartMinutes, Math.min(snappedStart, latestStart));
  const end = start + durationMinutes;

  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}
