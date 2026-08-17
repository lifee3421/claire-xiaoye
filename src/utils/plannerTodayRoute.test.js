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
});

test("desktop schedule navigation stays on the desktop shell", () => {
  assert.equal(plannerPathForTab("schedule", "/"), "/");
  assert.equal(plannerPathForTab("schedule", "/dashboard"), "/");
  assert.equal(plannerPathForTab("weekly", "/"), "/");
});

test("an explicit Today session keeps /today only while on schedule", () => {
  assert.equal(plannerPathForTab("schedule", "/today"), "/today");
  assert.equal(plannerPathForTab("schedule", "/today/"), "/today");
  assert.equal(plannerPathForTab("weekly", "/today"), "/");
});
