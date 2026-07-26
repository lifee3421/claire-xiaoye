import test from "node:test";
import assert from "node:assert/strict";
import { findFocusOverrideConflicts, restoreFocusOverrideValues } from "./focusOverrideConflicts.js";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { resolveEffectiveReviewNumericValue } from "./effectiveReviewValue.js";

function focusField(autoValue) {
  return { value: "", autoValue, autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false };
}

function manuallyOverriddenFocusField(value, autoValue) {
  return { value, autoValue, autoValueSource: "ticktick_focus", source: "manual", manuallyEdited: true };
}

test("3. value=0, autoValue=56, manuallyEdited=true, autoValueSource=ticktick_focus => reported as a conflict with the real 中文 label", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = manuallyOverriddenFocusField(0, 56);
  draft.fields["study.english.vocabulary.duration"] = manuallyOverriddenFocusField(0, 7);

  const conflicts = findFocusOverrideConflicts(draft);
  assert.equal(conflicts.length, 2);
  const byId = Object.fromEntries(conflicts.map((c) => [c.fieldId, c]));
  assert.equal(byId["study.english.ieltsWriting.duration"].label, "雅思写作");
  assert.equal(byId["study.english.ieltsWriting.duration"].value, 0);
  assert.equal(byId["study.english.ieltsWriting.duration"].autoValue, 56);
  assert.equal(byId["study.english.vocabulary.duration"].label, "单词");
});

test("a field that is manuallyEdited but its value already MATCHES autoValue is not a conflict (nothing to warn about)", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = manuallyOverriddenFocusField(56, 56);
  assert.deepEqual(findFocusOverrideConflicts(draft), []);
});

test("a field with real Focus autoValue but manuallyEdited=false is not a conflict — this is the normal, working case", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = focusField(56);
  assert.deepEqual(findFocusOverrideConflicts(draft), []);
});

test("a manually-edited field whose source is NOT ticktick_focus (e.g. a legacy-imported value) is never flagged", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = { value: 30, autoValue: 30, source: "manual", manuallyEdited: true, autoValueSource: "default" };
  assert.deepEqual(findFocusOverrideConflicts(draft), []);
});

test("autoValue=0 is never flagged even if manuallyEdited — nothing real to restore to", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = manuallyOverriddenFocusField(20, 0);
  assert.deepEqual(findFocusOverrideConflicts(draft), []);
});

test("4. restoreFocusOverrideValues clears value/manuallyEdited/source for exactly the given fields, leaving autoValue/autoValueSource and every other field untouched — effective value becomes 56", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = manuallyOverriddenFocusField(0, 56);
  draft.fields["study.english.vocabulary.duration"] = manuallyOverriddenFocusField(0, 7);
  draft.fields["study.math.linearAlgebra.duration"] = manuallyOverriddenFocusField(999, 242); // untouched control

  const restored = restoreFocusOverrideValues(draft, ["study.english.ieltsWriting.duration", "study.english.vocabulary.duration"]);

  assert.equal(restored.fields["study.english.ieltsWriting.duration"].value, "");
  assert.equal(restored.fields["study.english.ieltsWriting.duration"].manuallyEdited, false);
  assert.equal(restored.fields["study.english.ieltsWriting.duration"].source, "default");
  assert.equal(restored.fields["study.english.ieltsWriting.duration"].autoValue, 56);
  assert.equal(restored.fields["study.english.ieltsWriting.duration"].autoValueSource, "ticktick_focus");
  assert.equal(restored.fields["study.english.vocabulary.duration"].value, "");

  assert.equal(restored.fields["study.math.linearAlgebra.duration"].value, 999, "an unrelated field must never be touched by the restore");
  const remainingConflictIds = findFocusOverrideConflicts(restored).map((c) => c.fieldId);
  assert.ok(!remainingConflictIds.includes("study.english.ieltsWriting.duration"));
  assert.ok(!remainingConflictIds.includes("study.english.vocabulary.duration"));
  assert.deepEqual(remainingConflictIds, ["study.math.linearAlgebra.duration"], "the untouched control field is still (correctly) its own separate conflict");
});

test("5. after restoring both, 英语总时长 = 单词7 + 雅思写作56 + 雅思听力39 + 雅思口语50 = 152min", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = manuallyOverriddenFocusField(0, 56);
  draft.fields["study.english.vocabulary.duration"] = manuallyOverriddenFocusField(0, 7);
  draft.fields["study.english.ieltsListening.duration"] = focusField(39);
  draft.fields["study.english.ieltsSpeaking.duration"] = focusField(50);

  const restored = restoreFocusOverrideValues(draft, ["study.english.ieltsWriting.duration", "study.english.vocabulary.duration"]);
  const total = ["study.english.ieltsWriting.duration", "study.english.vocabulary.duration", "study.english.ieltsListening.duration", "study.english.ieltsSpeaking.duration"]
    .reduce((sum, id) => sum + resolveEffectiveReviewNumericValue(restored.fields[id]), 0);
  assert.equal(total, 152);
});
