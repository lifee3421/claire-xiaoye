import test from "node:test";
import assert from "node:assert/strict";
import { resolveDailyStudyTargets, captureStudyTargetSnapshot, resolveEffectiveTarget } from "./studyTargetResolver.js";
import { normalizeClassificationTaxonomy } from "../taxonomy/taxonomyContract.js";

const tree = normalizeClassificationTaxonomy();
const defaults = {
  entries: {
    "study.math": { enabled: true, minutes: 240 },
    "study.english": { enabled: true, minutes: 60 },
  },
};

test("new date inherits default targets with no overrides", () => {
  const resolved = resolveDailyStudyTargets({ defaults, overrides: {}, categoryTree: tree });
  assert.equal(resolved.byCategory["study.math"], 240);
  assert.equal(resolved.byCategory["study.english"], 60);
  assert.equal(resolved.totalMinutes, 300);
});

test("today's override changes only today, default is untouched", () => {
  const resolved = resolveDailyStudyTargets({ defaults, overrides: { "study.math": 180 }, categoryTree: tree });
  assert.equal(resolved.byCategory["study.math"], 180);
  assert.equal(defaults.entries["study.math"].minutes, 240);
});

test("restoring default means clearing the override (no overrides object key)", () => {
  const resolved = resolveDailyStudyTargets({ defaults, overrides: {}, categoryTree: tree });
  assert.equal(resolved.byCategory["study.math"], 240);
});

test("override of 0 is an explicit choice and is honored", () => {
  const resolved = resolveDailyStudyTargets({ defaults, overrides: { "study.math": 0 }, categoryTree: tree });
  assert.equal(resolved.byCategory["study.math"], 0);
});

test("captureStudyTargetSnapshot freezes totals and category map with capturedAt", () => {
  const resolved = resolveDailyStudyTargets({ defaults, overrides: { "study.math": 180 }, categoryTree: tree });
  const snapshot = captureStudyTargetSnapshot({ targetDate: "2026-07-30", resolved, now: () => new Date("2026-07-30T01:00:00.000Z") });
  assert.equal(snapshot.targetDate, "2026-07-30");
  assert.equal(snapshot.totalMinutes, 240); // 180 + 60
  assert.equal(snapshot.capturedAt, "2026-07-30T01:00:00.000Z");
});

test("historical date keeps its frozen snapshot even after defaults change later", () => {
  const snapshot = captureStudyTargetSnapshot({
    targetDate: "2026-07-20",
    resolved: { totalMinutes: 300, byCategory: { "study.math": 240, "study.english": 60 } },
    now: () => new Date("2026-07-20T01:00:00.000Z"),
  });
  // Defaults changed after the snapshot was taken.
  const laterDefaults = { entries: { "study.math": { enabled: true, minutes: 999 } } };
  const draftResolved = resolveDailyStudyTargets({ defaults: laterDefaults, overrides: {}, categoryTree: tree });
  const effective = resolveEffectiveTarget({ snapshot, draftResolved });
  assert.equal(effective.source, "snapshot");
  assert.equal(effective.totalMinutes, 300);
});

test("resolveEffectiveTarget falls back to live draft target when no snapshot exists yet (today, unconfirmed)", () => {
  const draftResolved = resolveDailyStudyTargets({ defaults, overrides: {}, categoryTree: tree });
  const effective = resolveEffectiveTarget({ snapshot: null, draftResolved });
  assert.equal(effective.source, "draft");
  assert.equal(effective.totalMinutes, 300);
});
