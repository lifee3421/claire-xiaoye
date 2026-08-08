import test from "node:test";
import assert from "node:assert/strict";
import { resolveDailyStudyTargets } from "./studyTargetResolver.js";

const taxonomy = [{
  id: "study",
  name: "学习",
  level: 1,
  children: [
    { id: "study.math", name: "数学", level: 2, statGroup: "study", enabled: true },
    { id: "study.english", name: "英语", level: 2, statGroup: "study", enabled: true },
  ],
}];

test("explicit per-day target remains authoritative over defaults", () => {
  const defaults = {
    schemaVersion: 1,
    entries: {
      "study.math": { enabled: true, minutes: 240 },
      "study.english": { enabled: true, minutes: 180 },
    },
  };
  const resolved = resolveDailyStudyTargets({
    defaults,
    overrides: { "study.math": 300, "study.english": 120 },
    categoryTree: taxonomy,
  });
  assert.deepEqual(resolved.byCategory, { "study.math": 300, "study.english": 120 });
  assert.equal(resolved.totalMinutes, 420);
});
