import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validatePlannerUiMutation } from "./planner-mutate.js";

test("proposal-only replacement/template can never enter direct UI endpoint", () => {
  for (const change of [
    { type: "replace_day_state", state: { targetBedTime: "23:30" } },
    { type: "apply_template", templateId: "t1" },
  ]) {
    const problems = validatePlannerUiMutation({ date: "2026-08-16", baseRevision: "v1:x:deadbeef", operationId: "xiaoye:test:1", changes: [change] });
    assert.ok(problems.some((item) => item.includes("not a direct UI timeline mutation")));
  }
});

test("browser proposal adapters reuse shared proposal/apply cores", () => {
  const proposal = fs.readFileSync("api/planner-ui-proposal.js", "utf8");
  const apply = fs.readFileSync("api/planner-ui-proposal-apply.js", "utf8");
  assert.match(proposal, /handlePlannerProposalRequest/);
  assert.match(apply, /handlePlannerApplyRequest/);
});

test("browser profile persistence contains no canonical draft/archive Firestore assignment", () => {
  const source = fs.readFileSync("src/services/dataService.js", "utf8");
  assert.doesNotMatch(source, /payload\.scheduleAssistantDraft\s*=/);
  assert.doesNotMatch(source, /payload\.scheduleAssistantDraftArchive\s*=/);
  assert.match(source, /savePlannerDraftSidecar/);
});
