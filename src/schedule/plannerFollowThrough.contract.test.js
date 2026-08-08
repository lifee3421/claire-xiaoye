import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

test("tracker overview follows the active planner date", () => {
  assert.match(appSource, /resolveTrackerOverviewFacts\(\{ loadFacts: onLoadTrackerFacts, trackers: effectiveTrackers, targetDate: draft\.targetDate \}\)/);
  assert.match(appSource, /trackerToday=\{draft\.targetDate\}/);
  assert.doesNotMatch(appSource, /trackerToday=\{beijingDay\}/);
});

test("planner exposes one learning-target entry and no legacy plan-target card", () => {
  assert.match(appSource, />\s*学习目标\s*<\/button>/);
  assert.doesNotMatch(appSource, />\s*设置计划目标\s*<\/button>/);
  assert.doesNotMatch(appSource, />\s*学习目标默认值\s*<\/button>/);
  assert.doesNotMatch(appSource, /<strong>计划时长进度<\/strong>/);
});

test("daily target save is an immediate planner persistence operation", () => {
  assert.match(appSource, /persistPlannerNow\("manual", nextDraft\)/);
  assert.match(appSource, /studyTargetSnapshot: null/);
  assert.match(appSource, /persistPlannerNow\("manual", draft, nextSettings\)/);
});

test("timeline checkbox uses the meal-only UI policy", () => {
  assert.match(appSource, /shouldShowTimelineCompletionToggle\(block\) && \(/);
  assert.doesNotMatch(appSource, /\{block\.kind === "task" && !isSuperseded && \(\s*<button\s*\n\s*type="button"\s*\n\s*className=\{`timeline-task-checkbox-hit-area/);
});
