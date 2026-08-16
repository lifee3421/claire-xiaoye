import {
  appendPlannerBridgeReceipt,
  normalizePlannerBridgeOperationId,
  plannerBridgeRequestHash,
  resolvePlannerBridgeReceipt,
} from "./plannerBridgeIdempotency.js";
import { PLANNER_PATCH_SCHEMA_VERSION } from "../agent/plannerPatch.js";
import { applyPlannerPatch } from "../schedule/plannerPatchApply.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { buildPlannerDateWritePatch, resolvePlannerDraftForDate } from "../schedule/plannerDatePersistence.js";

/** Extract the semantic content fingerprint from a PlannerContext revision. */
export function plannerRevisionFingerprint(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^v(\d+):.*:([0-9a-f]{8})$/i.exec(text);
  return match ? { schemaVersion: match[1], contentHash: match[2].toLowerCase() } : null;
}

/** Timestamp-only churn is safe to rebase; content changes are never safe. */
export function plannerRevisionsHaveSameContent(left, right) {
  if (left === right && typeof left === "string" && left) return true;
  const a = plannerRevisionFingerprint(left);
  const b = plannerRevisionFingerprint(right);
  return Boolean(a && b && a.schemaVersion === b.schemaVersion && a.contentHash === b.contentHash);
}

/**
 * Canonical daily planner commit boundary.
 *
 * Intentionally owns only write semantics:
 *   dated draft resolution -> current revision -> idempotency -> PlannerPatch
 *   kernel -> dated persistence patch -> atomic Firestore write -> revision.
 *
 * Intent parsing, direct-vs-proposal policy, confirmation UX and client auth
 * stay in their entry adapters. `loadMutation` exists solely so proposal apply
 * can read/gate its proposal inside the SAME transaction before delegating the
 * actual planner commit. `onApplied` lets that adapter mark the proposal
 * applied atomically with the canonical schedule write.
 */
export async function commitCanonicalDailyPlannerMutation({
  db,
  uid,
  date = "",
  baseRevision = "",
  changes = [],
  operationId = "",
  operationKind = "planner-daily-mutation",
  books = [],
  readingSessions = [],
  now = new Date(),
  loadMutation = null,
  onApplied = null,
} = {}) {
  if (!db) throw new Error("commitCanonicalDailyPlannerMutation requires db");
  if (!uid) throw new Error("commitCanonicalDailyPlannerMutation requires uid");

  const normalizedOperation = normalizePlannerBridgeOperationId(operationId);
  if (!normalizedOperation.ok) return { outcome: "rejected", reason: normalizedOperation.reason };
  const normalizedOperationId = normalizedOperation.operationId;
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (transaction) => {
    let mutation = { date, baseRevision, changes };
    let adapterContext = null;
    if (typeof loadMutation === "function") {
      const loaded = await loadMutation({ transaction, userRef });
      if (loaded?.terminalResult) return loaded.terminalResult;
      mutation = {
        date: loaded?.date || "",
        baseRevision: loaded?.baseRevision || "",
        changes: Array.isArray(loaded?.changes) ? loaded.changes : [],
      };
      adapterContext = loaded?.context || null;
    }

    const targetDate = String(mutation.date || "").trim();
    const expectedRevision = String(mutation.baseRevision || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return { outcome: "rejected", reason: "invalid_date" };
    if (!expectedRevision) return { outcome: "rejected", reason: "base_revision_required" };
    if (!Array.isArray(mutation.changes) || mutation.changes.length === 0) return { outcome: "rejected", reason: "changes_required" };

    const requestHash = normalizedOperationId
      ? plannerBridgeRequestHash(operationKind, {
        date: targetDate,
        changes: mutation.changes,
      })
      : "";

    const userSnap = await transaction.get(userRef);
    const profile = userSnap.exists ? userSnap.data() : {};

    if (normalizedOperationId) {
      const receipt = resolvePlannerBridgeReceipt(profile, {
        operationId: normalizedOperationId,
        kind: operationKind,
        requestHash,
      });
      if (receipt.status === "mismatch") return { outcome: "rejected", reason: receipt.reason };
      if (receipt.status === "replay") return { ...receipt.result, idempotentReplay: true };
    }

    const { draft } = resolvePlannerDraftForDate(profile, targetDate);
    const currentRevision = computePlannerContextBaseRevision({ draft });
    const rebasedEquivalentRevision = expectedRevision !== currentRevision
      && plannerRevisionsHaveSameContent(expectedRevision, currentRevision);
    const patchBaseRevision = rebasedEquivalentRevision ? currentRevision : expectedRevision;

    const applyResult = applyPlannerPatch({
      draft,
      settings: profile.scheduleAssistantSettings || {},
      books,
      readingSessions,
      patch: {
        schemaVersion: PLANNER_PATCH_SCHEMA_VERSION,
        date: targetDate,
        baseRevision: patchBaseRevision,
        changes: mutation.changes,
      },
      now,
    });

    if (!applyResult.ok) {
      if (applyResult.reason === "stale") return { outcome: "stale", currentRevision: applyResult.currentRevision };
      if (applyResult.reason === "conflict") return { outcome: "conflict", conflicts: applyResult.conflicts };
      return {
        outcome: "rejected",
        reason: applyResult.reason,
        problems: applyResult.problems,
        rejections: applyResult.rejections,
      };
    }

    const nextDraft = {
      ...applyResult.nextDraft,
      targetDate,
      savedOn: targetDate,
      updatedAt: now.toISOString(),
    };
    const appliedRevision = computePlannerContextBaseRevision({ draft: nextDraft });
    const result = {
      outcome: "applied",
      changedBlockIds: applyResult.changedBlockIds,
      summary: applyResult.summary,
      appliedRevision,
      rebasedEquivalentRevision,
    };

    const writePatch = buildPlannerDateWritePatch(profile, targetDate, nextDraft);
    if (normalizedOperationId) {
      writePatch.plannerBridgeOperationReceipts = appendPlannerBridgeReceipt(profile, {
        operationId: normalizedOperationId,
        kind: operationKind,
        requestHash,
        result,
        now,
      });
    }
    transaction.set(userRef, writePatch, { merge: true });

    if (typeof onApplied === "function") {
      await onApplied({ transaction, userRef, context: adapterContext, result, nextDraft });
    }

    return result;
  });
}
