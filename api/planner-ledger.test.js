import assert from "node:assert/strict";
import test from "node:test";
import { handlePlannerLedgerRequest } from "./planner-ledger.js";

function fakeDb(initialProfile = {}) {
  let profile = structuredClone(initialProfile);
  const userRef = { path: "users/u1" };
  return {
    collection(name) {
      assert.equal(name, "users");
      return {
        doc(uid) {
          assert.equal(uid, "u1");
          return userRef;
        },
      };
    },
    async runTransaction(fn) {
      return fn({
        async get(ref) {
          assert.equal(ref, userRef);
          return { exists: true, data: () => structuredClone(profile) };
        },
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

test("replaying the same ledger create operation returns the original item instead of creating a duplicate", async () => {
  const db = fakeDb({ plannerInbox: [] });
  const body = {
    action: "create",
    operationId: "snowdust:ledger:00000001",
    item: { title: "明天带水杯", kind: "note", targetDate: "2026-08-15" },
  };
  const first = await handlePlannerLedgerRequest({ db, uid: "u1", body, now: new Date("2026-08-14T01:00:00.000Z") });
  const second = await handlePlannerLedgerRequest({ db, uid: "u1", body, now: new Date("2026-08-14T01:00:05.000Z") });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.id, first.id);
  assert.deepEqual(second.item, first.item);
  assert.equal(db.readProfile().plannerInbox.length, 1);
  assert.equal(db.readProfile().plannerBridgeOperationReceipts.length, 1);
});

test("one operation id cannot silently authorize a different ledger mutation", async () => {
  const db = fakeDb({ plannerInbox: [] });
  const operationId = "snowdust:ledger:00000002";
  const first = await handlePlannerLedgerRequest({
    db,
    uid: "u1",
    body: { action: "create", operationId, item: { title: "数学" } },
    now: new Date("2026-08-14T01:00:00.000Z"),
  });
  assert.equal(first.ok, true);

  const mismatch = await handlePlannerLedgerRequest({
    db,
    uid: "u1",
    body: { action: "create", operationId, item: { title: "英语" } },
    now: new Date("2026-08-14T01:01:00.000Z"),
  });
  assert.deepEqual(mismatch, { ok: false, reason: "operation_id_reused" });
  assert.equal(db.readProfile().plannerInbox.length, 1);
});

test("legacy callers without operationId keep the previous non-idempotent behavior", async () => {
  const db = fakeDb({ plannerInbox: [] });
  const body = { action: "create", item: { title: "旧客户端事项" } };
  const first = await handlePlannerLedgerRequest({ db, uid: "u1", body, now: new Date("2026-08-14T01:00:00.000Z") });
  const second = await handlePlannerLedgerRequest({ db, uid: "u1", body, now: new Date("2026-08-14T01:01:00.000Z") });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.id, second.id);
  assert.equal(db.readProfile().plannerInbox.length, 2);
});
