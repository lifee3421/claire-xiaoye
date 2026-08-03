import assert from "node:assert/strict";
import test from "node:test";
import { flattenPlannerTasks } from "./plannerTimelineBlocks.js";
import { migrateLegacyFixedEvents } from "./unifiedPlannerCards.js";

/**
 * Regression guard for the production crash
 *   TypeError: Cannot read properties of undefined (reading 'includes')
 * surfaced by PlannerErrorBoundary on build 199b9f6.
 *
 * Crash site: App.jsx `choosePlannerPlacement`
 *   plannerPeriodWindows().filter((period) => segment.preferredPeriods.includes(period.key))
 *
 * How `segment.preferredPeriods` becomes undefined:
 *   1. A card in `draft.todayCustomBlocks` has no `preferredPeriods`
 *      (e.g. produced by `migrateLegacyFixedEvents`, which never sets it).
 *   2. `buildPlannerTaskGroups` pushes it via `pushGroup` ->
 *      `normalizePlannerCategorizedItem`, which only normalises category
 *      fields and does NOT default `preferredPeriods`.
 *   3. `flattenPlannerTasks` does
 *        `segmentOverride.preferredPeriods || task.preferredPeriods`
 *      -> undefined survives onto the segment.
 *   4. If that segment is NOT pinned (unlocked, or no finite manualStart) it
 *      reaches `choosePlannerPlacement` and dereferences undefined.
 *
 * This is a latent bug that predates df030198 - it is data-shaped, not
 * commit-shaped, which is why a clean 199b9f6 diff review never finds it.
 */

// Mirrors App.jsx `normalizePlannerCategorizedItem`: category fields only.
function normalizePlannerCategorizedItem(item) {
  return { ...item, categoryId: item.categoryId || "personal", category: item.category || "个人 / 生活" };
}

// Mirrors the exact expression at App.jsx choosePlannerPlacement.
function periodFilterAsInApp(segment) {
  const periodWindows = [{ key: "morning" }, { key: "midday" }, { key: "afternoon" }, { key: "evening" }];
  return periodWindows.filter((period) => segment.preferredPeriods.includes(period.key));
}

test("migrateLegacyFixedEvents produces cards without preferredPeriods (the crash's data source)", () => {
  const cards = migrateLegacyFixedEvents(
    [{ id: "legacy-1", title: "线下课", startTime: "14:00", endTime: "15:30" }],
    {},
    "2026-08-03"
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].preferredPeriods, undefined, "legacy migrated card carries no preferredPeriods");
});

test("flattenPlannerTasks always emits an array preferredPeriods, even when the task group has none", () => {
  // An unlocked custom block: no preferredPeriods, no manualStart -> movable,
  // so it WILL be handed to choosePlannerPlacement.
  const group = normalizePlannerCategorizedItem({
    id: "legacy-1",
    title: "线下课",
    segments: [90],
    breakMinutes: 0,
    priority: 1,
    locked: false,
    segmentOverrides: {},
  });
  const [segment] = flattenPlannerTasks([group], []);
  assert.ok(Array.isArray(segment.preferredPeriods), "preferredPeriods must never be undefined on a flattened segment");
});

test("a movable segment from a preferredPeriods-less custom block does not crash the placement filter", () => {
  const group = normalizePlannerCategorizedItem({
    id: "legacy-1",
    title: "线下课",
    segments: [90],
    breakMinutes: 0,
    priority: 1,
    locked: false,
    segmentOverrides: {},
  });
  const [segment] = flattenPlannerTasks([group], []);
  assert.doesNotThrow(() => periodFilterAsInApp(segment), TypeError);
  // No stated preference => no period-restricted candidates, planner falls
  // back to the full free-interval list. Behaviour must stay "unconstrained",
  // never "restricted to nothing".
  assert.deepEqual(periodFilterAsInApp(segment), []);
});
