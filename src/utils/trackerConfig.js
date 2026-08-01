const INTERVAL_UNITS = new Set(["day", "week", "month", "year"]);
const PERIOD_UNITS = new Set(["week", "month", "year"]);
const AGGREGATIONS = new Set(["occurrence", "active_days", "sum"]);

export function isValidTrackerTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// Older saved tracker stickers predate placementMode and were timeline
// reminders. Preserve that meaning while never inventing a time for them.
export function resolveTrackerStickerPlacementMode(settings = {}) {
  return settings?.placementMode === "sticker_bar" ? "sticker_bar" : "timeline";
}

export function hasConfiguredEvidenceBindings(tracker) {
  return Array.isArray(tracker?.evidenceBindings) && tracker.evidenceBindings.some((binding) => binding && typeof binding.type === "string" && binding.type);
}

export function hasCompleteTrackerScheduleAndGoal(tracker) {
  const schedule = tracker?.schedule;
  const goal = tracker?.goal;
  if (!schedule || !goal || !AGGREGATIONS.has(goal.aggregation) || !(Number(goal.target) > 0)) return false;
  if (schedule.kind === "interval") return Number(schedule.every) > 0 && INTERVAL_UNITS.has(schedule.unit);
  if (schedule.kind === "period") return PERIOD_UNITS.has(schedule.period);
  if (schedule.kind === "deadline") return typeof schedule.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(schedule.dueDate);
  return false;
}

export function isTrackerConfigured(tracker) {
  return tracker?.requiresSetup !== true && hasConfiguredEvidenceBindings(tracker) && hasCompleteTrackerScheduleAndGoal(tracker);
}

export function isTrackerStickerConfigurationReady(tracker) {
  if (!isTrackerConfigured(tracker) || tracker?.stickerSettings?.enabled !== true) return false;
  return resolveTrackerStickerPlacementMode(tracker.stickerSettings) === "sticker_bar" || isValidTrackerTime(tracker.stickerSettings.time);
}
