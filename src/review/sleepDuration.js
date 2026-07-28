function parseClock(value) {
  const match = String(value || "").trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : null;
}

export function formatSleepDuration(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total < 0) return "";
  return `${Math.floor(total / 60)}h${Math.round(total % 60)}min`;
}

/** A blank result is intentionally non-destructive: callers keep any manual value. */
export function calculateSleepDuration({ bedtime, wakeTime } = {}) {
  const bed = parseClock(bedtime);
  const wake = parseClock(wakeTime);
  if (bed === null || wake === null) return { valid: false, reason: "incomplete" };
  let durationMinutes = wake - bed;
  if (durationMinutes < 0) durationMinutes += 24 * 60;
  if (durationMinutes === 0 || durationMinutes > 16 * 60) return { valid: false, reason: "out_of_range" };
  return { valid: true, durationMinutes, durationText: formatSleepDuration(durationMinutes) };
}

export function applyAutomaticSleepDuration(fields = {}) {
  const duration = calculateSleepDuration({ bedtime: fields["sleep.yesterday.bedtime"]?.value, wakeTime: fields["sleep.yesterday.wakeTime"]?.value });
  const current = fields["sleep.yesterday.durationText"] || {};
  if (!duration.valid || current.manuallyEdited === true) return { fields, duration, usedManualValue: current.manuallyEdited === true };
  return { fields: { ...fields, "sleep.yesterday.durationMinutes": { ...(fields["sleep.yesterday.durationMinutes"] || {}), value: duration.durationMinutes, autoValue: duration.durationMinutes, manuallyEdited: false, source: "auto" }, "sleep.yesterday.durationText": { ...current, value: duration.durationText, autoValue: duration.durationText, manuallyEdited: false, source: "auto" } }, duration, usedManualValue: false };
}
