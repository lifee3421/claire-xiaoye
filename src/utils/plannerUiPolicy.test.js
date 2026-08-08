import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowTimelineCompletionToggle } from "./plannerUiPolicy.js";
import { LIFE_CATEGORY_IDS } from "./unifiedPlannerCards.js";

test("study tasks do not expose a manual completion checkbox", () => {
  assert.equal(shouldShowTimelineCompletionToggle({ kind: "task", title: "数学｜习题", categoryId: "study.math.calculus", status: "pending" }), false);
});

test("meal fixed cards keep the manual completion checkbox", () => {
  assert.equal(shouldShowTimelineCompletionToggle({ kind: "fixed", title: "午餐", categoryId: LIFE_CATEGORY_IDS.lunch, type: "meal", status: "pending" }), true);
  assert.equal(shouldShowTimelineCompletionToggle({ kind: "fixed", title: "晚餐", categoryId: LIFE_CATEGORY_IDS.dinner, type: "meal", status: "pending" }), true);
});

test("superseded meal cards are inert", () => {
  assert.equal(shouldShowTimelineCompletionToggle({ kind: "fixed", title: "午餐", type: "meal", status: "cancelled" }), false);
});
