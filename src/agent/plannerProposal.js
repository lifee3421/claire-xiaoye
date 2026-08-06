// PlannerProposal: the persisted, discussion-scoped record of "what Snow-dust
// and the user talked through for this date, before anything was applied."
//
// A proposal NEVER writes to scheduleAssistantDraft — creating/revising one
// only ever touches its own Firestore doc (users/{uid}/plannerProposals/{id}).
// That is what makes the discussion state safe by construction: there is no
// code path from "create/update a proposal" to a plan mutation. Only a
// separate, explicit apply step (src/schedule/plannerPatchApply.js, called
// from api/planner-apply.js) ever mutates the draft, and only for a proposal
// in "open" status with a still-matching baseRevision.
//
// Status machine:
//   open        - created, may still be revised. The only status an apply
//                 attempt may act on.
//   applied     - apply succeeded once. A repeat apply call for the SAME
//                 proposal id is idempotent: it returns the ORIGINAL result
//                 (appliedResult below) without touching the draft again.
//   superseded  - a NEWER proposal was created for the same targetDate before
//                 this one was applied. Can never be applied (the user is
//                 mid-revision; re-discussing something means the old
//                 version is dead, not queued).
//   cancelled   - explicitly withdrawn (user said "不用了"/"算了"), never
//                 applicable.
// There is no persisted "stale" status — staleness is a runtime property
// (does baseRevision still match the CURRENT draft right now?), checked at
// apply time by plannerPatchApply.applyPlannerPatch, not something baked
// into the proposal record itself. A stale apply attempt leaves the
// proposal's status untouched (still "open") so the SAME conversation can
// simply ask Snow-dust to re-fetch PlannerContext and create a fresh
// proposal — which naturally supersedes this one.

export const PLANNER_PROPOSAL_SCHEMA_VERSION = 1;
export const PLANNER_PROPOSAL_STATUSES = ["open", "applied", "superseded", "cancelled"];

function isoNow(now = new Date()) {
  return (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()).toISOString();
}

/**
 * @param {object} params
 * @param {string} params.id - caller-supplied stable id (e.g. a UUID Snow-dust generates)
 * @param {string} params.targetDate
 * @param {string} params.baseRevision - the PlannerContext.baseRevision this proposal was built from
 * @param {import("./plannerPatch.js").PlannerPatchChange[]} params.changes
 * @param {string} params.summary - human-readable one-liner, shown back to the user, never a full dump
 * @param {string} [params.createdBy] - free-text provenance (e.g. "snowdust"), not an auth mechanism
 */
export function createPlannerProposal({ id, targetDate, baseRevision, changes, summary, createdBy = "snowdust", now = new Date() } = {}) {
  const createdAt = isoNow(now);
  return {
    schemaVersion: PLANNER_PROPOSAL_SCHEMA_VERSION,
    id,
    targetDate,
    baseRevision,
    changes: Array.isArray(changes) ? changes : [],
    summary: summary || "",
    createdBy,
    status: "open",
    createdAt,
    updatedAt: createdAt,
    supersededAt: null,
    supersededBy: null,
    appliedAt: null,
    appliedResult: null,
  };
}

/**
 * Revises an OPEN proposal's changes/summary/baseRevision in place (same id,
 * new content) — used when the discussion continues on the SAME proposal
 * rather than starting a new one. Only valid while status is "open"; once
 * applied/superseded/cancelled, a revision must go through
 * createPlannerProposal (a new id) instead, which will supersede this one
 * via supersedeOpenProposalsForDate.
 */
export function revisePlannerProposal(proposal, { baseRevision, changes, summary }, { now = new Date() } = {}) {
  if (!proposal || proposal.status !== "open") return { ok: false, reason: "not_open" };
  return {
    ok: true,
    proposal: {
      ...proposal,
      baseRevision: baseRevision ?? proposal.baseRevision,
      changes: Array.isArray(changes) ? changes : proposal.changes,
      summary: summary ?? proposal.summary,
      updatedAt: isoNow(now),
    },
  };
}

/**
 * Given every existing proposal for a user, returns the patches to apply so
 * every OTHER open proposal for `targetDate` becomes "superseded" — call
 * this in the same write as creating a new proposal for that date, so two
 * "open" proposals for the same date can never coexist (requirement: revising
 * mid-discussion supersedes the old version, it doesn't sit alongside it as
 * a second executable option).
 */
export function supersedeOpenProposalsForDate(existingProposals, targetDate, { excludeId = null, newProposalId, now = new Date() } = {}) {
  const supersededAt = isoNow(now);
  return (Array.isArray(existingProposals) ? existingProposals : [])
    .filter((proposal) => proposal.status === "open" && proposal.targetDate === targetDate && proposal.id !== excludeId)
    .map((proposal) => ({ id: proposal.id, patch: { status: "superseded", supersededAt, supersededBy: newProposalId || null, updatedAt: supersededAt } }));
}

/** Whether `proposal` may currently be handed to plannerPatchApply.applyPlannerPatch. */
export function canApplyProposal(proposal) {
  if (!proposal) return { ok: false, reason: "not_found" };
  if (proposal.status === "applied") return { ok: false, reason: "already_applied" };
  if (proposal.status !== "open") return { ok: false, reason: proposal.status };
  return { ok: true };
}

/** Marks a proposal applied, recording the result so a repeat apply call for
 * the same id can return it idempotently instead of re-running the mutation. */
export function markProposalApplied(proposal, { changedBlockIds, summary, appliedRevision }, { now = new Date() } = {}) {
  const appliedAt = isoNow(now);
  return {
    ...proposal,
    status: "applied",
    appliedAt,
    updatedAt: appliedAt,
    appliedResult: { changedBlockIds: changedBlockIds || [], summary: summary || "", appliedRevision: appliedRevision || null },
  };
}

export function cancelPlannerProposal(proposal, { now = new Date() } = {}) {
  if (!proposal || proposal.status !== "open") return { ok: false, reason: "not_open" };
  const updatedAt = isoNow(now);
  return { ok: true, proposal: { ...proposal, status: "cancelled", updatedAt } };
}
