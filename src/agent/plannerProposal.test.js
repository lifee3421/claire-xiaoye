import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelPlannerProposal,
  canApplyProposal,
  createPlannerProposal,
  markProposalApplied,
  revisePlannerProposal,
  supersedeOpenProposalsForDate,
} from "./plannerProposal.js";

const now = new Date("2026-08-06T02:00:00.000Z");

function proposal(overrides = {}) {
  return createPlannerProposal({
    id: "prop-1",
    targetDate: "2026-08-06",
    baseRevision: "v1:abc",
    changes: [{ type: "move", blockId: "custom-1-1", start: "14:00" }],
    summary: "把数学挪到14点",
    now,
    ...overrides,
  });
}

test("createPlannerProposal starts in 'open' status with no applied/superseded state", () => {
  const p = proposal();
  assert.equal(p.status, "open");
  assert.equal(p.appliedAt, null);
  assert.equal(p.supersededAt, null);
  assert.equal(p.createdAt, now.toISOString());
});

test("canApplyProposal: open -> ok, applied/superseded/cancelled/missing -> rejected with a specific reason", () => {
  assert.deepEqual(canApplyProposal(proposal()), { ok: true });
  assert.equal(canApplyProposal(null).reason, "not_found");
  assert.equal(canApplyProposal({ ...proposal(), status: "applied" }).reason, "already_applied");
  assert.equal(canApplyProposal({ ...proposal(), status: "superseded" }).reason, "superseded");
  assert.equal(canApplyProposal({ ...proposal(), status: "cancelled" }).reason, "cancelled");
});

test("revisePlannerProposal updates changes/summary/baseRevision in place while open, bumps updatedAt", () => {
  const p = proposal();
  const later = new Date(now.getTime() + 60_000);
  const result = revisePlannerProposal(p, { baseRevision: "v1:def", changes: [{ type: "move", blockId: "custom-1-1", start: "15:00" }], summary: "改成15点" }, { now: later });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.id, p.id, "same proposal id — a revision, not a new proposal");
  assert.equal(result.proposal.baseRevision, "v1:def");
  assert.equal(result.proposal.summary, "改成15点");
  assert.equal(result.proposal.updatedAt, later.toISOString());
  assert.equal(result.proposal.createdAt, p.createdAt, "createdAt never changes on revision");
});

test("revisePlannerProposal refuses to revise a non-open proposal", () => {
  const applied = { ...proposal(), status: "applied" };
  assert.equal(revisePlannerProposal(applied, { summary: "x" }).ok, false);
});

test("supersedeOpenProposalsForDate marks every OTHER open proposal for the same date as superseded, leaves other dates and non-open proposals untouched", () => {
  const sameDayOpen = proposal({ id: "prop-old" });
  const sameDayApplied = { ...proposal({ id: "prop-applied" }), status: "applied" };
  const otherDayOpen = proposal({ id: "prop-other-day", targetDate: "2026-08-07" });
  const patches = supersedeOpenProposalsForDate([sameDayOpen, sameDayApplied, otherDayOpen], "2026-08-06", { excludeId: "prop-new", newProposalId: "prop-new", now });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "prop-old");
  assert.equal(patches[0].patch.status, "superseded");
  assert.equal(patches[0].patch.supersededBy, "prop-new");
});

test("a superseded proposal can never be applied, even if it's the one the user is currently pointing at", () => {
  const patches = supersedeOpenProposalsForDate([proposal()], "2026-08-06", { newProposalId: "prop-2", now });
  const superseded = { ...proposal(), ...patches[0].patch };
  assert.equal(canApplyProposal(superseded).ok, false);
  assert.equal(canApplyProposal(superseded).reason, "superseded");
});

test("markProposalApplied records appliedResult for idempotent re-reads and flips status to applied", () => {
  const p = proposal();
  const applied = markProposalApplied(p, { changedBlockIds: ["custom-1-1"], summary: "移动 1 项", appliedRevision: "v1:xyz" }, { now });
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.appliedResult, { changedBlockIds: ["custom-1-1"], summary: "移动 1 项", appliedRevision: "v1:xyz" });
  assert.equal(applied.appliedAt, now.toISOString());
});

test("cancelPlannerProposal only works on an open proposal", () => {
  const p = proposal();
  const cancelled = cancelPlannerProposal(p, { now });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.proposal.status, "cancelled");
  assert.equal(cancelPlannerProposal(cancelled.proposal, { now }).ok, false);
});
