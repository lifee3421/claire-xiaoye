import assert from "node:assert/strict";
import test from "node:test";
import { initialPlannerTab, isTodayPlannerPath, plannerPathForTab } from "./plannerTodayRoute.js";

test("/today is the only Planner deep-link route", () => {
  assert.equal(isTodayPlannerPath("/today"), true);
  assert.equal(isTodayPlannerPath("/today/"), true);
  assert.equal(isTodayPlannerPath("/today/anything"), false);
  assert.equal(isTodayPlannerPath("/"), false);
});

test("the Today deep link opens the existing schedule surface", () => {
  assert.equal(initialPlannerTab("/today"), "schedule");
  assert.equal(initialPlannerTab("/"), "dashboard");
  assert.equal(plannerPathForTab("schedule"), "/today");
  assert.equal(plannerPathForTab("weekly"), "/");
});
