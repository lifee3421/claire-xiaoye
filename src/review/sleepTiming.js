// 00:00–05:59 is treated as "went to bed after midnight" for the purpose of
// auto-prompting a late-sleep reason. This is a display-only heuristic, not
// a schema change — sleep.yesterday.bedtime keeps storing the raw HH:MM text.
export function isAfterMidnightBedtime(rawTime) {
  const value = String(rawTime || "").trim();
  const match = value.match(/^(\d{2}):(\d{2})$/);

  if (!match) return false;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;

  return hours >= 0 && hours < 6;
}
