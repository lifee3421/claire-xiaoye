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

test("parseDurationText treats empty input as zero and rejects garbage", () => {
  assert.equal(parseDurationText(""), 0);
  assert.equal(parseDurationText("   "), 0);
  assert.equal(parseDurationText(undefined), 0);
  assert.equal(parseDurationText("abc"), null);
  assert.equal(parseDurationText("1h20"), null);
});

test("formatDurationInput mirrors parseDurationText for round-tripping", () => {
  assert.equal(formatDurationInput(80), "1h20min");
  assert.equal(formatDurationInput(60), "1h");
  assert.equal(formatDurationInput(45), "45min");
  assert.equal(formatDurationInput(0), "");
  assert.equal(formatDurationInput(""), "");
});
