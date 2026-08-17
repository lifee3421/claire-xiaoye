// Pure data model + logic for timeline "stickers" — lightweight, zero-
// duration markers (💊 吃补剂, 🧖 敷面膜, ...) shown on the daily timeline.
// Deliberately separate from the task-block/autoSchedule system: a sticker
// never has a start/end duration, never occupies an interval, never
// conflicts with a task or another sticker, and is never part of
// autoSchedule.blocks/taskSegments — none of the interval/conflict/points
// machinery in App.jsx ever needs to know stickers exist.
//
// Two storage locations:
// - profile.scheduleStickerTemplates: reusable templates (emoji/title/color),
//   never deleted outright — archiving keeps historical instances' emoji/
//   title readable even after a template is retired.
// - draft.stickers: today's placed instances, each pointing at a templateId
//   but carrying its OWN emoji/title/color snapshot (so a later template
//   edit never rewrites history, and an archived template's past instances
//   still render correctly).

import { isValidTrackerTime, resolveTrackerStickerPlacementMode } from "./trackerConfig.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function newId(prefix) {
  return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

// --- Templates (profile-level) ---------------------------------------------

export function createStickerTemplate({ title, emoji, color = "#94a3b8" } = {}) {
  const trimmedTitle = String(title || "").trim();
  if (!trimmedTitle) return null;
  const now = new Date().toISOString();
  return {
    id: newId("sticker-template"),
    title: trimmedTitle,
    emoji: String(emoji || "").trim() || "📌",
    color,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateStickerTemplate(templates, id, patch = {}) {
  return asArray(templates).map((template) =>
    template.id === id ? { ...template, ...patch, updatedAt: new Date().toISOString() } : template
  );
}

// Archiving (never a hard delete) — existing draft.stickers instances keep
// their own emoji/title/color snapshot, so archiving a template never
// changes how a historical instance already rendered.
export function archiveStickerTemplate(templates, id) {
  return updateStickerTemplate(templates, id, { archived: true });
}

export function restoreStickerTemplate(templates, id) {
  return updateStickerTemplate(templates, id, { archived: false });
}

export function listActiveStickerTemplates(templates) {
  return asArray(templates).filter((template) => isRecord(template) && template.archived !== true);
}

export function normalizeStickerTemplates(value) {
  return asArray(value)
    .filter(isRecord)
    .filter((template) => typeof template.id === "string" && template.id)
    .map((template) => ({
      id: template.id,
      title: String(template.title || "").trim() || "贴纸",
      emoji: String(template.emoji || "").trim() || "📌",
      color: typeof template.color === "string" && template.color ? template.color : "#94a3b8",
      archived: template.archived === true,
      createdAt: typeof template.createdAt === "string" ? template.createdAt : "",
      updatedAt: typeof template.updatedAt === "string" ? template.updatedAt : "",
    }));
}

// --- Instances (draft-level, one target date) -------------------------------

// 5-minute snap — same granularity the existing task-pool drop target uses
// (calculatePoolDropTarget), applied here to a single point in time instead
// of a start/end pair.
export function snapStickerMinute(minute) {
  const value = Number(minute);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / 5) * 5);
}

export function createStickerInstance(template, anchorMinute) {
  if (!template?.id) return null;
  const now = new Date().toISOString();
  return {
    id: newId("sticker"),
    templateId: template.id,
    title: template.title,
    emoji: template.emoji,
    color: template.color,
    anchorMinute: snapStickerMinute(anchorMinute),
    status: "pending",
    completedAt: "",
    createdAt: now,
    origin: "manual",
  };
}

function parseTimeToAnchorMinute(time) {
  if (!isValidTrackerTime(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  return snapStickerMinute(hour * 60 + minute);
}

// Auto-generated counterpart to createStickerInstance — built from a
// src/utils/trackerStickers.js planTrackerSticker() "create" decision rather
// than a user-picked template, so it carries origin/trackerId/generationKey/
// stickerType instead of a templateId.
export function createTrackerSticker({ trackerId, generationKey, stickerType, emoji, title, time, placementMode } = {}) {
  if (!trackerId || !generationKey) return null;
  const resolvedPlacementMode = resolveTrackerStickerPlacementMode({ placementMode });
  const anchorMinute = resolvedPlacementMode === "timeline" ? parseTimeToAnchorMinute(time) : null;
  if (resolvedPlacementMode === "timeline" && anchorMinute === null) return null;
  const now = new Date().toISOString();
  return {
    id: newId("sticker"),
    templateId: "",
    title: String(title || "").trim() || "追踪提醒",
    emoji: String(emoji || "").trim() || "⏰",
    color: "#94a3b8",
    anchorMinute,
    placementMode: resolvedPlacementMode,
    status: "pending",
    completedAt: "",
    createdAt: now,
    origin: "tracker",
    trackerId,
    generationKey,
    stickerType: stickerType === "completion" ? "completion" : "reminder",
  };
}

// Idempotent completion (unlike toggleStickerCompletion, which flips):
// used to sync an existing reminder/completion sticker to "done" once the
// tracker itself is confirmed complete — calling this twice in a row is a
// no-op the second time, never un-completes anything.
export function completeStickerInstance(stickers, id) {
  return asArray(stickers).map((sticker) =>
    sticker.id === id ? { ...sticker, status: "completed", completedAt: sticker.completedAt || new Date().toISOString() } : sticker
  );
}

// Applies current Tracker configuration to the same generated instance.
// Its id/generationKey/status remain intact, so timeline <-> bar moves never
// duplicate a reminder or bypass same-day deletion suppression.
export function updateTrackerStickerInstance(stickers, id, plan = {}) {
  const desired = createTrackerSticker(plan);
  if (!desired) return asArray(stickers);
  return asArray(stickers).map((sticker) => sticker.id === id && sticker.origin === "tracker" ? {
    ...sticker,
    title: desired.title,
    emoji: desired.emoji,
    placementMode: desired.placementMode,
    anchorMinute: desired.anchorMinute,
  } : sticker);
}

// Reminder sticker checkboxes are not evidence. If their settlement evidence
// is later retracted, tracker sync uses this to return the same auto sticker
// to its pending presentation state.
export function reopenStickerInstance(stickers, id) {
  return asArray(stickers).map((sticker) =>
    sticker.id === id ? { ...sticker, status: "pending", completedAt: "" } : sticker
  );
}

export function moveStickerInstance(stickers, id, anchorMinute) {
  return asArray(stickers).map((sticker) =>
    sticker.id === id ? { ...sticker, anchorMinute: snapStickerMinute(anchorMinute) } : sticker
  );
}

export function toggleStickerCompletion(stickers, id) {
  return asArray(stickers).map((sticker) => {
    if (sticker.id !== id) return sticker;
    const nextCompleted = sticker.status !== "completed";
    return { ...sticker, status: nextCompleted ? "completed" : "pending", completedAt: nextCompleted ? new Date().toISOString() : "" };
  });
}

export function removeStickerInstance(stickers, id) {
  return asArray(stickers).filter((sticker) => sticker.id !== id);
}

export function countStickerCompletion(stickers) {
  const list = asArray(stickers);
  return { completed: list.filter((sticker) => sticker.status === "completed").length, total: list.length };
}

export function normalizeStickerInstances(value) {
  return asArray(value)
    .filter(isRecord)
    .filter((sticker) => typeof sticker.id === "string" && sticker.id)
    .map((sticker) => ({
      id: sticker.id,
      templateId: typeof sticker.templateId === "string" ? sticker.templateId : "",
      title: String(sticker.title || "").trim() || "贴纸",
      emoji: String(sticker.emoji || "").trim() || "📌",
      color: typeof sticker.color === "string" && sticker.color ? sticker.color : "#94a3b8",
      anchorMinute: sticker.origin === "tracker" && resolveTrackerStickerPlacementMode(sticker) === "sticker_bar" ? null : snapStickerMinute(sticker.anchorMinute),
      placementMode: sticker.origin === "tracker" ? resolveTrackerStickerPlacementMode(sticker) : "timeline",
      status: sticker.status === "completed" ? "completed" : "pending",
      completedAt: typeof sticker.completedAt === "string" ? sticker.completedAt : "",
      createdAt: typeof sticker.createdAt === "string" ? sticker.createdAt : "",
      origin: sticker.origin === "tracker" ? "tracker" : "manual",
      trackerId: typeof sticker.trackerId === "string" ? sticker.trackerId : "",
      generationKey: typeof sticker.generationKey === "string" ? sticker.generationKey : "",
      // Never `undefined` — Firestore rejects undefined field values on write.
      stickerType: sticker.stickerType === "completion" ? "completion" : sticker.origin === "tracker" ? "reminder" : "",
    }));
}
