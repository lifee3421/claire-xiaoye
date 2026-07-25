import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveReviewValue, resolveEffectiveReviewNumericValue, isEmptyReviewValue } from "./effectiveReviewValue.js";

test("value=0, autoValue=56, autoValueSource=ticktick_focus, manuallyEdited=false => effective value is 56 (a stray 0 must never mask a real Focus autoValue)", () => {
  const value = resolveEffectiveReviewValue({ value: 0, autoValue: 56, autoValueSource: "ticktick_focus", manuallyEdited: false });
  assert.equal(value, 56);
});

test("value=0, autoValue=56, manuallyEdited=true => effective value is 0 (a genuine manual 0 always wins, even over a real autoValue)", () => {
  const value = resolveEffectiveReviewValue({ value: 0, autoValue: 56, autoValueSource: "ticktick_focus", manuallyEdited: true });
  assert.equal(value, 0);
});

test("value=\"\", autoValue=7 => effective value is 7 (empty value always falls through to autoValue, focus or not)", () => {
  const value = resolveEffectiveReviewValue({ value: "", autoValue: 7 });
  assert.equal(value, 7);
});

test("non-Focus field keeps the old semantics: a real manual value wins over autoValue even without manuallyEdited set", () => {
  const value = resolveEffectiveReviewValue({ value: "手写笔记", autoValue: "旧的默认文本", autoValueSource: "default", manuallyEdited: false });
  assert.equal(value, "手写笔记");
});

test("both empty => empty string", () => {
  assert.equal(resolveEffectiveReviewValue({ value: "", autoValue: "" }), "");
  assert.equal(resolveEffectiveReviewValue({}), "");
});

test("resolveEffectiveReviewNumericValue coerces to a finite number, defaulting to 0", () => {
  assert.equal(resolveEffectiveReviewNumericValue({ value: 0, autoValue: 56, autoValueSource: "ticktick_focus" }), 56);
  assert.equal(resolveEffectiveReviewNumericValue({ value: "", autoValue: "" }), 0);
});

test("isEmptyReviewValue treats 0 and false as NOT empty, only '', null, undefined as empty", () => {
  assert.equal(isEmptyReviewValue(0), false);
  assert.equal(isEmptyReviewValue(""), true);
  assert.equal(isEmptyReviewValue(null), true);
  assert.equal(isEmptyReviewValue(undefined), true);
});

test("manual override survives even when the Focus source keeps sending a DIFFERENT autoValue on later syncs", () => {
  // Regression for requirement 9: manual edits must never be silently
  // reclaimed by a later, non-matching autoValue.
  const value = resolveEffectiveReviewValue({ value: 120, autoValue: 56, autoValueSource: "ticktick_focus", manuallyEdited: true });
  assert.equal(value, 120);
});
