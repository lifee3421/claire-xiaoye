// Auto-sticker closed loop for the unified tracker fact layer:
// TrackerFacts -> due_today/overdue/behind -> create today's planner sticker
// -> same tracker+day never generates twice -> manual delete suppresses
// regeneration for that day only -> a final-review completion syncs the
// sticker back to completed. Pure decision logic only — no Firestore, no
// React, no draft-persistence mechanics beyond returning a plain patched
// draft object; App.jsx supplies the current draft/tracker/trackerFacts and
// applies the result via its existing commitDraftChange path.
//
// Deliberately generic: nothing here is specific to any one tracker (no
// hardcoded "外婆"/family-contact assumptions). Callers pass a real Tracker
// config (from profile.trackers, or a test fixture) and its already-resolved
// TrackerFacts (see src/utils/trackerFacts.js's resolveTrackerEvidence).
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function buildStickerGenerationKey(trackerId, localDate) {
  return `${trackerId}:${localDate}`;
}

// Which scheduleStatus values warrant a reminder TODAY. Deliberately
// schedule-kind-aware, not a flat status list: a period tracker's "overdue"
// means its window already closed (reminding "today" makes no sense — the
// next period's own status will pick up from upcoming), whereas an
// interval/deadline tracker's "overdue" is exactly the case that needs
// nagging. "sum"-aggregation period trackers never produce "behind" at all
// (see trackerFacts.js's scheduleStatusForPeriod — behind is only computed
// for active_days), so no separate branch is needed to keep sum trackers
// from getting inferred daily-pace reminders: only their unambiguous
// due_today (the period's actual last day) can ever match here.
export function shouldRemindToday(tracker, trackerFacts) {
  const kind = tracker?.schedule?.kind;
  const status = trackerFacts?.scheduleStatus;
  if (kind === "interval" || kind === "deadline") return status === "due_today" || status === "overdue";
  if (kind === "period") return status === "due_today" || status === "behind";
  return false;
}

export function findStickerByGenerationKey(stickers, generationKey) {
  return asArray(stickers).find((sticker) => sticker.generationKey === generationKey) || null;
}

export function isGenerationKeySuppressed(suppressedGenerationKeys, generationKey) {
  return asArray(suppressedGenerationKeys).includes(generationKey);
}

// Prunes to only today's entries before adding the new one — this is what
// makes "手动删除后当天不再生成，次日可以恢复" work without a separate
// scheduled cleanup job: a suppression from a prior day is structurally
// unable to survive past that day's own write.
export function addSuppressedGenerationKey(suppressedGenerationKeys, generationKey, localDate) {
  const keepToday = asArray(suppressedGenerationKeys).filter((key) => typeof key === "string" && key.endsWith(`:${localDate}`));
  return keepToday.includes(generationKey) ? keepToday : [...keepToday, generationKey];
}

/**
 * Pure decision: given one tracker + its resolved TrackerFacts + today's
 * existing sticker (if any) for that tracker + today's suppression list,
 * decide what (if anything) should happen to this tracker's sticker today.
 *
 * Returns one of:
 *   { action: "none", reason }
 *   { action: "create", generationKey, trackerId, stickerType, emoji, title, time }
 *   { action: "complete", generationKey, trackerId, stickerId, stickerType }
 */
export function planTrackerSticker({ tracker, trackerFacts, localDate, existingSticker = null, suppressedGenerationKeys = [] } = {}) {
  const settings = tracker?.stickerSettings;
  if (!settings || settings.enabled !== true) return { action: "none", reason: "sticker_disabled" };
  if (!tracker?.id || !localDate) return { action: "none", reason: "missing_identity" };

  const generationKey = buildStickerGenerationKey(tracker.id, localDate);
  const stickerType = settings.type === "completion" ? "completion" : "reminder";

  // Rule 7: a confirmed-complete tracker syncs its ALREADY-EXISTING sticker
  // to completed — this never fabricates a brand-new "completed" sticker
  // out of nowhere; if no reminder was ever shown there is nothing to sync.
  if (trackerFacts?.todayReviewStatus === "confirmed_complete") {
    if (existingSticker && existingSticker.status !== "completed") {
      return { action: "complete", generationKey, trackerId: tracker.id, stickerId: existingSticker.id, stickerType: existingSticker.stickerType || stickerType };
    }
    return { action: "none", reason: "nothing_to_sync" };
  }

  if (!shouldRemindToday(tracker, trackerFacts)) return { action: "none", reason: "not_due" };
  if (existingSticker) return { action: "none", reason: "already_generated" }; // same tracker + same day, idempotent
  if (isGenerationKeySuppressed(suppressedGenerationKeys, generationKey)) return { action: "none", reason: "suppressed" };

  return {
    action: "create",
    generationKey,
    trackerId: tracker.id,
    stickerType,
    emoji: settings.emoji,
    title: settings.title || tracker.title,
    time: settings.time,
  };
}

/**
 * Applies a planTrackerSticker() decision to a draft object, returning a NEW
 * draft (never mutates the input) — App.jsx wraps this in commitDraftChange.
 * `createSticker`/`completeSticker` are injected (from plannerStickers.js)
 * so this module stays free of any concrete sticker-shape assumptions beyond
 * "there's a stickers array and ids".
 */
export function applyTrackerStickerPlan(plan, { draft = {}, createSticker, completeSticker } = {}) {
  if (!plan || plan.action === "none") return draft;
  const stickers = Array.isArray(draft.stickers) ? draft.stickers : [];

  if (plan.action === "create") {
    const instance = createSticker(plan);
    if (!instance) return draft;
    return { ...draft, stickers: [...stickers, instance] };
  }

  if (plan.action === "complete") {
    return { ...draft, stickers: completeSticker(stickers, plan.stickerId) };
  }

  return draft;
}

/**
 * Called from the manual-delete path: if the deleted sticker was
 * tracker-originated, records its generationKey as suppressed for today so
 * planTrackerSticker() won't regenerate it later the same day. Does NOT
 * remove the sticker itself — the caller still does that via the existing
 * removeStickerInstance, in the same commitDraftChange batch.
 */
export function suppressTrackerStickerOnDelete(draft, sticker, localDate) {
  if (!sticker || sticker.origin !== "tracker" || !sticker.generationKey || !localDate) return draft;
  return {
    ...draft,
    suppressedStickerGenerationKeys: addSuppressedGenerationKey(draft.suppressedStickerGenerationKeys, sticker.generationKey, localDate),
  };
}
