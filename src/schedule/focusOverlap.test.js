import test from "node:test";
import assert from "node:assert/strict";
import {
  isoToBeijingMinutesOfDay,
  normalizeFocusIntervals,
  mergeIntervals,
  overlapMinutes,
  computeBlockFocusCoverage,
  computeTimelineFocusCoverage,
  aggregateFocusCoverageByCategory,
  resolveBlockSettlementStatus,
} from "./focusOverlap.js";

test("isoToBeijingMinutesOfDay converts a UTC instant to Beijing minute-of-day", () => {
  assert.equal(isoToBeijingMinutesOfDay("2026-07-30T01:10:00.000Z", "2026-07-30"), 550); // 09:10 Beijing
});

test("spec example 1: a single Focus interval inside a card counts only its own overlap", () => {
  const block = { id: "c1", kind: "task", start: 1020, end: 1070, workMinutes: 50 }; // 17:00-17:50
  const merged = mergeIntervals(normalizeFocusIntervals([{ start: 1025, end: 1065 }])); // 17:05-17:45
  const coverage = computeBlockFocusCoverage({ block, mergedFocusIntervals: merged, nowMinutes: 1200, focusStatus: "fresh" });
  assert.equal(coverage.focusOverlapMinutes, 40);
});

test("spec example 2: one Focus interval split across two adjacent cards, gap unassigned, no double count", () => {
  const cardA = { id: "A", kind: "task", start: 1020, end: 1070, workMinutes: 50 }; // 17:00-17:50
  const cardB = { id: "B", kind: "task", start: 1080, end: 1130, workMinutes: 50 }; // 18:00-18:50
  const merged = mergeIntervals(normalizeFocusIntervals([{ start: 1060, end: 1100 }])); // 17:40-18:20
  const coverageA = computeBlockFocusCoverage({ block: cardA, mergedFocusIntervals: merged, nowMinutes: 1300 });
  const coverageB = computeBlockFocusCoverage({ block: cardB, mergedFocusIntervals: merged, nowMinutes: 1300 });
  assert.equal(coverageA.focusOverlapMinutes, 10);
  assert.equal(coverageB.focusOverlapMinutes, 20);
  // total attributed (30) is less than the raw focus session length (40) -- the 17:50-18:00 gap is not assigned to either card.
  assert.equal(coverageA.focusOverlapMinutes + coverageB.focusOverlapMinutes, 30);
});

test("spec example 3: two overlapping Focus intervals merge to 50 minutes, not sum to 60", () => {
  const merged = mergeIntervals(normalizeFocusIntervals([
    { start: 1020, end: 1050 }, // 17:00-17:30
    { start: 1040, end: 1070 }, // 17:20-17:50
  ]));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].start, 1020);
  assert.equal(merged[0].end, 1070);
  const block = { id: "c1", kind: "task", start: 1020, end: 1070, workMinutes: 50 };
  const coverage = computeBlockFocusCoverage({ block, mergedFocusIntervals: merged, nowMinutes: 1200 });
  assert.equal(coverage.focusOverlapMinutes, 50);
});

test("in-card rest is excluded from the plan's effective work segment", () => {
  // Footprint 60 minutes (10:00-11:00), but only 40 are active work (workMinutes), 20 trailing rest.
  const block = { id: "c1", kind: "task", start: 600, end: 660, workMinutes: 40 };
  const merged = mergeIntervals(normalizeFocusIntervals([{ start: 600, end: 660 }])); // a Focus session spanning the whole footprint
  const coverage = computeBlockFocusCoverage({ block, mergedFocusIntervals: merged, nowMinutes: 800 });
  assert.equal(coverage.plannedWorkMinutes, 40);
  assert.equal(coverage.focusOverlapMinutes, 40); // capped at the active segment, not the full 60-minute footprint
});

test("settlement status: current/just-ended card waits inside the sync buffer, not shown as 0", () => {
  const block = { id: "c1", kind: "task", start: 600, end: 650, workMinutes: 50 }; // ends at 650
  assert.equal(resolveBlockSettlementStatus({ block, nowMinutes: 655, focusStatus: "fresh" }), "waiting"); // 5 min after end, inside 10-min buffer
  assert.equal(resolveBlockSettlementStatus({ block, nowMinutes: 661, focusStatus: "fresh" }), "settled"); // 11 min after end
  assert.equal(resolveBlockSettlementStatus({ block, nowMinutes: 800, focusStatus: "stale" }), "stale");
  assert.equal(resolveBlockSettlementStatus({ block, nowMinutes: 800, focusStatus: "unavailable" }), "unavailable");
});

test("computeTimelineFocusCoverage and aggregateFocusCoverageByCategory roll up per-category totals", () => {
  const blocks = [
    { id: "A", kind: "task", start: 1020, end: 1070, workMinutes: 50, categoryId: "study.math" },
    { id: "B", kind: "task", start: 1080, end: 1130, workMinutes: 50, categoryId: "study.math" },
  ];
  const coverages = computeTimelineFocusCoverage({ blocks, focusSessions: [{ start: 1060, end: 1100 }], nowMinutes: 1300 });
  const byId = new Map(coverages.map((c) => [c.blockId, c]));
  const totals = aggregateFocusCoverageByCategory({ blocks, coverageByBlockId: byId });
  assert.equal(totals.length, 1);
  assert.equal(totals[0].categoryId, "study.math");
  assert.equal(totals[0].focusOverlapMinutes, 30);
  assert.equal(totals[0].plannedWorkMinutes, 100);
});

test("overlapMinutes handles disjoint, touching, and fully-contained intervals", () => {
  assert.equal(overlapMinutes(0, 10, 20, 30), 0);
  assert.equal(overlapMinutes(0, 10, 10, 20), 0);
  assert.equal(overlapMinutes(0, 20, 5, 15), 10);
});

test("a rescheduled-away original block never participates in Focus coverage, even if a Focus session still overlaps its old slot", () => {
  const originalBlock = { id: "math-lecture-1", kind: "task", start: 540, end: 590, workMinutes: 50, status: "rescheduled", categoryId: "study.math" };
  const coverages = computeTimelineFocusCoverage({ blocks: [originalBlock], focusSessions: [{ start: 540, end: 590 }], nowMinutes: 700 });
  assert.equal(coverages.length, 0);
});
