import test from "node:test";
import assert from "node:assert/strict";
import { parseDurationText, formatDurationInput } from "./durationText.js";

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
