import assert from "node:assert/strict";
import test from "node:test";
import { PLANNER_PATCH_SCHEMA_VERSION, isPlannerPatchStale, validatePlannerPatchShape } from "./plannerPatch.js";

function validPatch(overrides = {}) {
  return {
    schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
    date: "2026-08-06",
    baseRevision: "v1:2026-08-06T01:00:00.000Z:abc123",
    changes: [{ type: "move", blockId: "math-1", start: "14:00" }],
    ...overrides,
  };
}

test("validatePlannerPatchShape accepts a well-formed patch", () => {
  assert.deepEqual(validatePlannerPatchShape(validPatch()), []);
});

test("validatePlannerPatchShape rejects a missing/wrong schemaVersion", () => {
  assert.ok(validatePlannerPatchShape(validPatch({ schemaVersion: 99 })).length > 0);
});

test("validatePlannerPatchShape rejects an empty changes array", () => {
  assert.ok(validatePlannerPatchShape(validPatch({ changes: [] })).length > 0);
});

test("validatePlannerPatchShape requires blockId for move/return_to_pool/schedule_from_pool but not create_from_tracker", () => {
  assert.ok(validatePlannerPatchShape(validPatch({ changes: [{ type: "move", start: "14:00" }] })).length > 0);
  assert.deepEqual(validatePlannerPatchShape(validPatch({ changes: [{ type: "create_from_tracker", trackerId: "mask" }] })), []);
});

test("validatePlannerPatchShape requires start for move/schedule_from_pool", () => {
  assert.ok(validatePlannerPatchShape(validPatch({ changes: [{ type: "schedule_from_pool", blockId: "math-2" }] })).length > 0);
});

test("validatePlannerPatchShape requires trackerId for create_from_tracker", () => {
  assert.ok(validatePlannerPatchShape(validPatch({ changes: [{ type: "create_from_tracker" }] })).length > 0);
});

test("validatePlannerPatchShape rejects an unknown change type", () => {
  assert.ok(validatePlannerPatchShape(validPatch({ changes: [{ type: "delete_everything", blockId: "x" }] })).length > 0);
});

test("isPlannerPatchStale: true when baseRevision no longer matches the current plan", () => {
  const patch = validPatch({ baseRevision: "v1:old" });
  assert.equal(isPlannerPatchStale(patch, "v1:new"), true);
  assert.equal(isPlannerPatchStale(patch, "v1:old"), false);
});
