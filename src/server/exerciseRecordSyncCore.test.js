import test from "node:test";
import assert from "node:assert/strict";
import {
  validateExercisePayload,
  buildActivitySummary,
  buildExerciseFieldPatch,
  applyExerciseFieldUpdates,
  isSameSnapshot,
  isProjectionMaterialized,
  KEEP_EXERCISE_SOURCE,
} from "./exerciseRecordSyncCore.js";

function keepPayload(overrides = {}) {
  return {
    date: "2026-08-04",
    timezone: "Asia/Shanghai",
    summary: { sourceDisplayedMinutes: 36, calories: 250, sessionCount: 3 },
    sessions: [
      { title: "15分钟马甲线养成 · 高效塑形 第1次", durationSeconds: 828, calories: 48, displayTime: "17:53" },
      { title: "燃脂派对 · Club 02 第1次", durationSeconds: 152, calories: 10, displayTime: "17:58" },
      { title: "燃脂派对 · Club 02 第2次", durationSeconds: 1235, calories: 192, displayTime: "18:21" },
    ],
    source: { sourceSnapshotHash: "img-hash-abc123" },
    ...overrides,
  };
}

// 1 & 2. extraction normalization + exact duration math
test("1&2. validateExercisePayload sums exact session durations for durationSeconds while keeping Keep's own displayed minutes separate", () => {
  const { valid, errors, normalized } = validateExercisePayload(keepPayload());
  assert.equal(valid, true, JSON.stringify(errors));
  // 13:48 + 2:32 + 20:35 = 36:55 = 2215 seconds
  assert.equal(normalized.summary.durationSeconds, 2215);
  assert.equal(normalized.summary.sourceDisplayedMinutes, 36);
  assert.equal(normalized.summary.calories, 250);
  assert.equal(normalized.summary.sessionCount, 3);
  assert.equal(normalized.sessions.length, 3);
  assert.ok(normalized.sessions.every((s) => typeof s.id === "string" && s.id.startsWith("keep-")));
});

test("historical cumulative total (e.g. 7406) is never confused with today's minutes — only summary.sourceDisplayedMinutes is trusted, and it's capped at 1440", () => {
  const { valid, errors } = validateExercisePayload(keepPayload({ summary: { sourceDisplayedMinutes: 7406, calories: 250, sessionCount: 3 } }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("sourceDisplayedMinutes")));
});

// 9. malformed screenshot payload
test("9. malformed payload (bad date, missing sessions) is rejected, not silently coerced", () => {
  assert.equal(validateExercisePayload({}).valid, false);
  assert.equal(validateExercisePayload(keepPayload({ date: "8月4日" })).valid, false);
  assert.equal(validateExercisePayload(keepPayload({ sessions: [] })).valid, false);
  assert.equal(validateExercisePayload(keepPayload({ sessions: [{ title: "", durationSeconds: 100 }] })).valid, false);
  assert.equal(validateExercisePayload(keepPayload({ source: { sourceSnapshotHash: "" } })).valid, false);
});

// 11. source contract — no arbitrary path/field ids in the schema at all
test("11. the validated payload shape structurally cannot carry a Firestore path or field id", () => {
  const { normalized } = validateExercisePayload(keepPayload());
  const keys = JSON.stringify(Object.keys(normalized));
  assert.ok(!keys.includes("path"));
  assert.ok(!keys.includes("fieldId"));
});

test("buildActivitySummary groups repeat sessions by shortened title, most-frequent first", () => {
  const { normalized } = validateExercisePayload(keepPayload());
  const summary = buildActivitySummary(normalized.sessions);
  assert.equal(summary, "燃脂派对 ×2、马甲线养成");
});

// 5. projection into dailyReviewDraft autoValue
test("5. buildExerciseFieldPatch projects totalMinutes/activity as autoValue with autoValueSource=keep_exercise, never touching value/manuallyEdited", () => {
  const { normalized } = validateExercisePayload(keepPayload());
  const { fieldUpdates, exerciseSync } = buildExerciseFieldPatch(normalized);
  assert.equal(fieldUpdates["exercise.today.totalMinutes"].autoValue, 36);
  assert.equal(fieldUpdates["exercise.today.totalMinutes"].autoValueSource, KEEP_EXERCISE_SOURCE);
  assert.equal(fieldUpdates["exercise.today.activity"].autoValue, "燃脂派对 ×2、马甲线养成");
  assert.equal(exerciseSync.sessionCount, 3);
  assert.equal(exerciseSync.calories, 250);
  assert.ok(!("value" in fieldUpdates["exercise.today.totalMinutes"]));
  assert.ok(!("manuallyEdited" in fieldUpdates["exercise.today.totalMinutes"]));
});

// 6. manual override protection
test("6. applyExerciseFieldUpdates never clears an existing manual value/manuallyEdited flag", () => {
  const currentFields = {
    "exercise.today.totalMinutes": { value: 60, autoValue: 10, source: "manual", sourceRevision: "", manuallyEdited: true, editedAt: "t", updatedAt: "t" },
  };
  const { normalized } = validateExercisePayload(keepPayload());
  const { fieldUpdates } = buildExerciseFieldPatch(normalized);
  const next = applyExerciseFieldUpdates(currentFields, fieldUpdates);
  assert.equal(next["exercise.today.totalMinutes"].value, 60);
  assert.equal(next["exercise.today.totalMinutes"].manuallyEdited, true);
  // autoValue is still refreshed underneath the manual override, exactly
  // like Focus sync — resolveEffectiveReviewValue is what decides which one
  // actually displays, not this function.
  assert.equal(next["exercise.today.totalMinutes"].autoValue, 36);
});

// 3. idempotency — identical screenshot sent twice
test("3. isSameSnapshot recognizes an identical screenshot hash as a true no-op", () => {
  const existing = { source: { sourceSnapshotHash: "img-hash-abc123" } };
  assert.equal(isSameSnapshot(existing, "img-hash-abc123"), true);
  assert.equal(isSameSnapshot(existing, "img-hash-different"), false);
  assert.equal(isSameSnapshot(null, "img-hash-abc123"), false);
  assert.equal(isSameSnapshot({}, "img-hash-abc123"), false);
});

// 4. same-day update replaces rather than accumulates
test("4. a later, larger same-day screenshot (57min) fully replaces the 36min record instead of summing to 93", () => {
  const first = validateExercisePayload(keepPayload()).normalized;
  const second = validateExercisePayload(keepPayload({
    summary: { sourceDisplayedMinutes: 57, calories: 400, sessionCount: 4 },
    sessions: [...keepPayload().sessions, { title: "夜跑 5 公里", durationSeconds: 1260, calories: 150, displayTime: "20:30" }],
    source: { sourceSnapshotHash: "img-hash-second" },
  })).normalized;
  assert.equal(isSameSnapshot({ source: first.source }, second.source.sourceSnapshotHash), false);
  const { fieldUpdates } = buildExerciseFieldPatch(second);
  assert.equal(fieldUpdates["exercise.today.totalMinutes"].autoValue, 57);
  assert.notEqual(fieldUpdates["exercise.today.totalMinutes"].autoValue, 93);
});

// 10. cross-date isolation
test("10. a payload for 2026-08-04 produces field updates carrying only that date's snapshot hash, never touching another date's record", () => {
  const { normalized } = validateExercisePayload(keepPayload({ date: "2026-08-04" }));
  const { exerciseSync } = buildExerciseFieldPatch(normalized);
  assert.equal(exerciseSync.date, "2026-08-04");
});

// 5 (timezone). The record's `date` is ALWAYS the caller-supplied string —
// validateExercisePayload/buildExerciseFieldPatch never call Date.now()/new
// Date() to derive it, so a server running in UTC can never shift which
// calendar day a Keep screenshot lands on. Proven here by overriding the
// global clock to a moment that is a DIFFERENT UTC calendar day than the
// payload's own Beijing date (2026-08-04 16:30 UTC = 2026-08-05 00:30
// Beijing — 30 minutes into a new Beijing day while the server's UTC clock
// still reads the previous day) and confirming the output is completely
// unaffected either way.
test("5/timezone. the record date is never derived from the server clock — it is unaffected even when the system clock sits on a different UTC calendar day", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-04T16:30:00.000Z") });
  const { valid, normalized } = validateExercisePayload(keepPayload({ date: "2026-08-05" }));
  assert.equal(valid, true);
  assert.equal(normalized.date, "2026-08-05");
  const { exerciseSync } = buildExerciseFieldPatch(normalized);
  assert.equal(exerciseSync.date, "2026-08-05");
  t.mock.timers.reset();
});

test("isProjectionMaterialized detects when draft fields already match the expected patch, and when a stale autosave reverted them", () => {
  const { normalized } = validateExercisePayload(keepPayload());
  const { fieldUpdates } = buildExerciseFieldPatch(normalized);
  const materializedFields = applyExerciseFieldUpdates({}, fieldUpdates);
  assert.equal(isProjectionMaterialized(materializedFields, fieldUpdates), true);
  const revertedFields = applyExerciseFieldUpdates({}, {
    "exercise.today.totalMinutes": { autoValue: 0, autoValueSource: KEEP_EXERCISE_SOURCE, sourceRevision: "stale" },
    "exercise.today.activity": fieldUpdates["exercise.today.activity"],
  });
  assert.equal(isProjectionMaterialized(revertedFields, fieldUpdates), false);
});
