import assert from "node:assert/strict";
import test from "node:test";
import { handlePlannerProposalRequest, default as handler, config } from "./planner-proposal.js";
import { makeAdminFirestoreFake } from "../src/server/__test_mocks__/adminFirestoreFake.js";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";

const uid = "test-uid";
const now = new Date("2026-08-06T02:00:00.000Z");
const draft = { targetDate: "2026-08-06", todayCustomBlocks: [], todaySegmentOverrides: {} };
const baseRevision = computePlannerContextBaseRevision({ draft });

function body(overrides = {}) {
  return {
    id: "prop-1",
    targetDate: "2026-08-06",
    baseRevision,
    changes: [{ type: "move", blockId: "custom-1-1", start: "14:00" }],
    summary: "把数学挪到14点",
    ...overrides,
  };
}

test("module loads: exports the handler default, config, and the testable core function", () => {
  assert.equal(typeof handler, "function");
  assert.deepEqual(config, { api: { bodyParser: false } });
  assert.equal(typeof handlePlannerProposalRequest, "function");
});

test("creating a proposal writes ONLY to plannerProposals — the scheduleAssistantDraft (discussion state) is never touched", async () => {
  const { db, store } = makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: draft } });
  const result = await handlePlannerProposalRequest({ db, uid, body: body(), now });
  assert.equal(result.status, "created");
  assert.equal(result.proposal.status, "open");
  assert.deepEqual(store.get(`users/${uid}`), { scheduleAssistantDraft: draft }, "draft doc must be byte-identical to before — proposal creation never writes it");
  assert.ok(store.get(`users/${uid}/plannerProposals/prop-1`));
});

test("sending the SAME proposal id again revises it in place (same id, updated content) instead of creating a duplicate", async () => {
  const { db, store } = makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: draft } });
  await handlePlannerProposalRequest({ db, uid, body: body(), now });
  const revised = await handlePlannerProposalRequest({ db, uid, body: body({ summary: "改成15点", changes: [{ type: "move", blockId: "custom-1-1", start: "15:00" }] }), now: new Date(now.getTime() + 60_000) });
  assert.equal(revised.status, "revised");
  assert.equal(revised.proposal.summary, "改成15点");
  const stored = store.get(`users/${uid}/plannerProposals/prop-1`);
  assert.equal(stored.summary, "改成15点");
  assert.equal(stored.createdAt, now.toISOString(), "createdAt unchanged across a revision");
});

test("creating a NEW proposal id for the same targetDate supersedes the prior open proposal — it never sits alongside as a second executable option", async () => {
  const { db, store } = makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: draft } });
  await handlePlannerProposalRequest({ db, uid, body: body({ id: "prop-1" }), now });
  const second = await handlePlannerProposalRequest({ db, uid, body: body({ id: "prop-2", summary: "换个方案" }), now: new Date(now.getTime() + 60_000) });
  assert.equal(second.status, "created");
  assert.deepEqual(second.supersededIds, ["prop-1"]);
  assert.equal(store.get(`users/${uid}/plannerProposals/prop-1`).status, "superseded");
  assert.equal(store.get(`users/${uid}/plannerProposals/prop-1`).supersededBy, "prop-2");
  assert.equal(store.get(`users/${uid}/plannerProposals/prop-2`).status, "open");
});

test("a proposal for a DIFFERENT targetDate is never superseded", async () => {
  const { db, store } = makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: draft } });
  await handlePlannerProposalRequest({ db, uid, body: body({ id: "prop-tomorrow", targetDate: "2026-08-07", baseRevision: computePlannerContextBaseRevision({ draft: { targetDate: "2026-08-07" } }) }), now });
  await handlePlannerProposalRequest({ db, uid, body: body({ id: "prop-today" }), now: new Date(now.getTime() + 1000) });
  assert.equal(store.get(`users/${uid}/plannerProposals/prop-tomorrow`).status, "open");
});

test("revising a proposal that is no longer open (e.g. already applied) is rejected, not silently overwritten", async () => {
  const { db, store } = makeAdminFirestoreFake({
    [`users/${uid}`]: { scheduleAssistantDraft: draft },
    [`users/${uid}/plannerProposals/prop-1`]: { id: "prop-1", targetDate: "2026-08-06", status: "applied", createdAt: now.toISOString(), changes: [] },
  });
  const result = await handlePlannerProposalRequest({ db, uid, body: body(), now });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "not_open");
});

test("cancel: an open proposal becomes cancelled, draft untouched, ONLY plannerProposals written", async () => {
  const { db, store } = makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: draft } });
  await handlePlannerProposalRequest({ db, uid, body: body(), now });
  const cancelled = await handlePlannerProposalRequest({ db, uid, body: { id: "prop-1", targetDate: "2026-08-06", action: "cancel" }, now });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.proposal.status, "cancelled");
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, draft);
});

test("cancel: a non-open proposal (already applied) cannot be cancelled", async () => {
  const { db } = makeAdminFirestoreFake({
    [`users/${uid}`]: { scheduleAssistantDraft: draft },
    [`users/${uid}/plannerProposals/prop-1`]: { id: "prop-1", targetDate: "2026-08-06", status: "applied", createdAt: now.toISOString(), changes: [] },
  });
  const result = await handlePlannerProposalRequest({ db, uid, body: { id: "prop-1", targetDate: "2026-08-06", action: "cancel" }, now });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "not_open");
});

test("cancel: a nonexistent proposal id is rejected as not_found", async () => {
  const { db } = makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: draft } });
  const result = await handlePlannerProposalRequest({ db, uid, body: { id: "does-not-exist", targetDate: "2026-08-06", action: "cancel" }, now });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "not_found");
});

test("HTTP-level: wrong method is rejected with 405 before any Firestore/auth work", async () => {
  let statusCode = null;
  let payload = null;
  const res = { status(code) { statusCode = code; return this; }, json(body_) { payload = body_; } };
  await handler({ method: "GET" }, res);
  assert.equal(statusCode, 405);
  assert.ok(payload.error);
});
