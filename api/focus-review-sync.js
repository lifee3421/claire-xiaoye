// Vercel serverless endpoint. Narrow, single-purpose: accepts a signed daily
// Focus projection from Cyberboss and merges it into ONE date's
// dailyReviewDraft, writing only autoValue fields it itself derives from
// categoryId — never an arbitrary Firestore path or fieldId supplied by the
// caller. See src/server/focusReviewSyncCore.js for the fully unit-tested
// pure logic this handler wires up to a real Firestore transaction.
//
// Auth: HMAC-SHA256 over `${x-catkeeper-timestamp}.${rawBody}`, using
// CATKEEPER_FOCUS_SYNC_SECRET, verified with a timing-safe compare, with a
// +/-5min timestamp window. The target user's uid comes ONLY from
// CATKEEPER_USER_UID (server env) — never from the request body.
//
// Required env vars (see docs/focus-review-sync-setup.md for exact Vercel
// setup steps): CATKEEPER_USER_UID, CATKEEPER_FOCUS_SYNC_SECRET,
// CATKEEPER_FIREBASE_SERVICE_ACCOUNT (the full service-account JSON, as a
// single-line string).

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  verifyHmacSignature,
  isTimestampFresh,
  validateProjectionPayload,
  aggregateSessionsByCategory,
  buildFieldPatches,
  computeRollbackUpdates,
  mergeFieldUpdates,
  mergeCategoryEntryUpdates,
  applyFieldUpdates,
  applyCategoryEntryUpdates,
  detectMalformedFocusFieldKeys,
  detectMalformedCategoryEntryKeys,
  buildFocusSummary,
  buildFocusSync,
  isNoopSync,
} from "../src/server/focusReviewSyncCore.js";
import { normalizeReviewConfig, REVIEW_BINDINGS, resolveClassificationTaxonomy, isLeafTaxonomyNode, findCanonicalNode } from "../src/taxonomy/taxonomyContract.js";
import { findNodeById } from "../src/review/reviewTaxonomyModel.js";

// Vercel auto-parses JSON bodies by default — HMAC verification needs the
// exact raw bytes that were signed, not a re-serialized copy, so parsing
// must be disabled here.
export const config = { api: { bodyParser: false } };

let firestoreSingleton = null;
function getDb() {
  if (firestoreSingleton) return firestoreSingleton;
  if (!getApps().length) {
    const raw = process.env.CATKEEPER_FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("CATKEEPER_FIREBASE_SERVICE_ACCOUNT is not configured");
    const serviceAccount = JSON.parse(raw);
    initializeApp({ credential: cert(serviceAccount) });
  }
  firestoreSingleton = getFirestore();
  return firestoreSingleton;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_FOCUS_SYNC_SECRET or CATKEEPER_USER_UID)" });
    return;
  }

  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];

  if (!isTimestampFresh(timestamp)) {
    res.status(401).json({ error: "timestamp missing or outside the allowed window" });
    return;
  }
  if (!verifyHmacSignature({ secret, timestamp, rawBody, signature })) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "body is not valid JSON" });
    return;
  }
  // Minimal shape guard BEFORE touching Firestore (.doc(body.date) would
  // throw on a null/non-object body) — the full structural/semantic
  // validation (including the live-taxonomy-aware categoryId check) still
  // happens below via validateProjectionPayload, after the profile fetch.
  if (!body || typeof body !== "object" || typeof body.date !== "string") {
    res.status(400).json({ error: "invalid request body", details: ["body must be an object with a string date"] });
    return;
  }

  try {
    const db = getDb();
    const draftRef = db.collection("users").doc(uid).collection("dailyReviewDrafts").doc(body.date);

    // The real, single taxonomy authority is profile.classificationTaxonomy
    // on the top-level users/{uid} document — the SAME field and the SAME
    // resolveClassificationTaxonomy()/normalizeReviewConfig() pipeline
    // DailyReviewWorkbench/Category Catalog read. (users/{uid}/categories is
    // an unrelated collection — reward-shop product categories — and must
    // never be used as a taxonomy source here.) Fetched BEFORE validation so
    // a session's categoryId can be checked against the user's real live
    // taxonomy, not just the static canonical tree — see isKnownCategoryId
    // below.
    const profileSnap = await db.collection("users").doc(uid).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const resolvedTaxonomy = resolveClassificationTaxonomy(profile);

    // Accepts a categoryId if it's either a static canonical id, OR a real
    // node in the user's OWN live taxonomy that is an active (non-archived)
    // LEAF — never a group heading, never an archived node, never a string
    // that doesn't correspond to anything the user actually has. This is
    // what lets a genuine custom category (e.g. a user-created "做饭" leaf,
    // id not in CANONICAL_TAXONOMY_V3) be accepted, while still rejecting
    // any unknown/garbage categoryId a session might carry.
    const isKnownCategoryId = (categoryId) => {
      if (findCanonicalNode(categoryId)) return true;
      const node = findNodeById(resolvedTaxonomy, categoryId);
      return Boolean(node) && isLeafTaxonomyNode(node) && node.archived !== true;
    };

    const { valid, errors, sessions } = validateProjectionPayload(body, { date: body?.date, isKnownCategoryId });
    if (!valid) {
      res.status(400).json({ error: "invalid request body", details: errors });
      return;
    }

    const { byCategory, unmapped } = aggregateSessionsByCategory(sessions);

    // Only categories WITHOUT a static REVIEW_BINDINGS entry need a live
    // reviewConfig lookup — bound leaves' fields are already fully known
    // from REVIEW_BINDINGS itself.
    const liveReviewConfigById = {};
    for (const categoryId of byCategory.keys()) {
      if (REVIEW_BINDINGS[categoryId]) continue;
      const node = findNodeById(resolvedTaxonomy, categoryId);
      if (node) liveReviewConfigById[categoryId] = normalizeReviewConfig(node);
    }

    const result = await db.runTransaction(async (transaction) => {
      const draftSnap = await transaction.get(draftRef);
      const existing = draftSnap.exists ? draftSnap.data() : null;

      if (isNoopSync(existing?.focusSync, body.sourceRevision)) {
        return { status: "noop", reason: "unchanged sourceRevision" };
      }

      const isSettled = existing?.status === "submitted";
      const currentFields = existing?.fields || {};
      const currentCategoryReviewEntries = existing?.categoryReviewEntries || {};

      const { fieldUpdates, categoryEntryUpdates, fieldProjection } = buildFieldPatches({ byCategory, liveReviewConfigById });
      const rollback = computeRollbackUpdates({
        previousFieldProjection: existing?.focusSync?.fieldProjection || null,
        nextFieldProjection: fieldProjection,
        currentFields,
        currentCategoryReviewEntries,
      });

      // Reconstruct the COMPLETE fields/categoryReviewEntries maps in memory
      // (existing content + this run's updates), using the field/category id
      // as a literal object key throughout — never a Firestore dot-path
      // string. A dot-path like `fields.study.math.linearAlgebra.duration.
      // autoValue` would be parsed by Firestore as 6 levels of NESTED path
      // segments, not as an address for the flat key
      // fields["study.math.linearAlgebra.duration"] the UI actually reads —
      // that was this endpoint's original bug. Passing the full reconstructed
      // map as the value of a plain `fields`/`categoryReviewEntries` key to
      // set(...,{merge:true}) sidesteps the issue entirely: Firestore only
      // interprets DOTS IN THE CALLER'S OWN TOP-LEVEL OBJECT KEYS as path
      // separators, never dots inside a nested object's own property names.
      const nextFields = applyFieldUpdates(currentFields, mergeFieldUpdates(fieldUpdates, rollback.fieldUpdates));
      const nextCategoryReviewEntries = applyCategoryEntryUpdates(currentCategoryReviewEntries, mergeCategoryEntryUpdates(categoryEntryUpdates, rollback.categoryEntryUpdates));

      // One-time cleanup: delete any bogus nested tree a previous (buggy)
      // sync run created under fields/categoryReviewEntries, using
      // FieldValue.delete() — merge:true alone does NOT remove a key just
      // because it's absent from the object you pass; it only touches keys
      // you explicitly include. Never touches a real flat-key field (always
      // has `.autoValue` at its own level) or anything outside fields/
      // categoryReviewEntries.
      for (const key of detectMalformedFocusFieldKeys(currentFields)) nextFields[key] = FieldValue.delete();
      for (const key of detectMalformedCategoryEntryKeys(currentCategoryReviewEntries)) nextCategoryReviewEntries[key] = FieldValue.delete();

      const focusSummary = buildFocusSummary({ byCategory, unmapped, sessions });
      const focusSync = {
        ...buildFocusSync({ date: body.date, timezone: body.timezone, sourceRevision: body.sourceRevision, sessions, byCategory, unmapped, isSettled }),
        fieldProjection,
      };

      // Only ever patches: fields, categoryReviewEntries (both fully
      // reconstructed above, dotted ids as literal keys), focusSummary,
      // focusSync. draft.ui, manual `value`/`manuallyEdited`, diary, period,
      // clientRevision, and every other existing top-level key are left
      // completely untouched by {merge:true}.
      transaction.set(draftRef, { fields: nextFields, categoryReviewEntries: nextCategoryReviewEntries, focusSummary, focusSync }, { merge: true });

      return { status: "ok", sessionCount: sessions.length, mappedSessionCount: focusSync.mappedSessionCount, unmappedSessionCount: focusSync.unmappedSessionCount, hasPostSettlementChanges: focusSync.hasPostSettlementChanges === true };
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
