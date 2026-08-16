import assert from "node:assert/strict";
import test from "node:test";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { handlePlannerLedgerRequest } from "./planner-ledger.js";

function fakeDb(initialProfile = {}) {
  let profile = structuredClone(initialProfile);
  const userRef = { path: "users/u1" };
  return {
    collection(name) {
      assert.equal(name, "users");
      return { doc(uid) { assert.equal(uid, "u1"); return userRef; } };
    },
    async runTransaction(fn) {
      return fn({
        async get(ref) { assert.equal(ref, userRef); return { exists: true, data: () => structuredClone(profile) }; },
        set(ref, patch, options) {
          assert.equal(ref, userRef);
          assert.deepEqual(options, { merge: true });
          profile = { ...profile, ...structuredClone(patch) };
        },
      });
    },
    readProfile() { return structuredClone(profile); },
  };
}

test("plannerInbox mutation does not alter the canonical daily schedule revision", async () => {
  const scheduleAssistantDraft = {
    targetDate: "2026-08-16",
    savedOn: "2026-08-16",
    updatedAt: "2026-08-16T01:00:00.000Z",
    todayCustomBlocks: [{ id: "math", title: "数学", segments: [50], manualStart: 840 }],
    todaySegmentOverrides: {},
  };
  const db = fakeDb({ scheduleAssistantDraft, plannerInbox: [] });
  const before = computePlannerContextBaseRevision({ draft: db.readProfile().scheduleAssistantDraft });

  const result = await handlePlannerLedgerRequest({
    db,
    uid: "u1",
    body: { action: "create", operationId: "snow:ledger:revision-boundary", item: { title: "记得带水杯", kind: "note", targetDate: "2026-08-16" } },
    now: new Date("2026-08-16T02:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(db.readProfile().plannerInbox.length, 1);
  assert.deepEqual(db.readProfile().scheduleAssistantDraft, scheduleAssistantDraft);
  assert.equal(computePlannerContextBaseRevision({ draft: db.readProfile().scheduleAssistantDraft }), before);
});
