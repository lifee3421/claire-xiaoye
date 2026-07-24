import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft } from "./dailyReviewSchema.js";
import {
  STUDY_LEAF_GROUPS,
  getStudyLeafKey,
  hasStudyLeafContent,
  isStudyLeafVisible,
  getVisibleStudyLeafGroups,
  getHiddenStudyLeaves,
} from "./reviewStudyLeafConfig.js";

function mathGroup() {
  return STUDY_LEAF_GROUPS.find((g) => g.id === "math");
}

function setField(draft, id, value) {
  draft.fields[id] = { ...draft.fields[id], value, autoValue: value };
}

test("hasStudyLeafContent is false when empty and true once duration/progress/adjustment has a value", () => {
  const draft = createReviewDraft("2026-07-24", {});
  const linAlg = mathGroup().items.find((i) => i.id === "linearAlgebra");

  assert.equal(hasStudyLeafContent(linAlg, draft), false);

  setField(draft, "study.math.linearAlgebra.duration", 40);
  assert.equal(hasStudyLeafContent(linAlg, draft), true);
});

test("isStudyLeafVisible: draftHidden wins over content, defaults, and today-added", () => {
  const draft = createReviewDraft("2026-07-24", {});
  const linAlg = mathGroup().items.find((i) => i.id === "linearAlgebra");
  const key = getStudyLeafKey("math", "linearAlgebra");
  setField(draft, "study.math.linearAlgebra.duration", 40);

  assert.equal(isStudyLeafVisible(linAlg, key, draft, [key], [key], []), true);
  assert.equal(isStudyLeafVisible(linAlg, key, draft, [key], [key], [key]), false);
});

test("getVisibleStudyLeafGroups only includes math when only linearAlgebra has content, and hides empty groups entirely", () => {
  const draft = createReviewDraft("2026-07-24", {});
  setField(draft, "study.math.linearAlgebra.duration", 40);

  const visible = getVisibleStudyLeafGroups(draft, [], [], []);
  assert.deepEqual(visible.map((g) => g.id), ["math"]);
  assert.deepEqual(visible[0].items.map((i) => i.id), ["linearAlgebra"]);
});

test("getHiddenStudyLeaves lists every leaf not currently visible", () => {
  const draft = createReviewDraft("2026-07-24", {});
  setField(draft, "study.math.linearAlgebra.duration", 40);

  const totalLeaves = STUDY_LEAF_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
  const visible = getVisibleStudyLeafGroups(draft, [], [], []).reduce((sum, g) => sum + g.items.length, 0);
  const hidden = getHiddenStudyLeaves(draft, [], [], []);

  assert.equal(hidden.length, totalLeaves - visible);
  assert.ok(hidden.some((entry) => entry.leafKey === getStudyLeafKey("math", "calculus")));
});
