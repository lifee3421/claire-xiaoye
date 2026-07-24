import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyHmacSignature,
  isTimestampFresh,
  validateProjectionPayload,
  aggregateSessionsByCategory,
  buildFieldPatches,
  computeRollbackPatches,
  buildFocusSummary,
  buildFocusSync,
  UNMAPPED_CATEGORY_ID,
} from "./focusReviewSyncCore.js";

function session(overrides = {}) {
  return {
    sessionId: "s1",
    rawTaskId: "task-1",
    rawTitle: "线性代数",
    startedAt: "2026-07-24T01:00:00Z",
    endedAt: "2026-07-24T01:40:00Z",
    minutes: 40,
    categoryId: "study.math.linearAlgebra",
    mappingSource: "taskId_binding",
    mappingConfidence: "confirmed",
    note: null,
    ...overrides,
  };
}

// 13. HMAC signature verification
test("13. verifyHmacSignature accepts a correctly signed request and rejects a wrong signature", () => {
  const secret = "s3cret";
  const timestamp = "1000";
  const rawBody = JSON.stringify({ a: 1 });
  const good = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  assert.equal(verifyHmacSignature({ secret, timestamp, rawBody, signature: good }), true);
  assert.equal(verifyHmacSignature({ secret, timestamp, rawBody, signature: "0".repeat(64) }), false);
  assert.equal(verifyHmacSignature({ secret, timestamp, rawBody, signature: "" }), false);
});

// 14. expired timestamp
test("14. isTimestampFresh rejects a timestamp outside the +/-5min window", () => {
  const now = 1_000_000_000_000;
  assert.equal(isTimestampFresh(now, now), true);
  assert.equal(isTimestampFresh(now - 4 * 60_000, now), true);
  assert.equal(isTimestampFresh(now - 6 * 60_000, now), false);
  assert.equal(isTimestampFresh(now + 6 * 60_000, now), false);
  assert.equal(isTimestampFresh("not-a-number", now), false);
});

// 15. body schema errors
test("15. validateProjectionPayload rejects a malformed body (bad schemaVersion, wrong date, non-array sessions)", () => {
  const badVersion = validateProjectionPayload({ schemaVersion: 2, source: "ticktick_focus", date: "2026-07-24", sourceRevision: "x", sessions: [] });
  assert.equal(badVersion.valid, false);

  const badDate = validateProjectionPayload({ schemaVersion: 1, source: "ticktick_focus", date: "2026-13-40", sourceRevision: "x", sessions: [] });
  assert.equal(badDate.valid, false);

  const badSessions = validateProjectionPayload({ schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", sourceRevision: "x", sessions: "not-an-array" });
  assert.equal(badSessions.valid, false);
});

test("31. validateProjectionPayload rejects an unrecognized categoryId that is neither canonical nor \"unmapped\"", () => {
  const result = validateProjectionPayload({
    schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "x",
    sessions: [session({ categoryId: "totally.made.up.category" })],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /categoryId/);
});

test("validateProjectionPayload accepts \"unmapped\" as a valid categoryId", () => {
  const result = validateProjectionPayload({
    schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "x",
    sessions: [session({ categoryId: UNMAPPED_CATEGORY_ID })],
  });
  assert.equal(result.valid, true);
});

test("validateProjectionPayload rejects negative minutes, endedAt <= startedAt, and duplicate sessionIds", () => {
  const negative = validateProjectionPayload({ schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", sourceRevision: "x", sessions: [session({ minutes: -5 })] });
  assert.equal(negative.valid, false);

  const badOrder = validateProjectionPayload({ schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", sourceRevision: "x", sessions: [session({ startedAt: "2026-07-24T02:00:00Z", endedAt: "2026-07-24T01:00:00Z" })] });
  assert.equal(badOrder.valid, false);

  const dup = validateProjectionPayload({ schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", sourceRevision: "x", sessions: [session(), session()] });
  assert.equal(dup.valid, false);
});

test("validateProjectionPayload rejects a session whose local date doesn't match the target date", () => {
  const result = validateProjectionPayload({
    schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "x",
    sessions: [session({ startedAt: "2026-07-22T10:00:00Z", endedAt: "2026-07-22T10:30:00Z" })],
  });
  assert.equal(result.valid, false);
});

// 17. static binding writes autoValue
test("17. buildFieldPatches writes duration+progress autoValue for a REVIEW_BINDINGS (static) leaf, never touching `.value`", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ note: "完成第三章习题" })]);
  const { patch, fieldProjection } = buildFieldPatches({ byCategory });
  assert.equal(patch["fields.study.math.linearAlgebra.duration.autoValue"], 40);
  assert.match(patch["fields.study.math.linearAlgebra.progress.autoValue"], /完成第三章习题/);
  assert.ok(!Object.keys(patch).some((key) => key.endsWith(".value")), "must never write .value, only .autoValue");
  assert.deepEqual(fieldProjection.fieldTargets.sort(), ["study.math.linearAlgebra.duration", "study.math.linearAlgebra.progress"]);
});

test("40min math session with no note writes duration autoValue but no progress field at all (no fabricated content)", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ note: null })]);
  const { patch } = buildFieldPatches({ byCategory });
  assert.equal(patch["fields.study.math.linearAlgebra.duration.autoValue"], 40);
  assert.equal("fields.study.math.linearAlgebra.progress.autoValue" in patch, false);
});

// 20. dynamic categoryReviewEntries + 21. reviewConfig gating
test("20/21. buildFieldPatches writes categoryReviewEntries autoValue for a dynamic leaf, gated by its live reviewConfig", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "misc.water-plants", note: "浇水并修剪枯叶" })]);

  const enabled = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: true, recordDuration: true, recordProgress: true } } });
  assert.equal(enabled.patch["categoryReviewEntries.misc.water-plants.duration.autoValue"], 40);
  assert.match(enabled.patch["categoryReviewEntries.misc.water-plants.progress.autoValue"], /浇水/);

  const durationOnly = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: true, recordDuration: true, recordProgress: false } } });
  assert.equal(durationOnly.patch["categoryReviewEntries.misc.water-plants.duration.autoValue"], 40);
  assert.equal("categoryReviewEntries.misc.water-plants.progress.autoValue" in durationOnly.patch, false);

  const disabled = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: false } } });
  assert.deepEqual(disabled.patch, {});
});

test("a dynamic leaf with no live reviewConfig at all produces no patch (nothing to write to)", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "misc.water-plants" })]);
  const { patch } = buildFieldPatches({ byCategory, liveReviewConfigById: {} });
  assert.deepEqual(patch, {});
});

// unmapped never becomes a fake category
test("5/24. unmapped sessions never produce a field patch and are reported separately in focusSummary.unmapped", () => {
  const { byCategory, unmapped } = aggregateSessionsByCategory([session({ categoryId: UNMAPPED_CATEGORY_ID, rawTitle: "神秘任务" })]);
  const { patch } = buildFieldPatches({ byCategory });
  assert.deepEqual(patch, {});
  assert.equal(unmapped.length, 1);
  assert.equal(unmapped[0].rawTitle, "神秘任务");
});

// 22. session removal rolls back the old auto projection; 23. other autoValue untouched
test("22/23. computeRollbackPatches clears only fields this mechanism targeted before that it no longer targets, nothing else", () => {
  const previous = { fieldTargets: ["study.math.linearAlgebra.duration", "study.math.linearAlgebra.progress"], categoryEntryTargets: ["misc.water-plants.duration"] };
  const next = { fieldTargets: [], categoryEntryTargets: [] }; // the test session was removed entirely today
  const rollback = computeRollbackPatches({ previousFieldProjection: previous, nextFieldProjection: next });
  assert.equal(rollback["fields.study.math.linearAlgebra.duration.autoValue"], 0);
  assert.equal(rollback["fields.study.math.linearAlgebra.progress.autoValue"], "");
  assert.equal(rollback["categoryReviewEntries.misc.water-plants.duration.autoValue"], 0);
});

test("computeRollbackPatches produces nothing when the target set is unchanged", () => {
  const projection = { fieldTargets: ["study.math.linearAlgebra.duration"], categoryEntryTargets: [] };
  const rollback = computeRollbackPatches({ previousFieldProjection: projection, nextFieldProjection: projection });
  assert.deepEqual(rollback, {});
});

// 6/9. note ordering + timeline
test("6/9. aggregateSessionsByCategory orders notes chronologically and dedupes exact-duplicate lines", () => {
  const { byCategory } = aggregateSessionsByCategory([
    session({ sessionId: "a", startedAt: "2026-07-24T06:30:00Z", endedAt: "2026-07-24T07:00:00Z", note: "整理错题" }),
    session({ sessionId: "b", startedAt: "2026-07-24T01:20:00Z", endedAt: "2026-07-24T02:10:00Z", note: "完成特征值第一节练习" }),
    session({ sessionId: "c", startedAt: "2026-07-24T09:00:00Z", endedAt: "2026-07-24T09:20:00Z", note: "整理错题" }),
  ]);
  const notes = byCategory.get("study.math.linearAlgebra").notes;
  assert.equal(notes.length, 2, "the exact-duplicate '整理错题' line must be deduped");
  assert.match(notes[0], /^09:20–10:10|^09:20/); // first entry corresponds to the chronologically-first distinct note (session b at 01:20 UTC = 09:20 Asia/Shanghai)
});

test("aggregateSessionsByCategory skips empty/whitespace-only notes without fabricating content", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ note: "   " }), session({ sessionId: "s2", note: "" })]);
  assert.deepEqual(byCategory.get("study.math.linearAlgebra").notes, []);
});

// 12. dry-run has no network dependency here (pure) — buildFocusSummary/buildFocusSync are pure too
test("buildFocusSummary aggregates totals, sorts categoryTotals by minutes descending, and includes unmapped verbatim", () => {
  const sessions = [session({ sessionId: "a", categoryId: "study.math.linearAlgebra", minutes: 40 }), session({ sessionId: "b", categoryId: "study.english.ieltsSpeaking", minutes: 60, note: null })];
  const { byCategory, unmapped } = aggregateSessionsByCategory(sessions);
  const summary = buildFocusSummary({ byCategory, unmapped, sessions });
  assert.equal(summary.totalMinutes, 100);
  assert.equal(summary.sessionCount, 2);
  assert.equal(summary.categoryTotals[0].categoryId, "study.english.ieltsSpeaking");
  assert.equal(summary.categoryTotals[0].minutes, 60);
  assert.deepEqual(summary.unmapped, []);
});

test("25. settled-day sync marks hasPostSettlementChanges instead of touching settlement/points", () => {
  const { byCategory, unmapped } = aggregateSessionsByCategory([session()]);
  const sync = buildFocusSync({ date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "abc", sessions: [session()], byCategory, unmapped, isSettled: true });
  assert.equal(sync.hasPostSettlementChanges, true);
  assert.equal(sync.status, "ok");
});

test("32. a session cannot smuggle an arbitrary Firestore path or fieldId — buildFieldPatches only ever reads categoryId, everything else in a session object is structurally ignored", () => {
  const malicious = session({
    fieldId: "profile.pointsBalance",
    path: "users/someone-else/dailyReviewDrafts/2026-07-24",
    "fields.profile.pointsBalance.value": 999999,
  });
  const { byCategory } = aggregateSessionsByCategory([malicious]);
  const { patch } = buildFieldPatches({ byCategory });
  const patchKeys = Object.keys(patch);
  assert.ok(patchKeys.every((key) => key.startsWith("fields.study.math.linearAlgebra.")), "only the field ids resolved from categoryId via REVIEW_BINDINGS can ever appear in the patch");
  assert.ok(!patchKeys.some((key) => key.includes("profile") || key.includes("pointsBalance")), "no request-supplied field name can leak into the patch");
});

test("26. a non-settled day's focusSync has no hasPostSettlementChanges flag at all", () => {
  const { byCategory, unmapped } = aggregateSessionsByCategory([session()]);
  const sync = buildFocusSync({ date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "abc", sessions: [session()], byCategory, unmapped, isSettled: false });
  assert.equal("hasPostSettlementChanges" in sync, false);
});
