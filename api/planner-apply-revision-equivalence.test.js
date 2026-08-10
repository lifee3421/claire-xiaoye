import assert from "node:assert/strict";
import test from "node:test";
import {
  handlePlannerApplyRequest,
  plannerRevisionFingerprint,
  plannerRevisionsHaveSameContent,
} from "./planner-apply.js";
import { makeAdminFirestoreFake } from "../src/server/__test_mocks__/adminFirestoreFake.js";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { createPlannerProposal } from "../src/agent/plannerProposal.js";

const uid = "test-uid";

function draft(overrides = {}) {
  return {
    targetDate: "2026-08-08",
    updatedAt: "2026-08-08T05:12:00.000Z",
    todayCustomBlocks: [
      {
        id: "custom-math",
        title: "数学",
        categoryId: "study.math",
        segments: [50],
        breakMinutes: 0,
        priority: 2,
        manualOrder: 1,
        preferredPeriods: ["afternoon"],
        manualStart: 900,
        locked: false,
      },
    ],
    todaySegmentOverrides: {},
    deletedTodayTaskIds: [],
    fixedEventOverrides: {},
    taskPoolOrder: [],
    planRevisions: [],
    ...overrides,
  };
}

function seedStore(currentDraft, proposal) {
  const { db } = makeAdminFirestoreFake({
    [`users/${uid}`]: { scheduleAssistantDraft: currentDraft },
    [`users/${uid}/plannerProposals/${proposal.id}`]: proposal,
  });
  return db;
}

test("revision fingerprint ignores updatedAt but not planner content", () => {
  const original = draft();
  const timestampOnly = { ...original, updatedAt: "2026-08-08T05:13:00.000Z" };
  const changed = {
    ...timestampOnly,
    todaySegmentOverrides: { "custom-math-1": { manualStart: 930 } },
  };

  const a = computePlannerContextBaseRevision({ draft: original });
  const b = computePlannerContextBaseRevision({ draft: timestampOnly });
  const c = computePlannerContextBaseRevision({ draft: changed });

  assert.notEqual(a, b, "updatedAt still makes the full revision string different");
  assert.deepEqual(plannerRevisionFingerprint(a), plannerRevisionFingerprint(b));
  assert.equal(plannerRevisionsHaveSameContent(a, b), true);
  assert.equal(plannerRevisionsHaveSameContent(a, c), false);
});

test("apply safely rebases a proposal when only updatedAt changed", async () => {
  const original = draft();
  const proposal = createPlannerProposal({
    id: "prop-equivalent",
    targetDate: original.targetDate,
    baseRevision: computePlannerContextBaseRevision({ draft: original }),
    changes: [{ type: "move", blockId: "custom-math-1", start: "16:00" }],
    summary: "数学挪到16:00",
    now: new Date("2026-08-08T05:12:10.000Z"),
  });
  const currentDraft = { ...original, updatedAt: "2026-08-08T05:13:00.000Z" };
  const db = seedStore(currentDraft, proposal);

  const result = await handlePlannerApplyRequest({
    db,
    uid,
    body: { proposalId: proposal.id },
    now: new Date("2026-08-08T05:16:00.000Z"),
  });

  assert.equal(result.outcome, "applied");
  assert.equal(result.rebasedEquivalentRevision, true);
});

test("apply still rejects a genuinely changed planner revision", async () => {
  const original = draft();
  const proposal = createPlannerProposal({
    id: "prop-real-stale",
    targetDate: original.targetDate,
    baseRevision: computePlannerContextBaseRevision({ draft: original }),
    changes: [{ type: "move", blockId: "custom-math-1", start: "16:00" }],
    summary: "数学挪到16:00",
    now: new Date("2026-08-08T05:12:10.000Z"),
  });
  const currentDraft = {
    ...original,
    updatedAt: "2026-08-08T05:13:00.000Z",
    todaySegmentOverrides: { "custom-math-1": { manualStart: 930 } },
  };
  const db = seedStore(currentDraft, proposal);

  const result = await handlePlannerApplyRequest({
    db,
    uid,
    body: { proposalId: proposal.id },
    now: new Date("2026-08-08T05:16:00.000Z"),
  });

  assert.equal(result.outcome, "stale");
  assert.equal(result.currentRevision, computePlannerContextBaseRevision({ draft: currentDraft }));
});
