// Content-based dirty-checking for the planner autosave effect.
//
// The autosave effect used to gate itself on a "have I run once yet" ref
// (initializedRef), mutated in the effect body. That pattern is fundamentally
// broken under React 18 StrictMode, which double-invokes every mount effect
// (setup -> cleanup -> setup): once the cleanup undid the ref mutation to
// avoid a phantom autosave on the *first* mount, it also undid it on every
// *real* subsequent edit's cleanup — so the very next effect run (for a
// genuine user change) saw the ref reset to "not initialized" and skipped
// saving again. Net effect: real edits were silently never persisted.
//
// The fix replaces "have I run before" with "does the content I'd persist
// right now actually differ from what's already persisted" — a pure,
// StrictMode-safe, content-based fingerprint comparison.

// Bookkeeping timestamp keys that get freshly re-stamped with
// `new Date().toISOString()` on every plain recompute, regardless of
// whether anything the user actually controls changed — found so far at:
//   - scheduleAssistantDraft.updatedAt (buildPlannerPersistencePayload)
//   - scheduleAssistantDraftArchive[].archivedAt (archivePlannerDraft,
//     re-runs whenever a saved draft's targetDate has fallen behind the
//     real current day, even with the archived content unchanged)
//   - scheduleSegmentGoals[date].updatedAt (upsertScheduleSegmentGoalEntry)
// Deliberately NOT included: createdAt, confirmedAt, rescheduledAt, and
// similar — those are set once by a real user action/event and staying
// (or changing) is itself meaningful content, not recompute noise.
const VOLATILE_RECOMPUTE_TIMESTAMP_KEYS = new Set(["updatedAt", "archivedAt"]);

function stripVolatileTimestamps(value) {
  if (Array.isArray(value)) return value.map(stripVolatileTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_RECOMPUTE_TIMESTAMP_KEYS.has(key))
        .map(([key, val]) => [key, stripVolatileTimestamps(val)])
    );
  }
  return value;
}

/**
 * Fingerprints a planner persistence payload for dirty-checking: strips
 * recompute-noise timestamps (see VOLATILE_RECOMPUTE_TIMESTAMP_KEYS above)
 * anywhere in the payload before comparing, so a plain reload/re-render that
 * merely re-stamps bookkeeping fields doesn't look like a real content
 * change. Real content changes (a new task, an edited template, a changed
 * study target) still change the fingerprint as normal.
 */
export function fingerprintPlannerPersistencePayload(payload = {}) {
  return JSON.stringify(stripVolatileTimestamps(payload));
}
