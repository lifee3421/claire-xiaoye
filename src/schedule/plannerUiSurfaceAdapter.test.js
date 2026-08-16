import assert from "node:assert/strict";
import test from "node:test";
import { buildCreateTaskChange, buildReplaceDayStateChange, buildSegmentEditChange } from "./plannerUiSurfaceAdapter.js";

test("ordinary title/time/duration/status edits become typed edit_task changes", () => {
  assert.deepEqual(buildSegmentEditChange("math-1", { title: "数学二刷", manualStart: 900, workMinutes: 45, status: "completed", locked: true }), {
    type: "edit_task", blockId: "math-1", start: "15:00", title: "数学二刷", estimatedMinutes: 45, locked: true, status: "completed",
  });
});

test("return-to-pool stays a typed direct operation", () => {
  assert.deepEqual(buildSegmentEditChange("math-1", { placement: "pool", manualStart: null }), { type: "return_to_pool", blockId: "math-1" });
});

test("inbox/new block provenance survives create_task adapter", () => {
  const change = buildCreateTaskChange({ id: "custom-1", title: "背单词", segments: [30], source: "inbox", sourceId: "inbox-1", originInboxItemId: "inbox-1" });
  assert.equal(change.taskId, "custom-1");
  assert.equal(change.source, "inbox");
  assert.equal(change.originInboxItemId, "inbox-1");
});

test("bulk state replacement is explicitly proposal-shaped", () => {
  const change = buildReplaceDayStateChange({ targetDate: "2026-08-16", targetBedTime: "23:30", stickers: [{ id: "sidecar" }] });
  assert.equal(change.type, "replace_day_state");
  assert.equal(change.state.targetBedTime, "23:30");
  assert.equal(Object.prototype.hasOwnProperty.call(change.state, "stickers"), false);
});
