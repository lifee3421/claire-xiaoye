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
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "local");
  assert.equal(local.values.has(plannerRecoveryKey("u1", "2026-07-17")), true);
});

test("still reads legacy profile-only recovery when the date-specific key is missing", () => {
  const local = storage();
  local.setItem(plannerRecoveryKey("u1"), JSON.stringify({
    draft: { targetDate: "2026-07-17", marker: "legacy" },
    updatedAt: "2026-07-16T10:00:00.000Z",
  }));
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "legacy");
  assert.equal(loadPlannerRecovery("u1", "2026-07-18", local), null);
});

test("isolates planner recovery by target date", () => {
  const local = storage();
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "today" }, settings: {}, updatedAt: "2026-07-16T10:00:00.000Z" }, "2026-07-17", local);
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-18", marker: "tomorrow" }, settings: {}, updatedAt: "2026-07-16T10:05:00.000Z" }, "2026-07-18", local);
  assert.notEqual(plannerRecoveryKey("u1", "2026-07-17"), plannerRecoveryKey("u1", "2026-07-18"));
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "today");
  assert.equal(loadPlannerRecovery("u1", "2026-07-18", local).draft.marker, "tomorrow");
});

test("updating one date does not overwrite another date recovery", () => {
  const local = storage();
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "today-a" }, updatedAt: "2026-07-16T10:00:00.000Z" }, "2026-07-17", local);
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-18", marker: "tomorrow" }, updatedAt: "2026-07-16T10:01:00.000Z" }, "2026-07-18", local);
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "today-b" }, updatedAt: "2026-07-16T10:02:00.000Z" }, "2026-07-17", local);
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "today-b");
  assert.equal(loadPlannerRecovery("u1", "2026-07-18", local).draft.marker, "tomorrow");
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
