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

  // A reminder-sticker tick never proves completion. When a settlement
  // revision/deletion retracts its CompletionEvent, re-open the existing
  // tracker sticker so the visible state follows TrackerFacts again.
  if (existingSticker?.origin === "tracker" && existingSticker.status === "completed") {
    return { action: "reopen", generationKey, trackerId: tracker.id, stickerId: existingSticker.id, stickerType: existingSticker.stickerType || stickerType };
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
export function applyTrackerStickerPlan(plan, { draft = {}, createSticker, completeSticker, reopenSticker } = {}) {
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

  if (plan.action === "reopen") {
    return { ...draft, stickers: reopenSticker(stickers, plan.stickerId) };
  }

  return draft;
}

/**
 * The full "given resolved TrackerFacts, apply today's sticker plan to the
 * schedule draft" step — everything App.jsx's syncTrackerStickersForDate
 * needs after fetchTrackerFacts resolves. Takes `draft` and
 * `commitDraftChange` as EXPLICIT parameters rather than closing over them,
 * because this app has two structurally separate React components:
 * App() (owns user/Firestore calls) and ScheduleAssistant (owns the actual
 * schedule `draft` state and its `commitDraftChange` setter) — they are
 * NOT the same function scope, so a plain closure reference from App()-side
 * code to ScheduleAssistant's `commitDraftChange` is a genuine
 * "ReferenceError: commitDraftChange is not defined" at runtime, not a
 * hoisting/timing issue. App.jsx bridges the two via a ref that
 * ScheduleAssistant populates with { draft, commitDraftChange } while
 * mounted (see trackerStickerHandleRef) and clears on unmount — when the
 * schedule page isn't currently open, that ref is null and this function is
 * simply not called (a legitimate no-op, not a failure: TrackerFacts are
 * already durably persisted via CompletionEvents regardless of whether a
 * sticker got drawn on screen this exact moment).
 *
 * Fails at the call boundary — a real Error with a clear message — if
 * `commitDraftChange` isn't a function, rather than letting a bad call site
 * produce a raw, confusing ReferenceError deep inside a promise chain.
 */
export function applyTrackerStickerSync({ trackerFactsList, reviewDate, draft, commitDraftChange, trackers, createSticker, completeSticker, reopenSticker } = {}) {
  if (typeof commitDraftChange !== "function") {
    throw new Error("applyTrackerStickerSync: commitDraftChange dependency is missing or not a function — this must be called with the schedule draft's own commitDraftChange, never assumed to be in scope.");
  }
  if (!Array.isArray(trackerFactsList) || !trackerFactsList.length) return;
  if (!Array.isArray(trackers) || !trackers.length) return;
  if (!draft || draft.targetDate !== reviewDate) return;

  commitDraftChange((current) => {
    if (current.targetDate !== reviewDate) return current;
    let next = current;
    for (const trackerFacts of trackerFactsList) {
      const tracker = trackers.find((item) => item.id === trackerFacts.trackerId);
      if (!tracker) continue;
      const generationKey = `${tracker.id}:${reviewDate}`;
      const existingSticker = (next.stickers || []).find((sticker) => sticker.generationKey === generationKey) || null;
      const plan = planTrackerSticker({ tracker, trackerFacts, localDate: reviewDate, existingSticker, suppressedGenerationKeys: next.suppressedStickerGenerationKeys });
      next = applyTrackerStickerPlan(plan, { draft: next, createSticker, completeSticker, reopenSticker });
    }
    return next;
  }, "追踪贴纸已同步");
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
