import test from "node:test";
import assert from "node:assert/strict";
import { buildConfirmedAmbiguousMigrationEvent, buildTrackerMigrationDryRun, migrationRangeCoversMonth, nextTrackerMigrationState, resolveMigrationRange } from "./trackerMigration.js";

const trackers = [
  { id: "family-a", title: "联系外婆", schedule: { kind: "interval", every: 7, unit: "day" }, goal: { aggregation: "occurrence", target: 1 }, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }] },
  { id: "mask", title: "面膜", schedule: { kind: "interval", every: 3, unit: "day" }, goal: { aggregation: "occurrence", target: 1 }, evidenceBindings: [{ type: "legacyMaskField" }] },
  { id: "reading", title: "阅读", schedule: { kind: "period", period: "month" }, goal: { aggregation: "sum", target: 720 }, evidenceBindings: [{ type: "reviewFieldPath", path: ["fields", "reading"], valueType: "duration" }] },
  { id: "bound", title: "已绑定分类", schedule: { kind: "period", period: "week" }, goal: { aggregation: "occurrence", target: 1 }, evidenceBindings: [{ type: "categoryId", categoryId: "cat-reading" }] },
];
const settlement = { id: "s1", reviewDate: "2026-08-03", updatedAt: "2026-08-04T01:00:00Z", health: { maintenanceCompleted: ["family-a"], maskStatus: "已敷" }, reviewData: { fields: { reading: { value: 40 } }, categoryReviewEntries: { "cat-reading": { progress: { value: "完成" } }, "cat-unbound": { progress: { value: "和姥姥聊天" } } } } };

test("migration dry run mechanically recognizes legacy, review field and explicit category bindings", async () => {
  const result = await buildTrackerMigrationDryRun({ trackers, settlements: [settlement], range: { scope: "current_month", start: "2026-08-01", end: "2026-08-31" } });
  assert.equal(result.highConfidence.length, 4); assert.equal(result.highConfidence.find((item) => item.trackerId === "family-a").event.ingestionType, "migration");
  assert.equal(result.highConfidence.find((item) => item.trackerId === "family-a").event.occurredOn, "2026-08-03"); assert.equal(result.highConfidence.find((item) => item.trackerId === "reading").event.value, 40);
  assert.equal(result.ambiguous.length, 1); assert.equal(result.ambiguous[0].categoryId, "cat-unbound");
});
test("migration dry run does not auto-migrate requiresSetup or duplicate bindings", async () => {
  const duplicate = { ...trackers[0], id: "family-b", requiresSetup: true };
  const result = await buildTrackerMigrationDryRun({ trackers: [...trackers, duplicate], settlements: [settlement], range: { scope: "all", start: "", end: "" } });
  assert.equal(result.highConfidence.some((item) => item.trackerId === "family-b"), false); assert.match(result.summaries.find((item) => item.trackerId === "family-b").configurationIssues.join(), /tracker_requires_setup/);
});
test("migration range and metadata distinguish partial coverage from completed all history", () => {
  assert.deepEqual(resolveMigrationRange({ scope: "current_month", today: "2026-08-16" }), { scope: "current_month", start: "2026-08-01", end: "2026-08-31" });
  const partial = nextTrackerMigrationState({}, { range: { scope: "current_month", start: "2026-08-01", end: "2026-08-31" }, now: "2026-08-16T00:00:00Z" });
  assert.equal(partial.status, "partial"); assert.equal(migrationRangeCoversMonth(partial, { start: "2026-08-01", end: "2026-08-31" }), true); assert.equal(migrationRangeCoversMonth(partial, { start: "2026-07-01", end: "2026-07-31" }), false);
  assert.equal(nextTrackerMigrationState(partial, { range: { scope: "all", start: "", end: "" } }).status, "completed");
});
test("migration is idempotent with a live event and custom range never scans outside dates", async () => {
  const initial = await buildTrackerMigrationDryRun({ trackers, settlements: [settlement], range: { scope: "custom", start: "2026-08-03", end: "2026-08-03" } });
  const familyEvent = initial.highConfidence.find((item) => item.trackerId === "family-a").event;
  const rerun = await buildTrackerMigrationDryRun({ trackers, settlements: [settlement, { ...settlement, id: "old", reviewDate: "2026-07-31" }], existingEvents: [{ ...familyEvent, ingestionType: "live" }], range: { scope: "custom", start: "2026-08-01", end: "2026-08-31" } });
  assert.equal(rerun.highConfidence.some((item) => item.trackerId === "family-a"), false); assert.equal(rerun.summaries.find((item) => item.trackerId === "family-a").existing, 1); assert.equal(rerun.scannedSettlements, 1);
});
test("confirmed unbound category creates the same category identity and preserves settlement date", async () => {
  const candidate = (await buildTrackerMigrationDryRun({ trackers, settlements: [settlement], range: { scope: "all", start: "", end: "" } })).ambiguous[0];
  const event = await buildConfirmedAmbiguousMigrationEvent({ candidate, tracker: trackers[0], settlement });
  assert.equal(event.sourceType, "categoryEntry"); assert.equal(event.sourceFieldKey, "categoryReviewEntries.cat-unbound"); assert.equal(event.occurredOn, settlement.reviewDate); assert.equal(event.ingestionType, "migration");
});
