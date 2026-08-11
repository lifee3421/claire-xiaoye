import assert from "node:assert/strict";
import test from "node:test";
import { resolveDailyStudyTargets, resolveEffectiveTarget } from "./studyTargetResolver.js";

const categoryTree = [
  {
    id: "study",
    name: "学习",
    children: [
      { id: "study.math", name: "数学", statGroup: "study", enabled: true },
      { id: "study.finance", name: "专业课", statGroup: "study", enabled: true },
    ],
  },
];

const defaults = {
  entries: {
    "study.math": { enabled: true, minutes: 240 },
    "study.finance": { enabled: true, minutes: 150 },
  },
};

test("an empty captured snapshot cannot mask configured defaults on a new day", () => {
  const draftResolved = resolveDailyStudyTargets({ defaults, overrides: {}, categoryTree });
  const effective = resolveEffectiveTarget({
    snapshot: { targetDate: "2026-08-11", totalMinutes: 0, byCategory: {} },
    draftResolved,
  });

  assert.equal(effective.source, "draft");
  assert.equal(effective.totalMinutes, 390);
  assert.deepEqual(effective.byCategory, { "study.math": 240, "study.finance": 150 });
});

test("an explicit zero target remains frozen when the snapshot has category keys", () => {
  const draftResolved = resolveDailyStudyTargets({ defaults, overrides: {}, categoryTree });
  const effective = resolveEffectiveTarget({
    snapshot: { targetDate: "2026-08-11", totalMinutes: 0, byCategory: { "study.math": 0 } },
    draftResolved,
  });

  assert.equal(effective.source, "snapshot");
  assert.deepEqual(effective.byCategory, { "study.math": 0 });
});
