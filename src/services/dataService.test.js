import test from "node:test";
import assert from "node:assert/strict";
import { buildMaskCyclePatch } from "./maskCyclePatch.js";

test("missing mask cycle data does not clear the stored profile cycle", () => {
  const patch = buildMaskCyclePatch({
    reviewDate: "2026-07-23",
    generatedMinutes: 300,
    health: { maskStatus: "否" },
  }, { status: "明日应敷", customNote: "keep" });
  assert.equal(patch, null);
});

test("an explicit mask cycle keeps unrelated stored cycle fields and mask completion updates last date", () => {
  const patch = buildMaskCyclePatch({
    reviewDate: "2026-07-23",
    generatedMinutes: 300,
    health: { maskStatus: "是" },
    maskCycleStatus: "今日已敷",
    maskCycleMessage: "下次建议 2026-07-26",
    maskTomorrowDate: "2026-07-24",
    lastMaskDateAfterReview: "2026-07-23",
  }, { customNote: "keep" });
  assert.equal(patch.customNote, "keep");
  assert.equal(patch.lastMaskDateAfterReview, "2026-07-23");
  assert.equal(patch.status, "今日已敷");
});
