// End-to-end scenario test for the Planner Bridge: a full WeChat-style
// conversation, exercised entirely through the REAL api/planner-proposal.js
// and api/planner-apply.js transaction logic (handlePlannerProposalRequest/
// handlePlannerApplyRequest) against the in-memory admin Firestore fake —
// not a re-derivation of the unit tests in plannerPatchApply.test.js /
// plannerProposal.test.js, but proof the pieces wire together correctly.
//
// Scenario (verbatim from the product spec this phase implements):
//   今日日程：数学网课(3×50) / 数学习题(2×50) / 英语(单词+专项) / 晚饭(18:00-18:40, fixed) /
//   pool 里还有一个"论文推进"任务。
//   用户对 Snow-dust 说："数学做慢了，把后面重新排一下，英语两节都保留。"
import assert from "node:assert/strict";
import test from "node:test";
import { handlePlannerProposalRequest } from "./planner-proposal.js";
import { handlePlannerApplyRequest } from "./planner-apply.js";
import { makeAdminFirestoreFake } from "../src/server/__test_mocks__/adminFirestoreFake.js";
import { buildPlannerContext, computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { buildAgentDaySnapshot } from "../src/agent/buildAgentDaySnapshot.js";
import { buildReminderPlan } from "../src/agent/buildReminderPlan.js";
import { PLANNER_PATCH_SCHEMA_VERSION } from "../src/agent/plannerPatch.js";

const uid = "test-uid";
// 10:00 Asia/Shanghai — math-lecture-1 (09:00-09:50) has already started;
// math-lecture-2 (11:00-) has not.
const now = new Date("2026-08-06T02:00:00.000Z");

function initialDraft() {
  return {
    targetDate: "2026-08-06",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    lunchStartTime: "12:30",
    lunchBlockMinutes: 40, // fixed lunch card: 12:30-13:10
    dinnerMinutes: 40, // fixed dinner card: 18:00-18:40
    mathTemplateId: "standard-math-day", // lectureBlocks50:3, exerciseBlocks50:2, reviewBlocks30:1
    todayCustomBlocks: [
      { id: "pool-task", title: "论文推进", categoryId: "study.thesis", segments: [40], breakMinutes: 5, priority: 1, manualOrder: 1 }, // stays in the pool: no manualStart
    ],
    todaySegmentOverrides: {
      "math-lecture-1": { placement: "timeline", manualStart: 540, locked: false, status: "pending" }, // 09:00-09:50, ALREADY STARTED
      "math-lecture-2": { placement: "timeline", manualStart: 660, locked: false, status: "pending" }, // 11:00-12:00, not started
      "english-1": { placement: "timeline", manualStart: 900, locked: false, status: "pending" }, // 15:00-15:35 (word)
      "english-2": { placement: "timeline", manualStart: 960, locked: false, status: "pending" }, // 16:00-16:55 (skill)
    },
  };
}

function seedStore(draft) {
  return makeAdminFirestoreFake({ [`users/${uid}`]: { scheduleAssistantDraft: draft } });
}

function proposalBody(id, changes, baseRevision, summary) {
  return { id, targetDate: "2026-08-06", baseRevision, changes, summary };
}

test("full conversation: discuss (never writes draft) -> conflict -> revise -> confirm -> apply preserves history -> idempotent -> supersedes stale", async () => {
  const draft = initialDraft();
  const { db, store } = seedStore(draft);

  // ---- Snow-dust reads PlannerContext (client already pushed this; here we
  // just build it the same way to get a real baseRevision to propose against) ----
  const originalRevision = computePlannerContextBaseRevision({ draft });
  const originalContext = buildPlannerContext({ date: draft.targetDate, now, draft, plan: {} });
  assert.equal(originalContext.baseRevision, originalRevision);

  // ---- 1. DISCUSSION: Snow-dust proposes moving the two not-yet-started
  // math segments later and pulling the pool task in, keeping BOTH english
  // segments untouched, entirely via api/planner-proposal.js ----
  const proposalId = "prop-math-slip-1";
  const draftProposal = await handlePlannerProposalRequest({
    db, uid, now,
    body: proposalBody(proposalId, [
      { type: "move", blockId: "math-lecture-2", start: "13:30", reason: "数学做慢了，往后挪" },
      { type: "schedule_from_pool", blockId: "pool-task-1", start: "17:00" },
      { type: "move", blockId: "math-lecture-1", start: "18:10" }, // deliberately conflicts with dinner — see step 2
    ], originalRevision, "数学网课挪到13:30，论文安排到17:00，已开始那节挪到18:10"),
  });
  assert.equal(draftProposal.status, "created");

  // Requirement: discussion never writes scheduleAssistantDraft — byte-identical.
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, draft);
  // english-1/english-2 were never mentioned in `changes` — "英语两节都保留" is
  // satisfied structurally (nothing in the proposal can touch them).
  assert.ok(!draftProposal.proposal.changes.some((c) => c.blockId?.startsWith("english-")));

  // ---- 2. User (or Snow-dust noticing the conflict itself) tries to
  // confirm — the 18:10 slot overlaps dinner (18:00-18:40). Apply must be
  // REJECTED wholesale with structured conflict info; draft untouched; the
  // proposal stays open so the SAME conversation can revise it. ----
  const conflictAttempt = await handlePlannerApplyRequest({ db, uid, now, body: { proposalId } });
  assert.equal(conflictAttempt.outcome, "conflict");
  assert.equal(conflictAttempt.conflicts[0].type, "fixed_block_overlap");
  assert.equal(conflictAttempt.conflicts[0].withId, "dinner");
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, draft, "a rejected apply must never touch the draft");
  assert.equal(store.get(`users/${uid}/plannerProposals/${proposalId}`).status, "open", "rejection must not close out the proposal — the conversation continues");

  // ---- 3. Snow-dust tells the user "这个方案和 18:00–18:40 晚饭冲突，我重新给你
  // 排一下" and revises the SAME proposal (same id) with a corrected time ----
  const revised = await handlePlannerProposalRequest({
    db, uid, now: new Date(now.getTime() + 60_000),
    body: proposalBody(proposalId, [
      { type: "move", blockId: "math-lecture-2", start: "13:30", reason: "数学做慢了，往后挪" },
      { type: "schedule_from_pool", blockId: "pool-task-1", start: "17:00" },
      { type: "move", blockId: "math-lecture-1", start: "20:00", reason: "已经在做的这节，晚饭后补上" },
    ], originalRevision, "改到20:00，避开晚饭"),
  });
  assert.equal(revised.status, "revised");
  assert.equal(revised.proposal.id, proposalId, "a revision keeps the SAME proposal id — not a new proposal");
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, draft, "still discussion-only — draft still untouched after a revision");

  // ---- 4. User says "就这样，发上去" — apply now succeeds ----
  const applied = await handlePlannerApplyRequest({ db, uid, now, body: { proposalId } });
  assert.equal(applied.outcome, "applied");
  // 3 positions (2 in-place + 1 split-origin) + 1 brand-new linked block id from the split.
  assert.equal(applied.changedBlockIds.length, 4);

  const nextDraft = store.get(`users/${uid}`).scheduleAssistantDraft;

  // math-lecture-2 (was NOT started): plain in-place edit, no history split.
  assert.equal(nextDraft.todaySegmentOverrides["math-lecture-2"].manualStart, 13 * 60 + 30);
  assert.equal(nextDraft.todaySegmentOverrides["math-lecture-2"].status, "pending");

  // pool-task: scheduled onto the timeline from the pool.
  assert.equal(nextDraft.todaySegmentOverrides["pool-task-1"].placement, "timeline");
  assert.equal(nextDraft.todaySegmentOverrides["pool-task-1"].manualStart, 17 * 60);

  // math-lecture-1 (WAS ALREADY STARTED, 09:00-09:50): original preserved as
  // history (status "rescheduled", ORIGINAL manualStart untouched), a NEW
  // live block created for 20:00, linked via originBlockId — requirement 6.
  assert.equal(nextDraft.todaySegmentOverrides["math-lecture-1"].status, "rescheduled");
  assert.equal(nextDraft.todaySegmentOverrides["math-lecture-1"].manualStart, 540, "the ORIGINAL 09:00 start must never be silently rewritten to the new time");
  const newLiveBlock = nextDraft.todayCustomBlocks.find((block) => block.originBlockId === "math-lecture-1");
  assert.ok(newLiveBlock, "a new linked live block must exist for the rescheduled already-started segment");
  assert.equal(newLiveBlock.manualStart, 20 * 60);
  assert.equal(nextDraft.planRevisions.length, 1);

  // english-1/english-2 genuinely untouched — identical to their pre-apply overrides, byte for byte.
  assert.deepEqual(nextDraft.todaySegmentOverrides["english-1"], draft.todaySegmentOverrides["english-1"]);
  assert.deepEqual(nextDraft.todaySegmentOverrides["english-2"], draft.todaySegmentOverrides["english-2"]);

  // ---- 7a. draft revision (baseRevision) genuinely changed after apply —
  // this is exactly the signal that would make ScheduleAssistant's
  // currentPlannerContext memo recompute and auto-push a fresh
  // PlannerContext (see App.jsx's onPlannerContextChange effect). ----
  const nextRevision = computePlannerContextBaseRevision({ draft: nextDraft });
  assert.notEqual(nextRevision, originalRevision);
  assert.equal(applied.appliedRevision, nextRevision);
  const savedProposal = store.get(`users/${uid}/plannerProposals/${proposalId}`);
  assert.equal(savedProposal.status, "applied");
  assert.equal(savedProposal.appliedResult.appliedRevision, nextRevision);

  // 7b. A fresh PlannerContext built off the NEW draft reflects the new
  // revision — this is the payload the auto-sync effect would push next.
  const nextContext = buildPlannerContext({ date: nextDraft.targetDate, now, draft: nextDraft, plan: {} });
  assert.equal(nextContext.baseRevision, nextRevision);
  assert.notEqual(nextContext.baseRevision, originalContext.baseRevision);

  // ---- 7c. Downstream consumers (AgentDaySnapshot / ReminderPlan) still
  // work off a timeline reflecting the new draft state — no breakage from
  // the apply, using the SAME public block shape those already produce. ----
  const postApplyTimeline = [
    { id: "math-lecture-2-1", title: "数学｜网课", start: 13 * 60 + 30, end: 13 * 60 + 30 + 60, kind: "task", categoryId: "study.math", status: "pending" },
    { id: newLiveBlock.id, title: newLiveBlock.title, start: 20 * 60, end: 20 * 60 + 60, kind: "task", categoryId: "study.math", status: "pending" },
    { id: "pool-task-1", title: "论文推进", start: 17 * 60, end: 17 * 60 + 45, kind: "task", categoryId: "study.thesis", status: "pending" },
    { id: "dinner", title: "晚餐", start: 18 * 60, end: 18 * 60 + 40, kind: "task", categoryId: "life.dinner", fixed: true, locked: true },
  ];
  const snapshot = buildAgentDaySnapshot({ date: nextDraft.targetDate, timeline: postApplyTimeline, now, metadata: { sourceMode: "demo" } });
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.timeline.length, 4);
  const reminderPlan = buildReminderPlan({ localDate: nextDraft.targetDate, revision: 1, cards: snapshot.timeline });
  assert.equal(reminderPlan.schemaVersion, 1);
  assert.ok(Array.isArray(reminderPlan.cards));

  // ---- 9. DUPLICATE APPLY is idempotent — "发上去" sent twice never
  // double-moves anything. ----
  const secondApply = await handlePlannerApplyRequest({ db, uid, now: new Date(now.getTime() + 120_000), body: { proposalId } });
  assert.equal(secondApply.outcome, "noop");
  assert.deepEqual(secondApply.changedBlockIds, applied.changedBlockIds);
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, nextDraft, "the draft must not change AT ALL on the idempotent replay");

  // ---- 8. An OLD proposal (built against the ORIGINAL, now-superseded-by-
  // reality baseRevision) can never overwrite the plan the successful apply
  // already produced. ----
  const staleProposalId = "prop-stale-2";
  await handlePlannerProposalRequest({
    db, uid, now,
    body: proposalBody(staleProposalId, [{ type: "move", blockId: "english-1", start: "17:00" }], originalRevision, "旧方案：挪英语"),
  });
  const staleApply = await handlePlannerApplyRequest({ db, uid, now, body: { proposalId: staleProposalId } });
  assert.equal(staleApply.outcome, "stale");
  assert.equal(staleApply.currentRevision, nextRevision);
  assert.deepEqual(store.get(`users/${uid}`).scheduleAssistantDraft, nextDraft, "a stale apply attempt must never overwrite the already-applied plan");
});
