import { DEFAULT_TRACKERS } from "./trackerDefaults.js";
import { isTrackerConfigured, isValidTrackerTime, resolveTrackerStickerPlacementMode } from "./trackerConfig.js";

const DEFAULT_IDS = new Set(DEFAULT_TRACKERS.map((tracker) => tracker.id));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, stripUndefined(item)]));
}

export function createCustomTracker({ idFactory = () => `tracker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } = {}) {
  return {
    id: idFactory(), title: "", emoji: "✨", enabled: true, requiresSetup: false,
    schedule: { kind: "interval", every: 1, unit: "day" },
    goal: { aggregation: "occurrence", target: 1, unit: "times" },
    evidenceBindings: [],
    stickerSettings: { enabled: false, title: "", emoji: "✨", placementMode: "sticker_bar", time: "", type: "reminder" },
  };
}

export function isDefaultTrackerId(id) {
  return DEFAULT_IDS.has(id);
}

export function trackerScheduleSummary(tracker) {
  const schedule = tracker?.schedule;
  if (!schedule) return "待设置周期";
  if (schedule.kind === "interval") return `每 ${schedule.every || "?"} ${({ day: "天", week: "周", month: "月", year: "年" })[schedule.unit] || ""}`;
  if (schedule.kind === "period") return `每${({ week: "周", month: "月", year: "年" })[schedule.period] || ""}累计`;
  if (schedule.kind === "deadline") return schedule.dueDate ? `截止 ${schedule.dueDate}` : "待设置截止日期";
  return "待设置周期";
}

export function trackerGoalSummary(tracker) {
  const goal = tracker?.goal;
  if (!goal) return "待设置目标";
  const label = { occurrence: "完成次数", active_days: "完成天数", sum: "累计" }[goal.aggregation] || "目标";
  return `${label} ${goal.target || "?"} ${goal.unit || ""}`.trim();
}

export function normalizeTrackerForSave(tracker) {
  const next = clone(tracker || {});
  next.title = String(next.title || "").trim();
  next.emoji = String(next.emoji || "").trim();
  next.enabled = next.enabled !== false;
  next.evidenceBindings = Array.isArray(next.evidenceBindings) ? next.evidenceBindings.filter((binding) => binding?.type) : [];
  next.stickerSettings = {
    enabled: next.stickerSettings?.enabled === true,
    title: String(next.stickerSettings?.title || "").trim(),
    emoji: String(next.stickerSettings?.emoji || "").trim(),
    placementMode: resolveTrackerStickerPlacementMode(next.stickerSettings),
    time: typeof next.stickerSettings?.time === "string" ? next.stickerSettings.time : "",
    type: next.stickerSettings?.type === "completion" ? "completion" : "reminder",
  };
  next.requiresSetup = !isTrackerConfigured(next);
  return stripUndefined(next);
}

export function validateTrackerDrafts(trackers) {
  const errors = [];
  for (const tracker of Array.isArray(trackers) ? trackers : []) {
    const normalized = normalizeTrackerForSave(tracker);
    if (!normalized.id) errors.push("存在缺少 ID 的追踪项。");
    if (!normalized.title) errors.push("追踪项标题不能为空。");
    if (!normalized.emoji) errors.push(`${normalized.title || "追踪项"}需要 emoji。`);
    if (!isDefaultTrackerId(normalized.id) && (!normalized.schedule || !normalized.goal)) errors.push(`${normalized.title || "自定义追踪项"}需要周期和目标。`);
    if (normalized.stickerSettings.enabled && normalized.stickerSettings.placementMode === "timeline" && !isValidTrackerTime(normalized.stickerSettings.time)) errors.push(`${normalized.title || "追踪项"}的时间轴贴纸需要合法 HH:mm 时间。`);
  }
  return [...new Set(errors)];
}

// Persist only explicit user overrides/custom items. Missing defaults remain
// code/legacy-resolved on the next load, so editing one item never writes or
// overwrites healthMaintenanceItems/reviewTrackers.
export function buildTrackersForProfileSave({ initialEffective = [], editedEffective = [], storedTrackers = [] } = {}) {
  const initialById = new Map(initialEffective.map((tracker) => [tracker.id, normalizeTrackerForSave(tracker)]));
  const storedIds = new Set((storedTrackers || []).map((tracker) => tracker?.id));
  return editedEffective.flatMap((tracker) => {
    const normalized = normalizeTrackerForSave(tracker);
    const initial = initialById.get(normalized.id);
    const changed = JSON.stringify(initial) !== JSON.stringify(normalized);
    if (!isDefaultTrackerId(normalized.id) || storedIds.has(normalized.id) || changed) return [normalized];
    return [];
  });
}
