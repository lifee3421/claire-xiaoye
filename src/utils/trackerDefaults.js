// Built-in default Tracker(s) for this personal deployment — shipped in
// code rather than requiring profile.trackers to be hand-seeded before the
// unified tracker layer does anything useful. resolveEffectiveTrackers()
// is the single place both the sticker path (App.jsx) and the reconcile
// path (trackerReconcileFirestore.js) must go through instead of reading
// profile.trackers directly, so the merge rule only has to be correct once.
export const DEFAULT_TRACKERS = [
  {
    id: "family-a",
    title: "联系外婆",
    enabled: true,
    schedule: { kind: "interval", every: 7, unit: "day" },
    goal: { aggregation: "occurrence", target: 1, unit: "times" },
    // Reuses the pre-existing System 1 (Life Maintenance) toggle data as
    // this first version's evidence source — settlement.health.
    // maintenanceCompleted already has real historical "family-a" entries;
    // no new evidence source needed for v1.
    evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }],
    stickerSettings: { enabled: true, emoji: "📞", title: "该联系外婆啦", time: "09:00", type: "reminder" },
  },
];

/**
 * Merges the user's stored profile.trackers with the built-in defaults:
 * - profile.trackers missing/empty -> the defaults alone.
 * - a default whose id is already present in profile.trackers -> skipped
 *   entirely (the user's version — even a disabled or edited one — always
 *   wins, never overwritten).
 * - a default whose id is NOT present -> appended.
 * - every tracker already in profile.trackers is kept, untouched, in its
 *   original order — nothing is ever removed here.
 */
export function resolveEffectiveTrackers(trackers) {
  const userTrackers = Array.isArray(trackers) ? trackers : [];
  const userIds = new Set(userTrackers.map((tracker) => tracker?.id));
  const missingDefaults = DEFAULT_TRACKERS.filter((defaultTracker) => !userIds.has(defaultTracker.id));
  return [...userTrackers, ...missingDefaults];
}
