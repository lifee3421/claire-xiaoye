// applyPointsCommand — the SINGLE implementation of every points write.
//
// Called by:
//   - api/points.js (Vercel serverless endpoint, with auth)
//   - src/server/pointsLedgerConcurrent.test.js (emulator concurrency tests)
//
// Every action runs inside ONE Admin SDK transaction that:
//   1. Reads current balance
//   2. Validates business conditions
//   3. Computes delta (NEVER from client input)
//   4. Writes points + pointTransactions + business documents
//
// This module never assumes auth — the caller (api/points.js) handles that.
// The `actor` field is for the ledger audit trail.

import {
  buildPointsPatch,
  checkIdempotency,
  recordIdempotencyTx,
  serverTimestampField,
} from "./pointsLedger.js";
import { roundPoints } from "../utils/calculations.js";

const round = roundPoints;

// ─── Action allow-list ────────────────────────────────────────────────────

export const SUPPORTED_ACTIONS = [
  "earn_schedule_goal",
  "spend_entertainment",
  "apply_settlement",
  "create_settlement",
  "revise_settlement",
  "project_reward",
  "rollback_settlement",
  "rollback_redemption",
];

// ─── Top-level entry point ────────────────────────────────────────────────

/**
 * @param {object} db       - Firestore Admin SDK db instance
 * @param {string} uid      - resolved user id (caller handles auth)
 * @param {object} command  - { action, payload, actor }
 * @returns {Promise<{ok: true, balanceBefore, balanceAfter, delta, action}>}
 */
export async function applyPointsCommand(db, uid, { action, payload = {}, actor = "server" } = {}) {
  if (!SUPPORTED_ACTIONS.includes(action)) {
    return { ok: false, code: "unsupported_action", error: `unsupported action: ${action}`, supported: SUPPORTED_ACTIONS };
  }

  const idk = payload.idempotencyKey || "";

  // Idempotency check BEFORE transaction
  if (idk) {
    const existing = await checkIdempotency(db, uid, idk);
    if (existing) return { ok: true, ...existing, replayed: true };
  }

  return db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(db.doc(`users/${uid}`));
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const balanceBefore = round(Number(profile.points || 0));
    const profileRef = db.doc(`users/${uid}`);
    const ts = serverTimestampField();

    const writeToProfile = (patch, ledgerRow) => {
      tx.set(profileRef, patch, { merge: true });
      tx.set(db.collection(`users/${uid}/pointTransactions`).doc(), ledgerRow);
    };

    let finalResult = null;

    // ── earn_schedule_goal ─────────────────────────────────────────────
    if (action === "earn_schedule_goal") {
      const amount = round(Math.abs(Number(payload.amount || 1)));
      const goalEntry = payload.goalEntry || payload._goalEntry || {};
      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta: amount,
        metadata: { type: "earn", source: "schedule_segment_goal", description: "完成日程段目标", relatedEntityId: goalEntry.date || null, idempotencyKey: idk, actor },
      });
      Object.assign(profilePatch, { scheduleSegmentGoals: { [goalEntry.date || "unknown"]: goalEntry } });
      writeToProfile(profilePatch, ledgerRow);
      finalResult = { ok: true, balanceBefore, balanceAfter, delta: amount, action };
    }

    // ── spend_entertainment ────────────────────────────────────────────
    else if (action === "spend_entertainment") {
      const pointsSpent = round(Math.abs(Number(payload.pointsSpent || 0)));
      const ext = payload._extension || {};
      if (balanceBefore < pointsSpent) throw Object.assign(new Error("余额不足"), { code: "INSUFFICIENT_BALANCE" });

      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta: -pointsSpent,
        metadata: { type: "spend", source: "entertainment_extension", description: `娱乐加时 +${Number(ext.minutes || payload.minutes || 0)}min`, idempotencyKey: idk, actor },
      });
      writeToProfile(profilePatch, ledgerRow);

      const extRef = db.collection(`users/${uid}/entertainmentExtensions`).doc();
      tx.set(extRef, { date: ext.date || payload.date || "", minutes: Number(ext.minutes || payload.minutes || 0), pointsSpent, reason: ext.reason || payload.reason || "", thesisOutput: ext.thesisOutput || payload.thesisOutput || "", checks: ext.checks || payload.checks || {}, createdAt: ts });
      tx.set(db.collection(`users/${uid}/redemptions`).doc(), { type: "entertainment_extension", extensionId: extRef.id, productName: `当日娱乐加时 +${Number(ext.minutes || payload.minutes || 0)}min`, categoryId: "entertainment_extension", price: pointsSpent, remainingPoints: balanceAfter, minutes: Number(ext.minutes || payload.minutes || 0), date: ext.date || payload.date || "", note: ext.reason || payload.reason || "", createdAt: ts });
      finalResult = { ok: true, balanceBefore, balanceAfter, delta: -pointsSpent, action };
    }

    // ── apply_settlement ───────────────────────────────────────────────
    else if (action === "apply_settlement") {
      const settlement = payload.settlement || {};
      const draft = payload.draft || {};
      const settlementId = settlement.existingSettlementId || settlement.reviewDate;
      if (!settlement.reviewDate || !settlementId) throw new Error("缺少复盘日期");

      const settlementRef = db.doc(`users/${uid}/settlements/${settlementId}`);
      const existingSnap = await tx.get(settlementRef);
      const previous = existingSnap.exists ? { id: existingSnap.id, ...existingSnap.data() } : null;
      const pointDelta = round(Number(settlement.pointsAdded || 0) - Number(previous?.pointsAdded || 0));
      const revision = previous ? (Number(previous.settlementRevision) + 1) : 0;

      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta: pointDelta,
        metadata: { type: pointDelta >= 0 ? "earn" : "spend", source: "settlement_review", description: `每日复盘结算${settlement.reviewDate}`, relatedEntityId: settlementId, idempotencyKey: idk, actor },
      });
      Object.assign(profilePatch, { todayBalanceMinutes: Number(settlement.generatedMinutes), nextDayBaseEntertainmentLimit: 60, nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "", nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "" });
      if (settlement.health?.maskStatus === "已敷" && settlement.reviewDate) profilePatch.lastMaskDate = settlement.reviewDate;
      writeToProfile(profilePatch, ledgerRow);

      tx.set(settlementRef, { ...settlement, reviewSchemaVersion: 2, reviewDraftDate: settlement.reviewDate, settlementRevision: revision, reconciliationHistory: previous ? [...(Array.isArray(previous.reconciliationHistory) ? previous.reconciliationHistory : []), { beforePointsAdded: Number(previous.pointsAdded || 0), afterPointsAdded: Number(settlement.pointsAdded || 0), delta: pointDelta, reason: "manual_review_revision", at: new Date().toISOString() }] : [], pointsAdded: round(settlement.pointsAdded), createdAt: previous?.createdAt || ts, updatedAt: ts }, { merge: true });
      tx.set(db.doc(`users/${uid}/dailyReviewDrafts/${settlement.reviewDate}`), { ...draft, schemaVersion: 2, date: settlement.reviewDate, timezone: "Asia/Shanghai", status: "submitted", linkedSettlementId: settlementRef.id, submittedAt: ts, updatedAt: ts }, { merge: true });
      finalResult = { ok: true, balanceBefore, balanceAfter, delta: pointDelta, action, settlementRevision: revision };
    }

    // ── create_settlement ──────────────────────────────────────────────
    else if (action === "create_settlement") {
      const settlement = payload.settlement || {};
      const delta = round(Number(settlement.pointsAdded || 0));
      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta,
        metadata: { type: delta >= 0 ? "earn" : "spend", source: "settlement_review", description: `每日复盘结算${settlement.reviewDate || ""}`, relatedEntityId: settlement.reviewDate || null, idempotencyKey: idk, actor },
      });
      Object.assign(profilePatch, { todayBalanceMinutes: Number(settlement.generatedMinutes), nextDayBaseEntertainmentLimit: 60, nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "", nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "" });
      writeToProfile(profilePatch, ledgerRow);

      const sRef = settlement.reviewDate ? db.doc(`users/${uid}/settlements/${settlement.reviewDate}`) : db.collection(`users/${uid}/settlements`).doc();
      const sDoc = { ...settlement };
      for (const f of ["studyMinutes","exerciseMinutes","sleepAdjustment","allocatedGameMinutesForToday","actualGameMinutesToday","gameOverrun","gameOverrunAdjustment","beneficialMinutes","totalEntertainmentMinutes","entertainmentOverLimitMinutes","entertainmentPenaltyPoints","generatedMinutes","availableMinutes"]) sDoc[f] = Number(settlement[f] || 0);
      sDoc.tomorrowGameMinutes = 0; sDoc.nextDayBaseEntertainmentLimit = 60; sDoc.pointsAdded = round(settlement.pointsAdded); sDoc.reviewDate = settlement.reviewDate || ""; sDoc.createdAt = ts;
      tx.set(sRef, sDoc);

      if (settlement.reviewSchemaVersion === 2 && settlement.reviewDraftDate) tx.set(db.doc(`users/${uid}/dailyReviewDrafts/${settlement.reviewDraftDate}`), { schemaVersion: 2, date: settlement.reviewDraftDate, timezone: "Asia/Shanghai", status: "submitted", linkedSettlementId: sRef.id, submittedAt: ts, updatedAt: ts }, { merge: true });
      finalResult = { ok: true, balanceBefore, balanceAfter, delta, action };
    }

    // ── revise_settlement ──────────────────────────────────────────────
    else if (action === "revise_settlement") {
      const settlement = payload.settlement || {};
      const prevS = payload.previousSettlement || {};
      if (!prevS.id) throw new Error("缺少需要修订的结算记录");
      const delta = round(Number(settlement.pointsAdded || 0) - Number(prevS.pointsAdded || 0));
      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta,
        metadata: { type: delta >= 0 ? "earn" : "spend", source: "settlement_revision", description: "复盘修订", relatedEntityId: prevS.id, idempotencyKey: idk, actor },
      });
      Object.assign(profilePatch, { todayBalanceMinutes: Number(settlement.generatedMinutes), nextDayBaseEntertainmentLimit: 60, nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "", nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "" });
      writeToProfile(profilePatch, ledgerRow);

      tx.set(db.doc(`users/${uid}/settlements/${prevS.id}`), { ...settlement, reviewSchemaVersion: 2, reviewDraftDate: settlement.reviewDraftDate || settlement.reviewDate || "", settlementRevision: Number(prevS.settlementRevision || 0) + 1, reconciliationHistory: [...(Array.isArray(prevS.reconciliationHistory) ? prevS.reconciliationHistory : []), { beforePointsAdded: Number(prevS.pointsAdded || 0), afterPointsAdded: Number(settlement.pointsAdded || 0), delta, reason: "manual_review_revision", at: new Date().toISOString() }], updatedAt: ts }, { merge: true });
      if (settlement.reviewDraftDate) tx.set(db.doc(`users/${uid}/dailyReviewDrafts/${settlement.reviewDraftDate}`), { schemaVersion: 2, date: settlement.reviewDraftDate, timezone: "Asia/Shanghai", status: "submitted", submittedAt: ts, updatedAt: ts }, { merge: true });
      finalResult = { ok: true, balanceBefore, balanceAfter, delta, action };
    }

    // ── project_reward ─────────────────────────────────────────────────
    else if (action === "project_reward") {
      const finalPts = round(Number(payload.finalPoints || 0));
      const delta = round(finalPts - round(Number(payload.existingFinalPoints || 0)));
      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta,
        metadata: { type: delta >= 0 ? "earn" : "adjustment", source: "project_reward", description: payload.description || "结项奖励", relatedEntityId: payload.applicationId || null, idempotencyKey: idk, actor },
      });
      writeToProfile(profilePatch, ledgerRow);
      const appPayload = { eventName: payload.eventName || "", eventBookLink: payload.eventBookLink || "", archived: payload.archived === true, result: payload.result || "", requestedPoints: Number(payload.requestedPoints || 0), finalPoints: finalPts, note: payload.note || "", status: finalPts > 0 ? "approved" : "draft", updatedAt: ts };
      if (payload.applicationId) tx.set(db.doc(`users/${uid}/projectRewardApplications/${payload.applicationId}`), appPayload, { merge: true });
      else tx.set(db.collection(`users/${uid}/projectRewardApplications`).doc(), { ...appPayload, createdAt: ts });
      if (delta) tx.set(db.collection(`users/${uid}/redemptions`).doc(), { type: "project_reward", productName: `结项奖励：${payload.eventName || "未命名"}`, categoryId: "project_reward", price: -delta, pointsAdded: delta, remainingPoints: balanceAfter, note: payload.note || "", createdAt: ts });
      finalResult = { ok: true, balanceBefore, balanceAfter, delta, action };
    }

    // ── rollback_settlement ────────────────────────────────────────────
    else if (action === "rollback_settlement") {
      const ptsToRemove = round(Math.abs(Number(payload.pointsToRemove || 0)));
      const delta = -ptsToRemove;
      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta,
        metadata: { type: "adjustment", source: "settlement_rollback", description: payload.description || "结算回滚", idempotencyKey: idk, actor },
      });
      const fallback = payload.fallbackProfile || {};
      Object.assign(profilePatch, { todayBalanceMinutes: Number(fallback.todayBalanceMinutes || 0), nextDayBaseEntertainmentLimit: 60, nextDayEntertainmentLimitReason: fallback.nextDayEntertainmentLimitReason || "", nextDayEntertainmentSourceDayType: fallback.nextDayEntertainmentSourceDayType || "normal_progress_day" });
      writeToProfile(profilePatch, ledgerRow);
      for (const sid of (payload.settlementIds || [])) tx.delete(db.doc(`users/${uid}/settlements/${sid}`));
      for (const ev of (payload.eventRetractions || [])) { if (ev.id) tx.set(db.doc(`users/${uid}/completionEvents/${ev.id}`), ev, { merge: true }); }
      finalResult = { ok: true, balanceBefore, balanceAfter, delta, action };
    }

    // ── rollback_redemption ────────────────────────────────────────────
    else if (action === "rollback_redemption") {
      const refund = round(Math.abs(Number(payload.priceToRefund || 0)));
      const delta = refund;
      const { profilePatch, ledgerRow, balanceAfter } = buildPointsPatch({
        balanceBefore, delta,
        metadata: { type: "adjustment", source: "redemption_rollback", description: payload.description || "兑换回滚", idempotencyKey: idk, actor },
      });
      writeToProfile(profilePatch, ledgerRow);
      if (payload.redemptionId) tx.delete(db.doc(`users/${uid}/redemptions/${payload.redemptionId}`));
      if (payload.extensionId) tx.delete(db.doc(`users/${uid}/entertainmentExtensions/${payload.extensionId}`));
      if (payload.productId) tx.update(db.doc(`users/${uid}/products/${payload.productId}`), { status: "wishlist", updatedAt: ts });
      finalResult = { ok: true, balanceBefore, balanceAfter, delta, action };
    }

    if (idk) recordIdempotencyTx(db, uid, idk, finalResult, tx);
    return finalResult;
  });
}
