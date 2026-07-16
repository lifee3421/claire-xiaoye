import assert from "node:assert/strict";
import test from "node:test";
import { chooseNewestPlannerState, loadPlannerRecovery, plannerRecoveryKey, savePlannerRecovery } from "./plannerDraftRecovery.js";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), values };
}

test("saves and restores a local planner draft by profile", () => {
  const local = storage();
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "local" }, settings: {}, updatedAt: "2026-07-16T10:00:00.000Z" }, local);
  assert.equal(loadPlannerRecovery("u1", local).draft.marker, "local");
  assert.equal(local.values.has(plannerRecoveryKey("u1")), true);
});

test("uses the newer local state but never restores an expired date", () => {
  const remote = { targetDate: "2026-07-17", marker: "remote", updatedAt: "2026-07-16T09:00:00.000Z" };
  const local = { draft: { targetDate: "2026-07-17", marker: "local" }, updatedAt: "2026-07-16T10:00:00.000Z" };
  assert.equal(chooseNewestPlannerState(remote, local, "2026-07-16").source, "local");
  assert.equal(chooseNewestPlannerState(remote, { ...local, draft: { ...local.draft, targetDate: "2026-07-15" } }, "2026-07-16").source, "remote");
});

test("keeps the newer cloud draft when local recovery is older or missing", () => {
  const remote = { targetDate: "2026-07-17", updatedAt: "2026-07-16T10:00:00.000Z" };
  const local = { draft: { targetDate: "2026-07-17" }, updatedAt: "2026-07-16T09:00:00.000Z" };
  assert.equal(chooseNewestPlannerState(remote, local).source, "remote");
  assert.equal(chooseNewestPlannerState(remote, null).source, "remote");
});
