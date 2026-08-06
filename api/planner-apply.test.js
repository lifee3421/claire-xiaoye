import assert from "node:assert/strict";
import test from "node:test";
import { handlePlannerApplyRequest, default as handler, config } from "./planner-apply.js";
import { makeAdminFirestoreFake } from "../src/server/__test_mocks__/adminFirestoreFake.js";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { createPlannerProposal } from "../src/agent/plannerProposal.js";

const uid = "test-uid";
const now = new Date("2026-08-06T02:00:00.000Z"); // 10:00 Asia/Shanghai

function draft(overrides = {}) {
  return {
    targetDate: "2026-08-06",
    todayCustomBlocks: [
      { id: "custom-future", title: "数学复习", categoryId: "study.math", segments: [50], breakMinutes: 10, priority: 2, manualOrder: 1, preferredPeriods: ["afternoon"], manualStart: 660, locked: false },
      { id: "custom-started", title: "英语精读", categoryId: "study.english", segments: [50], breakMinutes: 0, priority: 2, manualOrder: 2, preferredPeriods: ["morning"], manualStart: 540, locked: false },
    ],
    todaySegmentOverrides: {},
    ...overrides,
  };
}

function seedStore(draftValue, proposal) {
  return makeAdminFirestoreFake({
    [`users/${uid}`]: { scheduleAssistantDraft: draftValue },
    [`users/${uid}/plannerProposals/${proposal.id}`]: proposal,
  });
}

test("module loads: exports the handler default, config, and the testable core function", () => {
  assert.equal(typeof handler, "function");
  assert.deepEqual(config, { api: { bodyParser: false } });
  assert.equal(typeof handlePlannerApplyRequest, "function");
});

test("applying an open proposal moves the block, preserves history for an already-started block, and writes a fresh appliedRevision back to the draft", async () => {
  const d = draft();
  const proposal = createPlannerProposal({
    id: "prop-1", targetDate: d.targetDate, baseRevision: computePlannerContextBaseRevision({ draft: d }),
    changes: [
      { type: "move", blockId: "custom-future-1", start: "14:00" }, // not started -> in place
      { type: "move", blockId: "custom-started-1", start: "15:00" }, // already started -> split, history preserved
    ],
    summary: "调整两项",
    now,
  });
  const { db, store } = seedStore(d, proposal);

  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(result.outcome, "applied");
  // 2 original blockIds touched (one in-place, one split-origin) + 1 brand-new linked block id from the split.
  assert.equal(result.changedBlockIds.length, 3);

  const savedDraft = store.get(`users/${uid}`).scheduleAssistantDraft;
  assert.equal(savedDraft.todaySegmentOverrides["custom-future-1"].manualStart, 840);
  assert.equal(savedDraft.todaySegmentOverrides["custom-started-1"].status, "rescheduled", "already-started block's ORIGINAL override must record rescheduled, never a silently rewritten start time");
  assert.equal(savedDraft.todayCustomBlocks.length, 3, "a new linked block was appended for the already-started move, original block never deleted");
  assert.equal(savedDraft.planRevisions.length, 1);
  assert.ok(savedDraft.updatedAt);

  const savedProposal = store.get(`users/${uid}/plannerProposals/prop-1`);
  assert.equal(savedProposal.status, "applied");
  assert.equal(savedProposal.appliedResult.appliedRevision, result.appliedRevision);
});

test("stale baseRevision is rejected outright — the draft is never touched, the proposal stays open", async () => {
  const d = draft();
  const proposal = createPlannerProposal({ id: "prop-1", targetDate: d.targetDate, baseRevision: "v1:stale:deadbeef", changes: [{ type: "move", blockId: "custom-future-1", start: "14:00" }], now });
  const { db, store } = seedStore(d, proposal);

  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(result.outcome, "stale");
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, d, "draft must be byte-identical to before the rejected apply");
  assert.equal(store.get(`users/${uid}/plannerProposals/prop-1`).status, "open", "a stale rejection never changes the proposal's own status");
});

test("duplicate apply is idempotent: the SAME proposal applied twice returns the ORIGINAL result and moves the block only once", async () => {
  const d = draft();
  const proposal = createPlannerProposal({ id: "prop-1", targetDate: d.targetDate, baseRevision: computePlannerContextBaseRevision({ draft: d }), changes: [{ type: "move", blockId: "custom-future-1", start: "14:00" }], now });
  const { db, store } = seedStore(d, proposal);

  const first = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(first.outcome, "applied");
  const draftAfterFirst = store.get(`users/${uid}`).scheduleAssistantDraft;

  const second = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now: new Date(now.getTime() + 60_000) });
  assert.equal(second.outcome, "noop");
  assert.deepEqual(second, { outcome: "noop", changedBlockIds: first.changedBlockIds, summary: first.summary, appliedRevision: first.appliedRevision });
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, draftAfterFirst, "the draft must not change at all on the idempotent replay");
});

test("a superseded proposal can never be applied", async () => {
  const d = draft();
  const proposal = { ...createPlannerProposal({ id: "prop-1", targetDate: d.targetDate, baseRevision: computePlannerContextBaseRevision({ draft: d }), changes: [{ type: "move", blockId: "custom-future-1", start: "14:00" }], now }), status: "superseded" };
  const { db, store } = seedStore(d, proposal);

  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "superseded");
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, d);
});

test("applying to a nonexistent proposal id is rejected as not_found, never crashes", async () => {
  const d = draft();
  const { db } = makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: d } });
  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "does-not-exist" }, now });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "not_found");
});

test("a change targeting a protected system-life card is rejected whole (fail-closed), draft untouched, proposal stays open for revision", async () => {
  const d = draft();
  const proposal = createPlannerProposal({ id: "prop-1", targetDate: d.targetDate, baseRevision: computePlannerContextBaseRevision({ draft: d }), changes: [{ type: "move", blockId: "wake-prep-1", start: "14:00" }], now });
  const { db, store } = seedStore(d, proposal);

  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "unresolvable_changes");
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, d);
  assert.equal(store.get(`users/${uid}/plannerProposals/prop-1`).status, "open");
});

test("a change targeting the `reading` group applies successfully when the user has a books collection with an active 'reading'-status book", async () => {
  const d = draft();
  const proposal = createPlannerProposal({ id: "prop-1", targetDate: d.targetDate, baseRevision: computePlannerContextBaseRevision({ draft: d }), changes: [{ type: "schedule_from_pool", blockId: "reading-1", start: "20:30" }], now });
  const { db, store } = makeAdminFirestoreFake({
    [`users/${uid}`]: { scheduleAssistantDraft: d },
    [`users/${uid}/plannerProposals/prop-1`]: proposal,
    [`users/${uid}/books/book-1`]: { title: "百年孤独", status: "reading" },
  });

  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(result.outcome, "applied");
  const savedDraft = store.get(`users/${uid}`).scheduleAssistantDraft;
  assert.equal(savedDraft.todaySegmentOverrides["reading-1"].manualStart, 20 * 60 + 30);
});

test("a change targeting a REAL built-in daily task (math-lecture) now applies successfully", async () => {
  const d = draft();
  const proposal = createPlannerProposal({ id: "prop-1", targetDate: d.targetDate, baseRevision: computePlannerContextBaseRevision({ draft: d }), changes: [{ type: "move", blockId: "math-lecture-1", start: "16:00" }], now });
  const { db, store } = seedStore(d, proposal);

  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(result.outcome, "applied");
  const savedDraft = store.get(`users/${uid}`).scheduleAssistantDraft;
  assert.equal(savedDraft.todaySegmentOverrides["math-lecture-1"].manualStart, 16 * 60);
});

test("a proposed placement that overlaps a hard fixed block (dinner) is rejected with structured conflict info, draft untouched, proposal stays open", async () => {
  const d = draft({ dinnerMinutes: 40 });
  const proposal = createPlannerProposal({ id: "prop-1", targetDate: d.targetDate, baseRevision: computePlannerContextBaseRevision({ draft: d }), changes: [{ type: "move", blockId: "custom-future-1", start: "18:20" }], now });
  const { db, store } = seedStore(d, proposal);

  const result = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-1" }, now });
  assert.equal(result.outcome, "conflict");
  assert.equal(result.conflicts[0].type, "fixed_block_overlap");
  assert.equal(result.conflicts[0].withId, "dinner");
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, d);
  assert.equal(store.get(`users/${uid}/plannerProposals/prop-1`).status, "open");
});

test("PlannerContext's baseRevision genuinely changes after a successful apply — a subsequent apply attempt with the OLD baseRevision is now stale", async () => {
  const d = draft();
  const originalRevision = computePlannerContextBaseRevision({ draft: d });
  const proposalA = createPlannerProposal({ id: "prop-a", targetDate: d.targetDate, baseRevision: originalRevision, changes: [{ type: "move", blockId: "custom-future-1", start: "14:00" }], now });
  const proposalB = createPlannerProposal({ id: "prop-b", targetDate: d.targetDate, baseRevision: originalRevision, changes: [{ type: "return_to_pool", blockId: "custom-future-1" }], now });
  const { db, store } = makeAdminFirestoreFake({
    [`users/${uid}`]: { scheduleAssistantDraft: d },
    [`users/${uid}/plannerProposals/prop-a`]: proposalA,
    [`users/${uid}/plannerProposals/prop-b`]: proposalB,
  });

  const first = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-a" }, now });
  assert.equal(first.outcome, "applied");
  assert.notEqual(first.appliedRevision, originalRevision);

  const second = await handlePlannerApplyRequest({ db, uid, body: { proposalId: "prop-b" }, now });
  assert.equal(second.outcome, "stale");
  assert.equal(second.currentRevision, first.appliedRevision);
});

test("HTTP-level: wrong method is rejected with 405 before any Firestore/auth work", async () => {
  let statusCode = null;
  let payload = null;
  const res = { status(code) { statusCode = code; return this; }, json(body_) { payload = body_; } };
  await handler({ method: "GET" }, res);
  assert.equal(statusCode, 405);
  assert.ok(payload.error);
});
