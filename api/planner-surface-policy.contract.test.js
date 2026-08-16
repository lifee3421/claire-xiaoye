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
  assert.match(source, /planner_unstaged_schedule_change/);
});

test("dangerous Xiaoye surfaces stay proposal-gated", () => {
  const source = fs.readFileSync("src/App.jsx", "utf8");
  const proposalFunctions = [
    "clearTaskPool",
    "applyRecoveryPlanner",
    "clearFutureSchedule",
    "saveFixedEventOverride",
    "clearScheduleScope",
    "rescheduleScope",
    "applyQuickDayTemplate",
    "applySelectedTemplate",
  ];
  for (const name of proposalFunctions) {
    const start = source.indexOf(`function ${name}`);
    if (start < 0) continue;
    const next = source.indexOf("\n  function ", start + 12);
    const body = source.slice(start, next > start ? next : start + 5000);
    assert.match(body, /commitProposalDraftChange/, `${name} must remain proposal-only`);
  }
  assert.match(source, /prefix: "undo", mode: "proposal"/);
  assert.match(source, /prefix: "redo", mode: "proposal"/);
});

test("stale UI never reports optimistic success and forces authoritative reconcile", () => {
  const source = fs.readFileSync("src/App.jsx", "utf8");
  assert.match(source, /code === "stale"/);
  assert.match(source, /日程刚刚有更新，已经帮你刷新。/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /plannerMutationResults\?\.at\(-1\)\?\.appliedRevision/);
  assert.match(source, /appliedRevision \? \(mode === "manual" \? "已确认并保存" : "已确认云端排程"\)/);
});
