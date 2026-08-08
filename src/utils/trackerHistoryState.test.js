import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveTrackers, DEFAULT_TRACKERS } from "./trackerDefaults.js";
import { computeMigratableHistoryByTracker, nextTrackerMigrationState } from "./trackerMigration.js";
import { projectTrackerDailyOverview } from "./trackerDailyOverview.js";

function settlement(id, reviewDate, overrides = {}) {
  return { id, reviewDate, ...overrides };
}
function maintenanceSettlement(id, reviewDate, completed = []) {
  return settlement(id, reviewDate, { health: { maintenanceCompleted: completed } });
}
function maskSettlement(id, reviewDate, status = "已敷") {
  return settlement(id, reviewDate, { health: { maskStatus: status } });
}
function readingSettlement(id, reviewDate, minutes) {
  return settlement(id, reviewDate, { reviewData: { fields: { "study.reading.totalMinutes": { value: minutes } } } });
}

const today = "2026-08-01";
const effectiveTrackers = resolveEffectiveTrackers({});
const byId = new Map(effectiveTrackers.map((tracker) => [tracker.id, tracker]));

test("computeMigratableHistoryByTracker returns a flag for every effective tracker", () => {
  const settlements = [maintenanceSettlement("s1", "2026-07-15", ["family-a"])];
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  for (const tracker of DEFAULT_TRACKERS) assert.ok(map.has(tracker.id), `missing flag for ${tracker.id}`);
});

test("scenario 1: account has 100 settlements but family-b never had old evidence -> family-b not 历史尚未迁移", () => {
  const settlements = [];
  for (let i = 0; i < 100; i += 1) {
    // Every settlement records family-a only; family-b/writing are never referenced.
    settlements.push(maintenanceSettlement(`s${i}`, `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, ["family-a"]));
  }
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  assert.equal(map.get("family-b"), false, "family-b has no migratable evidence");
  assert.equal(map.get("writing"), false);
  // family-b is requiresSetup, so it reads 待设置 and never 历史尚未迁移.
  const summary = projectTrackerDailyOverview({ tracker: byId.get("family-b"), facts: {}, today, hasMigratableHistory: map.get("family-b") === true });
  assert.equal(summary.status, "待设置");
  assert.notEqual(summary.status, "历史尚未迁移");
});

test("scenario 2: family-a settlement maintenanceCompleted includes family-a -> family-a 历史尚未迁移", () => {
  const settlements = [maintenanceSettlement("s1", "2026-07-15", ["family-a"])];
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  assert.equal(map.get("family-a"), true);
  const summary = projectTrackerDailyOverview({ tracker: byId.get("family-a"), facts: {}, today, hasMigratableHistory: map.get("family-a") === true });
  assert.deepEqual(summary, { kind: "history_not_migrated", status: "历史尚未迁移", lines: ["上次：历史尚未迁移"] });
});

test("scenario 3: mask history has maskStatus 已敷 -> mask 历史尚未迁移", () => {
  const settlements = [maskSettlement("m1", "2026-07-20", "已敷")];
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  assert.equal(map.get("mask"), true);
  const summary = projectTrackerDailyOverview({ tracker: byId.get("mask"), facts: {}, today, hasMigratableHistory: map.get("mask") === true });
  assert.deepEqual(summary, { kind: "history_not_migrated", status: "历史尚未迁移", lines: ["上次：历史尚未迁移"] });
});

test("scenario 4: reading has no old reviewFieldPath data -> 暂无已确认记录", () => {
  // Settlements exist, but none carry the reading duration field.
  const settlements = [maintenanceSettlement("s1", "2026-07-15", ["family-a"]), maskSettlement("m1", "2026-07-20")];
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  assert.equal(map.get("reading"), false);
  const summary = projectTrackerDailyOverview({ tracker: byId.get("reading"), facts: {}, today, hasMigratableHistory: map.get("reading") === true });
  assert.deepEqual(summary, { kind: "no_history", status: "暂无已确认记录", lines: ["上次：暂无已确认记录"] });
});

test("scenario 5: requiresSetup always wins and shows 待设置; even explicit old evidence is ignored for a requiresSetup tracker", () => {
  // family-b is requiresSetup by default. Even if a settlement references it,
  // the migratable flag must stay false and the row reads 待设置.
  const settlements = [maintenanceSettlement("s1", "2026-07-15", ["family-b"])];
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  assert.equal(map.get("family-b"), false);
  const summary = projectTrackerDailyOverview({ tracker: byId.get("family-b"), facts: {}, today, hasMigratableHistory: map.get("family-b") === true });
  assert.equal(summary.status, "待设置");
  // A tracker that is explicitly configured + has no evidence also reads 待设置-free empty state.
  const configuredNoHistory = projectTrackerDailyOverview({ tracker: byId.get("reading"), facts: {}, today, hasMigratableHistory: false });
  assert.equal(configuredNoHistory.status, "暂无已确认记录");
});

test("scenario 6: an active CompletionEvent shows the normal fact view, never the migration prompt", () => {
  const settlements = [maintenanceSettlement("s1", "2026-07-15", ["family-a"])];
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  assert.equal(map.get("family-a"), true);
  const summary = projectTrackerDailyOverview({
    tracker: byId.get("family-a"),
    facts: { requiresSetup: false, lastCompletedDate: "2026-07-27", nextDueDate: "2026-08-03", scheduleStatus: "upcoming" },
    today,
    hasMigratableHistory: map.get("family-a") === true,
  });
  assert.notEqual(summary.kind, "history_not_migrated");
  assert.notEqual(summary.kind, "no_history");
  assert.equal(summary.lines[0].startsWith("上次："), true);
  assert.equal(summary.lines.some((line) => line.includes("历史尚未迁移")), false);
});

test("scenario 7: migrationState already covers the date range -> no longer 历史尚未迁移", () => {
  const settlements = [maintenanceSettlement("s1", "2026-07-15", ["family-a"])];
  // Must include evidenceSchemaVersion matching the current schema for the
  // "already migrated" guard to be respected (old states without this field
  // are treated as schema v1 and trigger a re-scan for new bindings).
  const migrationState = nextTrackerMigrationState({}, { range: { scope: "all", start: "", end: "" }, now: "2026-08-01T00:00:00.000Z" });
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements, migrationState });
  assert.equal(map.get("family-a"), false, "covered month must not count as pending");
  const summary = projectTrackerDailyOverview({ tracker: byId.get("family-a"), facts: {}, today, hasMigratableHistory: map.get("family-a") === true });
  assert.equal(summary.status, "暂无已确认记录");
  assert.notEqual(summary.status, "历史尚未迁移");
});

test("fuzzy / unbound evidence is not counted as migratable history", () => {
  // A category entry with no bound categoryId tracker, and a settlement whose
  // title mentions family-b but carries no maintenanceCompleted entry, must not
  // produce a migratable flag for family-b.
  const settlements = [
    settlement("cat1", "2026-07-15", { reviewData: { categoryReviewEntries: { stray: { duration: { value: 30 } } } } }),
    settlement("title1", "2026-07-16", { health: { note: "联系其他家人 family-b" } }),
  ];
  const map = computeMigratableHistoryByTracker({ trackers: effectiveTrackers, settlements });
  assert.equal(map.get("family-b"), false);
  assert.equal(map.get("writing"), false);
});
