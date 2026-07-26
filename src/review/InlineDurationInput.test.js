import test from "node:test";
import assert from "node:assert/strict";
import { parseDurationText, formatDurationInput } from "./durationText.js";
import { shouldCommitDurationInput, normalizeCommittedDurationValue } from "./inlineDurationCommit.js";

test("parseDurationText handles the documented formats", () => {
  assert.equal(parseDurationText("1h20min"), 80);
  assert.equal(parseDurationText("1h"), 60);
  assert.equal(parseDurationText("45min"), 45);
  assert.equal(parseDurationText("80"), 80);
  assert.equal(parseDurationText("1:20"), 80);
});

test("parseDurationText treats empty input as empty (not zero minutes) and rejects garbage", () => {
  assert.equal(parseDurationText(""), "");
  assert.equal(parseDurationText("   "), "");
  assert.equal(parseDurationText(undefined), "");
  assert.equal(parseDurationText("abc"), null);
  assert.equal(parseDurationText("1h20"), null);
});

test("parseDurationText accepts a bare leading digit mid-typing (e.g. '1') without requiring a unit", () => {
  // This is what lets the user type "1" -> "1h" -> "1h20min" without the
  // component rejecting the intermediate state as invalid.
  assert.equal(parseDurationText("1"), 1);
});

test("formatDurationInput mirrors parseDurationText for round-tripping", () => {
  assert.equal(formatDurationInput(80), "1h20min");
  assert.equal(formatDurationInput(60), "1h");
  assert.equal(formatDurationInput(45), "45min");
  assert.equal(formatDurationInput(0), "");
  assert.equal(formatDurationInput(""), "");
});

// --- commit-guard: fixes InlineDurationInput unconditionally committing
// (and therefore marking manuallyEdited=true) on every blur, even with no
// real edit — the actual source of the 雅思写作/单词 "fake manual override"
// that masked a real Focus autoValue.

test("1. focusing then blurring WITHOUT typing anything is a no-op — the parsed (unchanged) text equals the committed baseline", () => {
  const baseline = normalizeCommittedDurationValue(56); // Focus wrote 56min
  const parsedOnBlurWithNoEdit = 56; // formatDurationInput(56) -> "56min" -> parseDurationText -> 56
  assert.equal(shouldCommitDurationInput(parsedOnBlurWithNoEdit, baseline), false);
});

test("2. actually changing the number does trigger a commit", () => {
  const baseline = normalizeCommittedDurationValue(56);
  assert.equal(shouldCommitDurationInput(30, baseline), true);
});

test("retyping the exact same value the user already committed is also a no-op on the SECOND commit", () => {
  let committed = normalizeCommittedDurationValue(56);
  assert.equal(shouldCommitDurationInput(30, committed), true);
  committed = 30; // component updates committedRef after a real commit
  assert.equal(shouldCommitDurationInput(30, committed), false, "typing the same 30 again must not re-fire");
});

test("6. a genuine manual 0 fires exactly once, then stays a no-op on subsequent blurs until it actually changes again", () => {
  let committed = normalizeCommittedDurationValue(56); // Focus autoValue baseline
  assert.equal(shouldCommitDurationInput(0, committed), true, "typing a real 0 must commit, even though 0 is falsy");
  committed = 0;
  assert.equal(shouldCommitDurationInput(0, committed), false, "blurring again with the same 0 already committed must not re-fire");
});

test("normalizeCommittedDurationValue treats '', null, undefined as the same empty baseline (never confused with a real 0)", () => {
  assert.equal(normalizeCommittedDurationValue(""), "");
  assert.equal(normalizeCommittedDurationValue(null), "");
  assert.equal(normalizeCommittedDurationValue(undefined), "");
  assert.equal(normalizeCommittedDurationValue(0), 0, "a real 0 is never coerced to empty");
});
