import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  NEW_WORLD_PLANNER_BRIDGE_PATHS,
  dispatchNewWorldPlannerBridge,
  verifyNewWorldPlannerBridge,
} from "./newWorldPlannerBridgeEndpoint.js";
import { setCanonicalPlannerWritePatch } from "./canonicalPlannerCommit.js";
import { buildPlannerDateWritePatch } from "../schedule/plannerDatePersistence.js";

function sign(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function makeMergeFieldsPersistence(initialProfile) {
  let persisted = structuredClone(initialProfile);
  const transaction = {
    set(_ref, data, options = {}) {
      assert.ok(Array.isArray(options.mergeFields), "Planner persistence must use mergeFields");
      const next = structuredClone(persisted);
      for (const field of options.mergeFields) {
        assert.ok(Object.prototype.hasOwnProperty.call(data, field), `missing merge field ${field}`);
        next[field] = structuredClone(data[field]);
      }
      persisted = next;
    },
  };
  return {
    transaction,
    userRef: { path: "users/pinned" },
    read: () => structuredClone(persisted),
  };
}

test("New World Planner bridge uses the existing Catkeeper HMAC wire contract", () => {
  const secret = "bridge-secret";
  const timestamp = "100000";
  const rawBody = JSON.stringify({ path: "/api/planner-ui-context", body: { date: "2026-08-19" } });
  const signature = sign(secret, timestamp, rawBody);
  assert.deepEqual(verifyNewWorldPlannerBridge({
    headers: { "x-catkeeper-timestamp": timestamp, "x-catkeeper-signature": signature },
    rawBody,
    secret,
    now: 100000,
  }), { ok: true });
  assert.equal(verifyNewWorldPlannerBridge({
    headers: { "x-catkeeper-timestamp": timestamp, "x-catkeeper-signature": "0".repeat(64) },
    rawBody,
    secret,
    now: 100000,
  }).code, "invalid_signature");
});

test("bridge surface is an explicit allowlist and rejects arbitrary legacy paths before Firestore", async () => {
  assert.deepEqual([...NEW_WORLD_PLANNER_BRIDGE_PATHS], [
    "/api/planner-ui-context",
    "/api/planner-standalone-mutate",
    "/api/planner-standalone-meta",
    "/api/planner-draft-sidecar",
    "/api/planner-ui-proposal",
    "/api/planner-ui-proposal-apply",
  ]);
  const result = await dispatchNewWorldPlannerBridge({ db: null, uid: "pinned", path: "/api/not-a-planner-route", body: { uid: "attacker" } });
  assert.equal(result.status, 404);
});

test("bridge target uid is server-pinned and request body cannot choose it", async () => {
  const source = await readFile(new URL("./newWorldPlannerBridgeEndpoint.js", import.meta.url), "utf8");
  assert.match(source, /CATKEEPER_USER_UID/);
  assert.doesNotMatch(source, /envelope\?\.uid|body\.uid|body\?\.uid/);
});

test("HMAC bridge reuses consolidated planner function budget rather than adding a thirteenth api function", async () => {
  const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  const rewrite = vercel.rewrites.find((item) => item.source === "/api/newworld-planner-bridge");
  assert.equal(rewrite.destination, "/api/planner?__plannerRoute=newworld-bridge");
  const planner = await readFile(new URL("../../api/planner.js", import.meta.url), "utf8");
  assert.match(planner, /\["newworld-bridge", newWorldPlannerBridgeHandler\]/);
  assert.match(planner, /route === "direct-edit" \|\| route === "newworld-bridge"/);
});

test("canonical Planner live draft replacement persists cleared nested overrides exactly", () => {
  const blockId = "math-lecture-2";
  const profile = {
    timezone: "Asia/Shanghai",
    unrelatedSentinel: { keep: true },
    scheduleAssistantDraft: {
      targetDate: "2026-08-19",
      savedOn: "2026-08-19",
      todaySegmentOverrides: {
        [blockId]: {
          manualStart: 855,
          placement: "timeline",
          locked: false,
          status: "pending",
          restMinutes: 20,
          title: "SMOKE",
        },
      },
      taskPoolOrder: ["keep-me"],
    },
    scheduleAssistantDraftArchive: [
      { targetDate: "2026-08-18", savedOn: "2026-08-18", todaySegmentOverrides: { older: { title: "OLDER" } } },
    ],
    plannerBridgeOperationReceipts: [{ operationId: "old-receipt" }],
  };

  const nextDraft = structuredClone(profile.scheduleAssistantDraft);
  delete nextDraft.todaySegmentOverrides[blockId].title;
  const writePatch = buildPlannerDateWritePatch(profile, "2026-08-19", nextDraft);
  writePatch.plannerBridgeOperationReceipts = [
    ...profile.plannerBridgeOperationReceipts,
    { operationId: "new-receipt" },
  ];

  const persistence = makeMergeFieldsPersistence(profile);
  setCanonicalPlannerWritePatch(persistence.transaction, persistence.userRef, writePatch);
  const saved = persistence.read();

  assert.deepEqual(saved.scheduleAssistantDraft, nextDraft);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.scheduleAssistantDraft.todaySegmentOverrides[blockId], "title"), false);
  assert.equal(saved.scheduleAssistantDraft.todaySegmentOverrides[blockId].restMinutes, 20);
  assert.deepEqual(saved.scheduleAssistantDraftArchive, profile.scheduleAssistantDraftArchive);
  assert.deepEqual(saved.plannerBridgeOperationReceipts, writePatch.plannerBridgeOperationReceipts);
  assert.equal(saved.timezone, "Asia/Shanghai");
  assert.deepEqual(saved.unrelatedSentinel, { keep: true });
});

test("canonical Planner archive replacement preserves live draft and other dated drafts", () => {
  const blockId = "math-lecture-2";
  const archivedTarget = {
    targetDate: "2026-08-19",
    savedOn: "2026-08-19",
    todaySegmentOverrides: {
      [blockId]: {
        manualStart: 855,
        placement: "timeline",
        locked: false,
        status: "pending",
        title: "SMOKE",
      },
    },
  };
  const otherArchive = {
    targetDate: "2026-08-18",
    savedOn: "2026-08-18",
    todaySegmentOverrides: { older: { title: "OLDER" } },
  };
  const profile = {
    timezone: "Asia/Shanghai",
    unrelatedSentinel: "keep",
    scheduleAssistantDraft: {
      targetDate: "2026-08-20",
      savedOn: "2026-08-20",
      todaySegmentOverrides: { today: { status: "pending" } },
    },
    scheduleAssistantDraftArchive: [otherArchive, archivedTarget],
  };

  const nextArchivedDraft = structuredClone(archivedTarget);
  delete nextArchivedDraft.todaySegmentOverrides[blockId].title;
  const writePatch = buildPlannerDateWritePatch(profile, "2026-08-19", nextArchivedDraft);

  const persistence = makeMergeFieldsPersistence(profile);
  setCanonicalPlannerWritePatch(persistence.transaction, persistence.userRef, writePatch);
  const saved = persistence.read();
  const savedTarget = saved.scheduleAssistantDraftArchive.find((item) => item.targetDate === "2026-08-19");
  const savedOther = saved.scheduleAssistantDraftArchive.find((item) => item.targetDate === "2026-08-18");

  assert.deepEqual(saved.scheduleAssistantDraft, profile.scheduleAssistantDraft);
  assert.deepEqual(savedTarget, nextArchivedDraft);
  assert.equal(Object.prototype.hasOwnProperty.call(savedTarget.todaySegmentOverrides[blockId], "title"), false);
  assert.deepEqual(savedOther, otherArchive);
  assert.equal(saved.unrelatedSentinel, "keep");
});
