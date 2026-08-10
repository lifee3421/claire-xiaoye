import assert from "node:assert/strict";
import test from "node:test";
import { validateDirectPlannerChanges } from "./planner-direct-edit.js";

test("direct edit accepts a small batch of ordinary-card mutations", () => {
  assert.deepEqual(validateDirectPlannerChanges([
    { type: "move", blockId: "math-1", start: "20:00" },
    { type: "edit_task", blockId: "math-2", title: "数学复习" },
  ]), []);
});

test("template apply and large replans stay behind proposal confirmation", () => {
  assert.match(validateDirectPlannerChanges([{ type: "apply_template", templateId: "tpl" }])[0], /requires PlannerProposal/);
  const large = validateDirectPlannerChanges([
    { type: "move" }, { type: "move" }, { type: "move" }, { type: "move" },
  ]);
  assert.match(large[0], /at most 3 changes/);
});
