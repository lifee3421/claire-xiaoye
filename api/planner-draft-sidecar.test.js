import assert from "node:assert/strict";
import test from "node:test";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { handlePlannerDraftSidecarRequest, validatePlannerDraftSidecarRequest } from "./planner-draft-sidecar.js";

function fakeDb(initialProfile = {}) {
  let profile = structuredClone(initialProfile);
  const userRef = {};
  return {
    collection(name) {
      assert.equal(name, "users");
      return { doc(uid) { assert.equal(uid, "u1"); return userRef; } };
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

function plannerDraft() {
  return {
    targetDate: "2026-08-16",
    savedOn: "2026-08-16",
    updatedAt: "2026-08-16T02:00:00.000Z",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    todayCustomBlocks: [{ id: "custom-1", title: "数学", segments: [50], manualStart: 540 }],
    todaySegmentOverrides: {},
    stickers: [],
  };
}

test("non-schedule sidecar update preserves canonical schedule revision and updatedAt", async () => {
  const initialDraft = plannerDraft();
  const db = fakeDb({ scheduleAssistantDraft: initialDraft });
  const beforeRevision = computePlannerContextBaseRevision({ draft: initialDraft });
  const result = await handlePlannerDraftSidecarRequest({
    db,
    uid: "u1",
    body: {
      date: "2026-08-16",
      sidecar: {
        stickers: [{ id: "sticker-1", title: "喝水", anchorMinute: 600 }],
        reminderPlanSyncByDate: { "2026-08-16": { acceptedRevision: "r1" } },
      },
    },
  });
  const after = db.readProfile().scheduleAssistantDraft;
  assert.equal(result.outcome, "saved");
  assert.deepEqual(after.stickers, [{ id: "sticker-1", title: "喝水", anchorMinute: 600 }]);
  assert.equal(after.updatedAt, initialDraft.updatedAt);
  assert.equal(computePlannerContextBaseRevision({ draft: after }), beforeRevision);
});

test("sidecar endpoint rejects canonical schedule fields instead of becoming a bypass", () => {
  const problems = validatePlannerDraftSidecarRequest({
    date: "2026-08-16",
    sidecar: {
      todayCustomBlocks: [],
      targetBedTime: "23:40",
    },
  });
  assert.ok(problems.some((item) => item.includes("todayCustomBlocks")));
  assert.ok(problems.some((item) => item.includes("targetBedTime")));
});
