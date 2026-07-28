import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyHmacSignature,
  isTimestampFresh,
  validateProjectionPayload,
  aggregateSessionsByCategory,
  buildFieldPatches,
  computeRollbackUpdates,
  mergeFieldUpdates,
  mergeCategoryEntryUpdates,
  applyFieldUpdates,
  applyCategoryEntryUpdates,
  detectMalformedFocusFieldKeys,
  detectMalformedCategoryEntryKeys,
  buildFocusSummary,
  buildFocusSync,
  isNoopSync,
  isFocusProjectionMaterialized,
  UNMAPPED_CATEGORY_ID,
  FOCUS_FIELD_PROJECTION_VERSION,
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

test("validateProjectionPayload accepts a custom categoryId when the caller supplies isKnownCategoryId (the endpoint's live-taxonomy check), but still rejects it by default when no such predicate is given", () => {
  const payload = {
    schemaVersion: 1, source: "ticktick_focus", date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "x",
    sessions: [session({ categoryId: "misc.cooking" })],
  };
  const withoutPredicate = validateProjectionPayload(payload);
  assert.equal(withoutPredicate.valid, false, "a non-canonical id must still be rejected when the caller doesn't widen acceptance");

  const withPredicate = validateProjectionPayload(payload, { isKnownCategoryId: (id) => id === "misc.cooking" });
  assert.equal(withPredicate.valid, true, "a custom id the caller's own live taxonomy recognizes must be accepted");

  const stillRejectsUnknown = validateProjectionPayload(
    { ...payload, sessions: [session({ categoryId: "some.totally.unknown.id" })] },
    { isKnownCategoryId: (id) => id === "misc.cooking" }
  );
  assert.equal(stillRejectsUnknown.valid, false, "widening acceptance to ONE known custom id must not accept every arbitrary string");
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

// ---------------------------------------------------------------------------
// Dotted-key regression: fieldId/categoryId must be used as a literal object
// KEY throughout, never split/concatenated into a Firestore dot-path string.
// A real fieldId like "study.math.linearAlgebra.duration" contains dots
// itself — a naive `fields.${fieldId}.autoValue` string would be parsed by
// Firestore as nested path segments (fields -> study -> math ->
// linearAlgebra -> duration -> autoValue), NOT as an address for the flat
// key draft.fields["study.math.linearAlgebra.duration"] the UI reads via
// bracket access. This is the literal production bug this round fixes.
// ---------------------------------------------------------------------------

test("17. buildFieldPatches returns fieldUpdates keyed by the FULL dotted fieldId as ONE literal object key, never split into nested path segments", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ note: "完成第三章习题" })]);
  const { fieldUpdates, fieldProjection } = buildFieldPatches({ byCategory });

  // The dotted id is ONE key, not five nested "study"/"math"/... keys.
  assert.equal(Object.keys(fieldUpdates).length, 2);
  assert.ok("study.math.linearAlgebra.duration" in fieldUpdates);
  assert.ok("study.math.linearAlgebra.progress" in fieldUpdates);
  assert.equal("study" in fieldUpdates, false, "must never produce a top-level nested-path segment key");

  assert.equal(fieldUpdates["study.math.linearAlgebra.duration"].autoValue, 40);
  assert.equal(fieldUpdates["study.math.linearAlgebra.duration"].autoValueSource, "ticktick_focus");
  assert.match(fieldUpdates["study.math.linearAlgebra.progress"].autoValue, /完成第三章习题/);
  assert.deepEqual(fieldProjection.fieldTargets.sort(), ["study.math.linearAlgebra.duration", "study.math.linearAlgebra.progress"]);
});

test("40min math session with no note produces a duration update but no progress key at all (no fabricated content)", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ note: null })]);
  const { fieldUpdates } = buildFieldPatches({ byCategory });
  assert.equal(fieldUpdates["study.math.linearAlgebra.duration"].autoValue, 40);
  assert.equal("study.math.linearAlgebra.progress" in fieldUpdates, false);
});

test("20/21. buildFieldPatches returns categoryEntryUpdates keyed by the FULL dotted categoryId as one literal key, gated by live reviewConfig", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "misc.water-plants", note: "浇水并修剪枯叶" })]);

  const enabled = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: true, recordDuration: true, recordProgress: true } } });
  assert.ok("misc.water-plants" in enabled.categoryEntryUpdates);
  assert.equal("misc" in enabled.categoryEntryUpdates, false, "must never produce a top-level nested-path segment key");
  assert.equal(enabled.categoryEntryUpdates["misc.water-plants"].duration.autoValue, 40);
  assert.match(enabled.categoryEntryUpdates["misc.water-plants"].progress.autoValue, /浇水/);

  const durationOnly = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: true, recordDuration: true, recordProgress: false } } });
  assert.equal(durationOnly.categoryEntryUpdates["misc.water-plants"].duration.autoValue, 40);
  assert.equal("progress" in durationOnly.categoryEntryUpdates["misc.water-plants"], false);

  const disabled = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: false } } });
  assert.deepEqual(disabled.categoryEntryUpdates, {});
});

test("a dynamic leaf with no live reviewConfig at all produces no update (nothing to write to)", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "misc.water-plants" })]);
  const { fieldUpdates, categoryEntryUpdates } = buildFieldPatches({ byCategory, liveReviewConfigById: {} });
  assert.deepEqual(fieldUpdates, {});
  assert.deepEqual(categoryEntryUpdates, {});
});

test("5/24. unmapped sessions never produce a field update and are reported separately in focusSummary.unmapped", () => {
  const { byCategory, unmapped } = aggregateSessionsByCategory([session({ categoryId: UNMAPPED_CATEGORY_ID, rawTitle: "神秘任务" })]);
  const { fieldUpdates, categoryEntryUpdates } = buildFieldPatches({ byCategory });
  assert.deepEqual(fieldUpdates, {});
  assert.deepEqual(categoryEntryUpdates, {});
  assert.equal(unmapped.length, 1);
  assert.equal(unmapped[0].rawTitle, "神秘任务");
});

// ---------------------------------------------------------------------------
// applyFieldUpdates / applyCategoryEntryUpdates: applying the deltas onto a
// CURRENT draft must produce the correct flat-key result — this is the exact
// assertion "fields['study.math.linearAlgebra.duration'].autoValue === 242"
// the production bug violated.
// ---------------------------------------------------------------------------

test("2. applying fieldUpdates onto a current draft.fields produces fields[\"study.math.linearAlgebra.duration\"].autoValue === 242, and never fields.study.math...", () => {
  const currentFields = { "study.math.linearAlgebra.duration": { value: "", autoValue: 0, autoValueSource: "default", source: "default", manuallyEdited: false } };
  const { byCategory } = aggregateSessionsByCategory([session({ minutes: 242 })]);
  const { fieldUpdates } = buildFieldPatches({ byCategory });
  const nextFields = applyFieldUpdates(currentFields, fieldUpdates);

  assert.equal(nextFields["study.math.linearAlgebra.duration"].autoValue, 242);
  assert.equal(nextFields["study.math.linearAlgebra.duration"].autoValueSource, "ticktick_focus");
  // Sibling keys on the SAME field state (value/manuallyEdited/source) survive untouched.
  assert.equal(nextFields["study.math.linearAlgebra.duration"].value, "");
  assert.equal(nextFields["study.math.linearAlgebra.duration"].manuallyEdited, false);
  // No malformed nested tree.
  assert.equal(nextFields.study, undefined);
});

test("5. applying categoryEntryUpdates keeps categoryId as one bracket key: categoryReviewEntries[\"misc.water-plants\"].duration.autoValue, never categoryReviewEntries.misc.water-plants", () => {
  const currentEntries = {};
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "misc.water-plants", minutes: 40, note: "浇水" })]);
  const { categoryEntryUpdates } = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: true, recordDuration: true, recordProgress: true } } });
  const nextEntries = applyCategoryEntryUpdates(currentEntries, categoryEntryUpdates);

  assert.equal(nextEntries["misc.water-plants"].duration.autoValue, 40);
  assert.match(nextEntries["misc.water-plants"].progress.autoValue, /浇水/);
  assert.equal(nextEntries.misc, undefined, "must never nest as categoryReviewEntries.misc[\"water-plants\"]");
});

test("applyFieldUpdates preserves every OTHER field the update doesn't mention, and returns the SAME reference when there's nothing to apply", () => {
  const currentFields = { "study.japanese.progress": { value: "existing", autoValue: "", manuallyEdited: true } };
  assert.equal(applyFieldUpdates(currentFields, {}), currentFields);
  const next = applyFieldUpdates(currentFields, { "study.math.linearAlgebra.duration": { autoValue: 10, autoValueSource: "ticktick_focus" } });
  assert.equal(next["study.japanese.progress"].value, "existing", "an untouched field must survive completely unchanged");
});

// 3. rollback (nested-delta shape)
test("22/23. computeRollbackUpdates clears only fields this mechanism targeted before that it no longer targets, nothing else", () => {
  const previous = { fieldTargets: ["study.math.linearAlgebra.duration", "study.math.linearAlgebra.progress"], categoryEntryTargets: ["misc.water-plants.duration"] };
  const next = { fieldTargets: [], categoryEntryTargets: [] }; // the test session was removed entirely today
  const currentFields = {
    "study.math.linearAlgebra.duration": { value: "", autoValue: 40, autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false },
    "study.math.linearAlgebra.progress": { value: "", autoValue: "旧的自动推进", autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false },
  };
  const currentCategoryReviewEntries = { "misc.water-plants": { duration: { value: "", autoValue: 40, autoValueSource: "ticktick_focus", manuallyEdited: false } } };
  const { fieldUpdates, categoryEntryUpdates } = computeRollbackUpdates({ previousFieldProjection: previous, nextFieldProjection: next, currentFields, currentCategoryReviewEntries });

  // Never the number 0 — a "0min" duration reads as "recorded zero minutes",
  // which is misleading; "" is this schema's genuine no-data representation.
  assert.equal(fieldUpdates["study.math.linearAlgebra.duration"].autoValue, "");
  assert.equal(fieldUpdates["study.math.linearAlgebra.progress"].autoValue, "");
  assert.equal(categoryEntryUpdates["misc.water-plants"].duration.autoValue, "");
  assert.equal(fieldUpdates["study.math.linearAlgebra.duration"].autoValueSource, "default");
  assert.equal(categoryEntryUpdates["misc.water-plants"].duration.autoValueSource, "default");
});

test("computeRollbackUpdates produces nothing when the target set is unchanged", () => {
  const projection = { fieldTargets: ["study.math.linearAlgebra.duration"], categoryEntryTargets: [] };
  const { fieldUpdates, categoryEntryUpdates } = computeRollbackUpdates({ previousFieldProjection: projection, nextFieldProjection: projection });
  assert.deepEqual(fieldUpdates, {});
  assert.deepEqual(categoryEntryUpdates, {});
});

test("3. computeRollbackUpdates never clears a field whose autoValue was already taken over by a DIFFERENT autoValueSource — even though this mechanism targeted it last time", () => {
  const previous = { fieldTargets: ["study.math.linearAlgebra.duration"], categoryEntryTargets: [] };
  const next = { fieldTargets: [], categoryEntryTargets: [] };
  const currentFields = { "study.math.linearAlgebra.duration": { value: "", autoValue: 999, autoValueSource: "some_other_mechanism", manuallyEdited: false } };
  const { fieldUpdates } = computeRollbackUpdates({ previousFieldProjection: previous, nextFieldProjection: next, currentFields });
  assert.equal("study.math.linearAlgebra.duration" in fieldUpdates, false, "must not clobber a field another source now owns");
});

test("22/23. a MANUALLY-edited field's own value/source/manuallyEdited survive a rollback completely untouched (proven through applyFieldUpdates, the same code path the endpoint uses), even though its stale Focus autoValue gets cleared", () => {
  const previous = { fieldTargets: ["study.math.linearAlgebra.duration"], categoryEntryTargets: [] };
  const next = { fieldTargets: [], categoryEntryTargets: [] };
  const currentFields = { "study.math.linearAlgebra.duration": { value: 90, autoValue: 40, autoValueSource: "ticktick_focus", source: "manual", manuallyEdited: true } };
  const { fieldUpdates } = computeRollbackUpdates({ previousFieldProjection: previous, nextFieldProjection: next, currentFields });
  const nextFields = applyFieldUpdates(currentFields, fieldUpdates);
  assert.equal(nextFields["study.math.linearAlgebra.duration"].autoValue, "");
  assert.equal(nextFields["study.math.linearAlgebra.duration"].autoValueSource, "default");
  assert.equal(nextFields["study.math.linearAlgebra.duration"].value, 90, "manual value must survive");
  assert.equal(nextFields["study.math.linearAlgebra.duration"].source, "manual", "the value/manual source marker is untouched by autoValue rollback");
  assert.equal(nextFields["study.math.linearAlgebra.duration"].manuallyEdited, true);
});

test("mergeFieldUpdates / mergeCategoryEntryUpdates combine a projection run's updates with a rollback run's updates into one delta map", () => {
  const merged = mergeFieldUpdates({ a: { autoValue: 1 } }, { b: { autoValue: 2 } });
  assert.deepEqual(merged, { a: { autoValue: 1 }, b: { autoValue: 2 } });

  const mergedEntries = mergeCategoryEntryUpdates({ "misc.a": { duration: { autoValue: 1 } } }, { "misc.a": { progress: { autoValue: "x" } }, "misc.b": { duration: { autoValue: 2 } } });
  assert.deepEqual(mergedEntries, { "misc.a": { duration: { autoValue: 1 }, progress: { autoValue: "x" } }, "misc.b": { duration: { autoValue: 2 } } });
});

test("3. buildFieldPatches tags every autoValue it produces with autoValueSource: \"ticktick_focus\" — a DIFFERENT key from the schema's own value/manual `.source` field", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ note: "完成第三章习题" })]);
  const { fieldUpdates } = buildFieldPatches({ byCategory });
  assert.equal(fieldUpdates["study.math.linearAlgebra.duration"].autoValueSource, "ticktick_focus");
  assert.equal("source" in fieldUpdates["study.math.linearAlgebra.duration"], false, "must never write the value/manual source key");

  const dynamic = aggregateSessionsByCategory([session({ categoryId: "misc.water-plants", note: "浇水" })]);
  const dynamicResult = buildFieldPatches({ byCategory: dynamic.byCategory, liveReviewConfigById: { "misc.water-plants": { enabled: true, recordDuration: true, recordProgress: true } } });
  assert.equal(dynamicResult.categoryEntryUpdates["misc.water-plants"].duration.autoValueSource, "ticktick_focus");
});

// ---------------------------------------------------------------------------
// Malformed-key cleanup: construct the EXACT malformed nested tree the
// dot-path bug produced, and prove the cleanup function only removes that,
// never a real flat-key field or manual value.
// ---------------------------------------------------------------------------

test("7. detectMalformedFocusFieldKeys finds the bogus nested tree the dot-path bug created (fields.study = {math:{linearAlgebra:{duration:{autoValue}}}}), and leaves every real flat-key field alone", () => {
  const malformedFields = {
    // What the OLD buggy `patch["fields.study.math.linearAlgebra.duration.autoValue"] = 242` produced:
    study: { math: { linearAlgebra: { duration: { autoValue: 242, autoValueSource: "ticktick_focus" } } } },
    // A real, correctly-shaped flat-key field, manually edited by the user — must NOT be flagged.
    "study.math.linearAlgebra.duration": { value: 90, autoValue: 0, manuallyEdited: true, source: "manual" },
    // A real flat-key field with no dots in its id at all — must NOT be flagged either.
    "diary.title": { value: "", autoValue: "", manuallyEdited: false, source: "default" },
  };
  const malformed = detectMalformedFocusFieldKeys(malformedFields);
  assert.deepEqual(malformed, ["study"]);
});

test("7. detectMalformedCategoryEntryKeys finds the bogus nested tree for a dynamic categoryId (categoryReviewEntries.misc = {\"water-plants\": {duration:{autoValue}}}), leaves a real flat-key entry alone", () => {
  const malformedEntries = {
    misc: { "water-plants": { duration: { autoValue: 40, autoValueSource: "ticktick_focus" } } },
    "misc.water-plants": { duration: { value: "", autoValue: 40, manuallyEdited: false } },
  };
  const malformed = detectMalformedCategoryEntryKeys(malformedEntries);
  assert.deepEqual(malformed, ["misc"]);
});

test("7. cleanup never flags a genuinely empty categoryReviewEntries or fields map, or an entry with only partial (duration-only) real shape", () => {
  assert.deepEqual(detectMalformedFocusFieldKeys({}), []);
  assert.deepEqual(detectMalformedCategoryEntryKeys({}), []);
  assert.deepEqual(detectMalformedCategoryEntryKeys({ "misc.water-plants": { duration: { value: "", autoValue: 40, manuallyEdited: false } } }), []);
});

// 8. isNoopSync / projectionVersion
test("8. isNoopSync requires BOTH sourceRevision and projectionVersion to match — a projection-logic fix always forces a reproject even for an unchanged Focus session set", () => {
  const upToDate = { sourceRevision: "rev-1", projectionVersion: FOCUS_FIELD_PROJECTION_VERSION };
  assert.equal(isNoopSync(upToDate, "rev-1"), true);
  assert.equal(isNoopSync(upToDate, "rev-2"), false, "changed sourceRevision must always reproject");

  const staleVersion = { sourceRevision: "rev-1", projectionVersion: FOCUS_FIELD_PROJECTION_VERSION - 1 };
  assert.equal(isNoopSync(staleVersion, "rev-1"), false, "an older projectionVersion must reproject even with the same sourceRevision, never bypassed by fudging sourceRevision");

  assert.equal(isNoopSync(null, "rev-1"), false);
  assert.equal(isNoopSync(undefined, "rev-1"), false);
});

test("real-world scenario: the SAME 2026-07-24 session set (same sourceRevision) must reproject once after this round's projectionVersion bump (v2 -> v3, for misc.today.progress), then go idempotent on the next apply at the same version", () => {
  // Simulates the exact situation flagged in review: session data hasn't
  // changed since the last real apply, so sourceRevision alone would look
  // identical — only the projectionVersion bump can force the reproject
  // that's needed to actually write the new misc.today.progress field.
  const sourceRevision = "same-2026-07-24-revision";
  const stateFromLastRealApply = { sourceRevision, projectionVersion: FOCUS_FIELD_PROJECTION_VERSION - 1 };
  assert.equal(isNoopSync(stateFromLastRealApply, sourceRevision), false, "must reproject: old apply used the pre-misc.today.progress projection version");

  // After applying once at the new version, state.focusSync now records the
  // new version — a second apply with unchanged session data must be a
  // real no-op, never a forced reproject "just because it's a new version
  // that already applied once".
  const stateAfterNewVersionApply = { sourceRevision, projectionVersion: FOCUS_FIELD_PROJECTION_VERSION };
  assert.equal(isNoopSync(stateAfterNewVersionApply, sourceRevision), true, "must NOT reproject again: same session data, already on the current projection version");
});

// --- isFocusProjectionMaterialized ------------------------------------------
// The metadata check (isNoopSync) only proves a matching write happened at
// SOME point — these tests cover the other half: does the CURRENT stored
// draft still actually hold that write's result. This is what protects
// against a stale client autosave (the Daily Review workbench's full
// `{...draft}` payload) silently reverting autoValue after a correct server
// write, which would otherwise wedge isNoopSync into skipping forever.

function expectedFromPatches(byCategory, liveReviewConfigById = {}) {
  const { fieldUpdates, categoryEntryUpdates } = buildFieldPatches({ byCategory, liveReviewConfigById });
  return { expectedFieldUpdates: fieldUpdates, expectedCategoryEntryUpdates: categoryEntryUpdates };
}

test("1. existing focusSync metadata matches the request, focusSummary=434, but 雅思写作/单词/游戏/做饭 autoValue is entirely MISSING from fields/categoryReviewEntries => not materialized, must not noop", () => {
  const { byCategory } = aggregateSessionsByCategory([
    session({ sessionId: "a", categoryId: "study.english.ieltsWriting", minutes: 56 }),
    session({ sessionId: "b", categoryId: "study.english.vocabulary", minutes: 7 }),
    session({ sessionId: "c", categoryId: "entertainment.game", minutes: 15 }),
    session({ sessionId: "d", categoryId: "secondary-1784951587521", minutes: 16 }),
  ]);
  const liveReviewConfigById = { "secondary-1784951587521": { enabled: true, recordDuration: true, recordProgress: true } };
  const { expectedFieldUpdates, expectedCategoryEntryUpdates } = expectedFromPatches(byCategory, liveReviewConfigById);

  const materialized = isFocusProjectionMaterialized({
    currentFields: {}, // nothing actually stored — exactly the reported bug
    currentCategoryReviewEntries: {},
    expectedFieldUpdates,
    expectedCategoryEntryUpdates,
  });
  assert.equal(materialized, false);
});

test("2. autoValue is present but STALE (a different number than this run computed) => not materialized", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "study.english.ieltsWriting", minutes: 56 })]);
  const { expectedFieldUpdates } = expectedFromPatches(byCategory);

  const materialized = isFocusProjectionMaterialized({
    currentFields: { "study.english.ieltsWriting.duration": { value: "", autoValue: 20, autoValueSource: "ticktick_focus" } },
    expectedFieldUpdates,
  });
  assert.equal(materialized, false);
});

test("3. a dynamic categoryReviewEntries target (做饭) is entirely missing locally => not materialized, and the caller creates it fresh (never crashes on a missing entry)", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "secondary-1784951587521", minutes: 16 })]);
  const liveReviewConfigById = { "secondary-1784951587521": { enabled: true, recordDuration: true } };
  const { expectedCategoryEntryUpdates } = expectedFromPatches(byCategory, liveReviewConfigById);

  assert.equal(isFocusProjectionMaterialized({ currentCategoryReviewEntries: {}, expectedCategoryEntryUpdates }), false);

  const nextEntries = applyCategoryEntryUpdates({}, expectedCategoryEntryUpdates);
  assert.equal(nextEntries["secondary-1784951587521"].duration.autoValue, 16);
});

test("4. every expected field/entry already holds the exact autoValue + autoValueSource this run would write => materialized, true noop", () => {
  const { byCategory } = aggregateSessionsByCategory([
    session({ sessionId: "a", categoryId: "study.english.ieltsWriting", minutes: 56 }),
    session({ sessionId: "d", categoryId: "secondary-1784951587521", minutes: 16 }),
  ]);
  const liveReviewConfigById = { "secondary-1784951587521": { enabled: true, recordDuration: true } };
  const { expectedFieldUpdates, expectedCategoryEntryUpdates } = expectedFromPatches(byCategory, liveReviewConfigById);

  const currentFields = applyFieldUpdates({}, expectedFieldUpdates);
  const currentCategoryReviewEntries = applyCategoryEntryUpdates({}, expectedCategoryEntryUpdates);

  assert.equal(isFocusProjectionMaterialized({ currentFields, currentCategoryReviewEntries, expectedFieldUpdates, expectedCategoryEntryUpdates }), true);
});

test("5. a manually-edited field (value=90, manuallyEdited=true) is never inspected by materialization — only autoValue/autoValueSource matter, value/manuallyEdited/source are irrelevant to this check", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ categoryId: "study.english.ieltsWriting", minutes: 56 })]);
  const { expectedFieldUpdates } = expectedFromPatches(byCategory);

  const currentFields = {
    "study.english.ieltsWriting.duration": { value: 90, manuallyEdited: true, source: "manual", autoValue: 56, autoValueSource: "ticktick_focus" },
  };
  assert.equal(isFocusProjectionMaterialized({ currentFields, expectedFieldUpdates }), true, "manuallyEdited value/source must not affect materialization — only autoValue/autoValueSource are checked");
});

test("6. real-world race: a stale browser autosave overwrites correct autoValue back to empty AFTER a correct server write, but focusSync/focusSummary stay correct — the endpoint's combined metadata+materialization check must self-heal on the next identical-revision request, then go idempotent", () => {
  const { byCategory } = aggregateSessionsByCategory([
    session({ sessionId: "a", categoryId: "study.english.ieltsWriting", minutes: 56 }),
    session({ sessionId: "b", categoryId: "study.english.vocabulary", minutes: 7 }),
  ]);
  const { fieldUpdates, fieldProjection } = buildFieldPatches({ byCategory });

  // Step 1: correct write lands.
  let currentFields = applyFieldUpdates({}, fieldUpdates);
  let focusSync = { sourceRevision: "rev-x", projectionVersion: FOCUS_FIELD_PROJECTION_VERSION, fieldProjection };

  // Step 2: a stale client autosave (old local draft.fields from BEFORE the
  // sync landed) overwrites fields back to empty — focusSync/focusSummary
  // are untouched, since the client autosave payload never includes them.
  currentFields = {
    "study.english.ieltsWriting.duration": { value: "", autoValue: "", source: "default", manuallyEdited: false },
    "study.english.vocabulary.duration": { value: "", autoValue: "", source: "default", manuallyEdited: false },
  };

  // Same revision syncs again — metadata alone says noop, but materialization catches the regression.
  const metadataUnchanged = isNoopSync(focusSync, "rev-x");
  assert.equal(metadataUnchanged, true);
  const materialized = isFocusProjectionMaterialized({ currentFields, expectedFieldUpdates: fieldUpdates });
  assert.equal(materialized, false, "must detect the reverted fields even though metadata matches");

  // Endpoint would now repair: re-apply the same updates.
  const repairedFields = applyFieldUpdates(currentFields, fieldUpdates);
  assert.equal(repairedFields["study.english.ieltsWriting.duration"].autoValue, 56);
  assert.equal(repairedFields["study.english.vocabulary.duration"].autoValue, 7);

  // A THIRD sync at the same revision, now that fields are genuinely materialized again, must be a true noop.
  const materializedAfterRepair = isFocusProjectionMaterialized({ currentFields: repairedFields, expectedFieldUpdates: fieldUpdates });
  assert.equal(materializedAfterRepair, true);
});

test("buildFocusSync stamps the current FOCUS_FIELD_PROJECTION_VERSION", () => {
  const { byCategory, unmapped } = aggregateSessionsByCategory([session()]);
  const sync = buildFocusSync({ date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "abc", sessions: [session()], byCategory, unmapped, isSettled: false });
  assert.equal(sync.projectionVersion, FOCUS_FIELD_PROJECTION_VERSION);
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

test("a precisely mapped dynamic custom leaf with no note projects its raw title as Beijing progress, without changing built-in semantics", () => {
  const chess = session({
    categoryId: "hobby.chess.custom-001",
    rawTitle: "象棋",
    note: null,
    minutes: 38,
    mappingSource: "title_exact",
    startedAt: "2026-07-28T06:00:00.000Z",
    endedAt: "2026-07-28T06:38:00.000Z",
  });
  const { byCategory } = aggregateSessionsByCategory([chess], { timezone: "Asia/Shanghai" });
  const result = buildFieldPatches({
    byCategory,
    liveReviewConfigById: {
      "hobby.chess.custom-001": { enabled: true, recordDuration: true, recordProgress: true },
    },
  });
  const entry = result.categoryEntryUpdates["hobby.chess.custom-001"];
  assert.equal(entry.duration.autoValue, 38);
  assert.match(entry.progress.autoValue, /14:00.*14:38.*象棋/);
  assert.equal(byCategory.get("hobby.chess.custom-001").notes.length, 0, "the global notes list remains blank");

  const builtIn = aggregateSessionsByCategory([session({ note: null, rawTitle: "线性代数", mappingSource: "title_exact" })]);
  const builtInPatches = buildFieldPatches({ byCategory: builtIn.byCategory });
  assert.equal("study.math.linearAlgebra.progress" in builtInPatches.fieldUpdates, false);
});

test("dynamic raw-title progress fallback is disabled by recordProgress, excluded for misc, preserves real notes, and never changes manual value", () => {
  const chess = session({
    categoryId: "hobby.chess.custom-001", rawTitle: "象棋", note: null, minutes: 38,
    mappingSource: "title_exact", startedAt: "2026-07-28T06:00:00Z", endedAt: "2026-07-28T06:38:00Z",
  });
  const { byCategory } = aggregateSessionsByCategory([chess], { timezone: "Asia/Shanghai" });
  const noProgress = buildFieldPatches({ byCategory, liveReviewConfigById: { "hobby.chess.custom-001": { enabled: true, recordDuration: true, recordProgress: false } } });
  assert.equal(noProgress.categoryEntryUpdates["hobby.chess.custom-001"].duration.autoValue, 38);
  assert.equal("progress" in noProgress.categoryEntryUpdates["hobby.chess.custom-001"], false);

  const misc = aggregateSessionsByCategory([session({ categoryId: "misc.diary", rawTitle: "写日记", note: null, mappingSource: "title_exact" })]);
  assert.deepEqual(misc.byCategory.get("misc.diary").notes, [], "misc keeps its existing no-note semantics before endpoint target selection");

  const realNote = aggregateSessionsByCategory([session({ categoryId: "hobby.chess.custom-001", rawTitle: "象棋", note: "复盘残局", mappingSource: "title_exact" })], { timezone: "Asia/Shanghai" });
  const noted = buildFieldPatches({ byCategory: realNote.byCategory, liveReviewConfigById: { "hobby.chess.custom-001": { enabled: true, recordProgress: true } } });
  assert.match(noted.categoryEntryUpdates["hobby.chess.custom-001"].progress.autoValue, /复盘残局/);
  assert.doesNotMatch(noted.categoryEntryUpdates["hobby.chess.custom-001"].progress.autoValue, /象棋/);
  const existing = { "hobby.chess.custom-001": { progress: { value: "手动进度", manuallyEdited: true, autoValue: "旧自动值" } } };
  const merged = applyCategoryEntryUpdates(existing, noted.categoryEntryUpdates);
  assert.equal(merged["hobby.chess.custom-001"].progress.value, "手动进度");
  assert.equal(merged["hobby.chess.custom-001"].progress.manuallyEdited, true);
});

test("Focus progress clock uses the projection timezone, never the Node process timezone", () => {
  const { byCategory } = aggregateSessionsByCategory([session({ startedAt: "2026-07-28T06:00:00.000Z", endedAt: "2026-07-28T06:38:00.000Z", note: "chess" })], { timezone: "Asia/Shanghai" });
  assert.match(byCategory.get("study.math.linearAlgebra").notes[0], /^14:00–14:38/);
});

// Seconds-authoritative aggregation: summing exact seconds and rounding ONCE
// per category must not drift from summing many per-session-rounded minutes
// the way the old minutes-only aggregation could. Six 25-second sessions
// (0.4167min each) sum to exactly 150s = 2.5min -> rounds to 2 or 3 depending
// on rounding convention, but critically must match what a single 150s
// session would produce - never accumulate error from rounding each 25s
// session independently (which, done naively via Math.round(25/60)=0 each
// time, would wrongly total 0 minutes instead of round(150/60)=3).
test("aggregateSessionsByCategory sums exact seconds and rounds ONCE per category, not per session", () => {
  const sessions = Array.from({ length: 6 }, (_, i) =>
    session({ sessionId: `s${i}`, minutes: 0, seconds: 25, startedAt: `2026-07-24T01:0${i}:00Z`, endedAt: `2026-07-24T01:0${i}:25Z` })
  );
  const { byCategory } = aggregateSessionsByCategory(sessions);
  const bucket = byCategory.get("study.math.linearAlgebra");
  assert.equal(bucket.seconds, 150, "exact seconds must be summed with no rounding along the way");
  assert.equal(bucket.minutes, Math.round(150 / 60), "final minutes must be round(totalSeconds/60), not sum(round(sessionSeconds/60))");
  assert.notEqual(bucket.minutes, 0, "six real 25s sessions must not disappear into 0 minutes via naive per-session rounding");
});

test("aggregateSessionsByCategory falls back to minutes*60 when a legacy payload has no `seconds` field", () => {
  const { byCategory } = aggregateSessionsByCategory([
    session({ sessionId: "a", minutes: 12 }),
    session({ sessionId: "b", minutes: 30 }),
  ]);
  const bucket = byCategory.get("study.math.linearAlgebra");
  assert.equal(bucket.seconds, 42 * 60);
  assert.equal(bucket.minutes, 42);
});

// Real-world regression: a session that only landed in "misc" via a coarse
// mappingSource (project_bucket/misc_unclassified) — e.g. 做饭 16min via
// TickTick's Personal list, no matching taxonomy leaf — must produce a
// visible note line under misc, not just contribute silently to
// misc.today.totalMinutes with nothing to show where the minutes came from.
test("misc breakdown: a coarse-mapped session (做饭, mappingSource=misc_unclassified, no real note) gets a synthesized '做饭 16min' note line", () => {
  const cookingSession = session({ sessionId: "cook-1", categoryId: "misc", minutes: 16, note: null, rawTitle: "做饭", mappingSource: "misc_unclassified" });
  const { byCategory } = aggregateSessionsByCategory([cookingSession]);
  const bucket = byCategory.get("misc");
  assert.equal(bucket.minutes, 16);
  assert.equal(bucket.notes.length, 1);
  assert.match(bucket.notes[0], /做饭 16min/);
});

test("misc breakdown: a session's REAL note text always wins over the synthesized title+minutes fallback", () => {
  const cookingSession = session({ sessionId: "cook-2", categoryId: "misc", minutes: 16, note: "炖了汤", rawTitle: "做饭", mappingSource: "misc_unclassified" });
  const { byCategory } = aggregateSessionsByCategory([cookingSession]);
  assert.match(byCategory.get("misc").notes[0], /炖了汤/);
  assert.doesNotMatch(byCategory.get("misc").notes[0], /做饭 16min/);
});

test("misc breakdown: a session mapped via title_exact to a SPECIFIC misc.* leaf (never the bare misc bucket) never gets a synthesized note", () => {
  const preciseSession = session({ sessionId: "precise-1", categoryId: "misc.diary", minutes: 10, note: null, rawTitle: "写日记", mappingSource: "title_exact" });
  const { byCategory } = aggregateSessionsByCategory([preciseSession]);
  assert.deepEqual(byCategory.get("misc.diary").notes, []);
});

test("misc breakdown: a session bound via a CONFIRMED taskId_binding straight to the bare 'misc' bucket (not a misc.* leaf) still gets a synthesized note — the bucket itself has no field that names the activity", () => {
  // Real production shape: a fixed taskId binding for "做饭" that targets
  // categoryId "misc" directly (not a dedicated taxonomy leaf) — a
  // deliberate, CONFIRMED mapping, not a fallback, yet still opaque once
  // it's inside misc.today.totalMinutes with nothing else to show for it.
  const cookingBound = session({ sessionId: "cook-bound-1", categoryId: "misc", minutes: 16, note: null, rawTitle: "做饭", mappingSource: "taskId_binding", mappingConfidence: "confirmed" });
  const { byCategory } = aggregateSessionsByCategory([cookingBound]);
  assert.match(byCategory.get("misc").notes[0], /做饭 16min/);
});

test("misc breakdown: multiple coarse-mapped sessions under misc each get their own synthesized note line, never merged into one", () => {
  const sessions = [
    session({ sessionId: "cook-3", categoryId: "misc", minutes: 16, note: null, rawTitle: "做饭", mappingSource: "misc_unclassified", startedAt: "2026-07-24T04:33:00Z", endedAt: "2026-07-24T04:49:00Z" }),
    session({ sessionId: "chore-1", categoryId: "misc", minutes: 8, note: null, rawTitle: "打扫", mappingSource: "project_bucket", startedAt: "2026-07-24T06:00:00Z", endedAt: "2026-07-24T06:08:00Z" }),
  ];
  const { byCategory } = aggregateSessionsByCategory(sessions);
  const notes = byCategory.get("misc").notes;
  assert.equal(notes.length, 2);
  assert.ok(notes.some((n) => n.includes("做饭 16min")));
  assert.ok(notes.some((n) => n.includes("打扫 8min")));
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
  const { fieldUpdates } = buildFieldPatches({ byCategory });
  const keys = Object.keys(fieldUpdates);
  assert.deepEqual(keys.sort(), ["study.math.linearAlgebra.duration"]);
  assert.ok(!keys.some((key) => key.includes("profile") || key.includes("pointsBalance")), "no request-supplied field name can leak into the update");
});

test("26. a non-settled day's focusSync has no hasPostSettlementChanges flag at all", () => {
  const { byCategory, unmapped } = aggregateSessionsByCategory([session()]);
  const sync = buildFocusSync({ date: "2026-07-24", timezone: "Asia/Shanghai", sourceRevision: "abc", sessions: [session()], byCategory, unmapped, isSettled: false });
  assert.equal("hasPostSettlementChanges" in sync, false);
});
