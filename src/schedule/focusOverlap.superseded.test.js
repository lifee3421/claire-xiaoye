import test from "node:test";
import assert from "node:assert/strict";
import { computeTimelineFocusCoverage } from "./focusOverlap.js";

test("superseded (cancelled) blocks contribute zero Focus overlap", () => {
  const blocks = [
    { id: "b1", kind: "task", categoryId: "study.math", start: 540, end: 590, status: "cancelled" },
  ];
  const coverage = computeTimelineFocusCoverage({
    blocks,
    focusSessions: [{ start: 540, end: 590, categoryId: "study.math" }],
    targetDateIso: "2026-08-03",
  });
  assert.equal(coverage.length, 0, "a cancelled historical block is excluded entirely from Focus coverage");
});

test("superseded (rescheduled) blocks contribute zero Focus overlap", () => {
  const blocks = [
    { id: "b1", kind: "task", categoryId: "study.math", start: 540, end: 590, status: "rescheduled" },
  ];
  const coverage = computeTimelineFocusCoverage({
    blocks,
    focusSessions: [{ start: 540, end: 590, categoryId: "study.math" }],
    targetDateIso: "2026-08-03",
  });
  assert.equal(coverage.length, 0);
});

test("live block still counts Focus overlap", () => {
  const blocks = [
    { id: "b1", kind: "task", categoryId: "study.math", start: 540, end: 590, status: "pending" },
  ];
  const coverage = computeTimelineFocusCoverage({
    blocks,
    focusSessions: [{ start: 540, end: 590, categoryId: "study.math" }],
    targetDateIso: "2026-08-03",
  });
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].focusOverlapMinutes, 50);
});
