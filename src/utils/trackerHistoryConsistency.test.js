import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveTrackers } from "./trackerDefaults.js";
import { computeMigratableHistoryByTracker, nextTrackerMigrationState } from "./trackerMigration.js";
import { projectTrackerDailyOverview } from "./trackerDailyOverview.js";
import { projectTrackerMonthlyOverview } from "./trackerMonthlyOverview.js";

// Keep the sidebar (daily) projection and the monthly overview in lockstep:
// both must derive "history not migrated" from the SAME per-tracker flag
// (computeMigratableHistoryByTracker), never from an account-wide
// "any settlement exists" flag.

const TODAY = "2026-08-20";
const MONTH = "2026-08";

function buildTrackers() {
  // Realistic default unified trackers, with their evidence bindings.
  return resolveEffectiveTrackers({});
}
function familyASettlement(id = "s-a", reviewDate = "2026-07-15") {
  return { id, reviewDate, health: { maintenanceCompleted: ["family-a"] } };
}
function familyBSettlement(id = "s-b", reviewDate = "2026-07-15") {
  return { id, reviewDate, health: { maintenanceCompleted: ["family-b"] } };
}
function maskSettlement(id = "s-mask", reviewDate = "2026-07-20") {
  return { id, reviewDate, health: { maskStatus: "已敷" } };
}
function readingSettlement(id = "s-reading", reviewDate = "2026-07-25") {
  return { id, reviewDate, reviewData: { fields: { "study.reading.totalMinutes": { value: 30 } } } };
}
// 100 noise settlements + family-a + mask evidence; family-b and reading never appear.
function mixedSettlements() {
  const settlements = [];
  for (let i = 0; i < 100; i++) {
    settlements.push({ id: `noise-${i}`, reviewDate: `2026-07-1${String((i % 9) + 1)}`, reviewData: { focusNote: `note ${i}` } });
  }
  settlements.push(familyASettlement("s-a"));
  settlements.push(maskSettlement("s-mask"));
  return settlements;
}

function sidebarState(tracker, map) {
  return projectTrackerDailyOverview({ tracker, facts: {}, today: TODAY, hasMigratableHistory: map.get(tracker.id) === true });
}
function monthlyState(tracker, map, migrationState) {
  return projectTrackerMonthlyOverview({ tracker, events: [], monthKey: MONTH, today: TODAY, hasMigratableHistory: map.get(tracker.id) === true, migrationState });
}

test("sidebar and monthly agree on history_not_migrated semantics for every tracker", () => {
  const trackers = buildTrackers();
  const map = computeMigratableHistoryByTracker({ trackers, settlements: mixedSettlements(), migrationState: { status: "never_run" } });
  for (const tracker of trackers) {
    const sidebarPending = sidebarState(tracker, map).kind === "history_not_migrated";
    const monthlyPending = monthlyState(tracker, map).state === "history_not_migrated";
    assert.equal(sidebarPending, monthlyPending, `history-state mismatch for ${tracker.id}`);
  }
});

test("family-b has no historical evidence -> neither side shows 历史尚未迁移 (requires_setup wins)", () => {
  const trackers = buildTrackers();
  const map = computeMigratableHistoryByTracker({ trackers, settlements: mixedSettlements(), migrationState: { status: "never_run" } });
  const familyB = trackers.find((t) => t.id === "family-b");
  assert.equal(map.get("family-b"), false);
  // family-b is requiresSetup; it must show 待设置, never 历史尚未迁移.
  assert.equal(sidebarState(familyB, map).kind, "requires_setup");
  assert.equal(monthlyState(familyB, map).state, "requires_setup");
});

test("family-a legacyMaintenanceId evidence -> both sides show 历史尚未迁移", () => {
  const trackers = buildTrackers();
  const map = computeMigratableHistoryByTracker({ trackers, settlements: [familyASettlement()], migrationState: { status: "never_run" } });
  const familyA = trackers.find((t) => t.id === "family-a");
  assert.equal(map.get("family-a"), true);
  assert.equal(sidebarState(familyA, map).kind, "history_not_migrated");
  assert.equal(monthlyState(familyA, map).state, "history_not_migrated");
});

test("mask legacyMaskField evidence -> both sides show 历史尚未迁移", () => {
  const trackers = buildTrackers();
  const map = computeMigratableHistoryByTracker({ trackers, settlements: [maskSettlement()], migrationState: { status: "never_run" } });
  const mask = trackers.find((t) => t.id === "mask");
  assert.equal(map.get("mask"), true);
  assert.equal(sidebarState(mask, map).kind, "history_not_migrated");
  assert.equal(monthlyState(mask, map).state, "history_not_migrated");
});

test("reading has no reviewFieldPath evidence -> monthly shows empty (暂无已确认记录)", () => {
  const trackers = buildTrackers();
  const map = computeMigratableHistoryByTracker({ trackers, settlements: mixedSettlements(), migrationState: { status: "never_run" } });
  const reading = trackers.find((t) => t.id === "reading");
  assert.equal(map.get("reading"), false);
  assert.equal(sidebarState(reading, map).kind, "no_history");
  assert.equal(monthlyState(reading, map).state, "empty");
});

test("migrated coverage removes 历史尚未迁移 from both sides even when old settlement exists", () => {
  const trackers = buildTrackers();
  // Use nextTrackerMigrationState so the state carries evidenceSchemaVersion
  // matching the current schema — otherwise old states trigger a re-scan.
  const migrationState = nextTrackerMigrationState({}, { range: { scope: "all", start: "", end: "" } });
  const map = computeMigratableHistoryByTracker({ trackers, settlements: [familyASettlement(), maskSettlement()], migrationState });
  const familyA = trackers.find((t) => t.id === "family-a");
  const mask = trackers.find((t) => t.id === "mask");
  assert.equal(map.get("family-a"), false);
  assert.equal(map.get("mask"), false);
  assert.equal(sidebarState(familyA, map).kind, "no_history");
  assert.equal(monthlyState(familyA, map, migrationState).state, "empty");
  assert.equal(sidebarState(mask, map).kind, "no_history");
  assert.equal(monthlyState(mask, map, migrationState).state, "empty");
});

test("requiresSetup tracker always shows 待设置 in monthly, even when evidence exists", () => {
  const trackers = buildTrackers();
  const map = computeMigratableHistoryByTracker({ trackers, settlements: [familyBSettlement()], migrationState: { status: "never_run" } });
  const familyB = trackers.find((t) => t.id === "family-b");
  assert.equal(familyB.requiresSetup, true);
  // requiresSetup trackers are excluded from the migratable scan.
  assert.equal(map.get("family-b"), false);
  assert.equal(monthlyState(familyB, map).state, "requires_setup");
  assert.equal(sidebarState(familyB, map).kind, "requires_setup");
});

test("reading reviewFieldPath evidence makes both sides pending (sanity of the binding)", () => {
  const trackers = buildTrackers();
  const map = computeMigratableHistoryByTracker({ trackers, settlements: [readingSettlement()], migrationState: { status: "never_run" } });
  const reading = trackers.find((t) => t.id === "reading");
  assert.equal(map.get("reading"), true);
  assert.equal(sidebarState(reading, map).kind, "history_not_migrated");
  assert.equal(monthlyState(reading, map).state, "history_not_migrated");
});
