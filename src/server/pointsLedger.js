// Server-side points domain layer — LOW-LEVEL primitives.
//
// These functions are designed to be called INSIDE an existing Firestore
// transaction. The CALLER owns the transaction lifecycle:
//   1. tx.get(profileRef) → read balanceBefore
//   2. Compute delta from business intent
//   3. Call buildPointsPatch() to get {profilePatch, ledgerRow}
//   4. Merge business fields into profilePatch
//   5. tx.set(profileRef, mergedProfilePatch, {merge: true})
//   6. tx.set(ledgerRef, ledgerRow)
//
// This guarantees exactly ONE write to profileRef per transaction.

import { POINT_TRANSACTIONS_COLLECTION } from "./rewardShopCore.js";

const ROUND_PRECISION = 2;

function round(v) {
  return Math.round((Number(v) || 0) * Math.pow(10, ROUND_PRECISION)) / Math.pow(10, ROUND_PRECISION);
}

// Lazy-loaded FieldValue (server-only, never imported in browser)
let _FieldValue = null;
function getFieldValue() {
  if (_FieldValue) return _FieldValue;
  try { const m = require("firebase-admin/firestore"); _FieldValue = m.FieldValue; return _FieldValue; }
  catch { _FieldValue = false; return null; }
}
export function serverTimestampField() {
  const FV = getFieldValue();
  return FV ? FV.serverTimestamp() : new Date().toISOString();
}
function adminIncrement(n) {
  const FV = getFieldValue();
  if (!FV) return round(n);
  try { return FV.increment(round(n)); }
  catch { return round(n); }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Build the profile patch and ledger row for a points delta.
 * Call INSIDE a transaction. Caller should merge business fields into the
 * returned profilePatch, then write both profilePatch and ledgerRow via tx.
 *
 * @returns {{ profilePatch: object, ledgerRow: object, balanceAfter: number }}
 */
export function buildPointsPatch({ balanceBefore, delta, metadata }) {
  const balanceAfter = round(balanceBefore + delta);
  const profilePatch = {
    points: balanceAfter,
    updatedAt: serverTimestampField(),
  };
  if (delta > 0) {
    profilePatch.rewardTotalEarned = adminIncrement(delta);
  }
  if (delta < 0) {
    profilePatch.rewardTotalSpent = adminIncrement(Math.abs(delta));
  }

  const ledgerRow = {
    type: metadata.type || (delta >= 0 ? "earn" : "spend"),
    amount: delta,
    balanceBefore: round(balanceBefore),
    balanceAfter,
    source: metadata.source || "server",
    relatedEntityId: metadata.relatedEntityId || null,
    idempotencyKey: metadata.idempotencyKey || null,
    actor: metadata.actor || "server",
    description: metadata.description || "",
    createdAt: serverTimestampField(),
  };

  return { profilePatch, ledgerRow, balanceAfter };
}

// ─── Idempotency ──────────────────────────────────────────────────────────

export function idempotencyDocPath(uid, key) {
  return `users/${uid}/rewardIdempotency/${key}`;
}

export async function checkIdempotency(db, uid, key) {
  if (!key) return null;
  const snap = await db.doc(idempotencyDocPath(uid, key)).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return { balanceBefore: data.balanceBefore, balanceAfter: data.balanceAfter, delta: data.delta, replayed: true };
}

export function recordIdempotencyTx(db, uid, key, result, tx) {
  if (!key) return;
  tx.set(db.doc(idempotencyDocPath(uid, key)), {
    balanceBefore: result.balanceBefore,
    balanceAfter: result.balanceAfter,
    delta: result.delta,
    action: result.action || "unknown",
    createdAt: serverTimestampField(),
  });
}
