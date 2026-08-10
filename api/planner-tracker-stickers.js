// HMAC endpoint used before a Snow-dust planning read. It runs the exact same
// TrackerFacts -> sticker decision logic as the browser, but server-side, so a
// due/overdue review tracker can surface on the day's planner even when the
// planner page was never opened.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { resolveEffectiveTrackers } from "../src/utils/trackerDefaults.js";
import { resolveTrackerEvidence } from "../src/utils/trackerFacts.js";
import { resolvePlannerDraftForDate, buildPlannerDateWritePatch } from "../src/schedule/plannerDatePersistence.js";
import { syncTrackerStickersIntoDraft } from "../src/server/plannerTrackerStickerSync.js";

export const config = { api: { bodyParser: false } };

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function loadFacts(db, uid, trackers, date) {
  const snapshot = await db.collection("users").doc(uid).collection("completionEvents")
    .where("occurredOn", "==", date)
    .where("state", "==", "active")
    .get();
  const byTracker = new Map();
  for (const doc of snapshot.docs) {
    const event = { id: doc.id, ...doc.data() };
    if (!byTracker.has(event.trackerId)) byTracker.set(event.trackerId, []);
    byTracker.get(event.trackerId).push(event);
  }
  return trackers.map((tracker) => resolveTrackerEvidence(tracker, {
    events: byTracker.get(tracker.id) || [],
    today: date,
  }));
}

export async function handlePlannerTrackerStickerSync({ db, uid, date, now = new Date() } = {}) {
  if (!isDateString(date)) return { ok: false, reason: "invalid_date" };
  const userRef = db.collection("users").doc(uid);
  const profileSnap = await userRef.get();
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const trackers = resolveEffectiveTrackers(profile);
  const trackerFacts = await loadFacts(db, uid, trackers, date);
  const { draft } = resolvePlannerDraftForDate(profile, date);
  const sync = syncTrackerStickersIntoDraft({ draft, trackers, trackerFacts, localDate: date });
  if (!sync.changed) return { ok: true, status: "noop", actions: [] };

  const nextDraft = { ...sync.draft, targetDate: date, savedOn: date, updatedAt: now.toISOString() };
  // Re-read inside a transaction before writing so a simultaneous browser edit
  // cannot be overwritten by the profile snapshot used to compute the plan.
  return db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(userRef);
    const latest = latestSnap.exists ? latestSnap.data() : {};
    const { draft: latestDraft } = resolvePlannerDraftForDate(latest, date);
    // Recompute against the current draft, retaining the tracker facts from the
    // same request. Tracker facts only decide sticker state; planner mutations
    // between reads are preserved because this second pass starts from latest.
    const latestSync = syncTrackerStickersIntoDraft({ draft: latestDraft, trackers, trackerFacts, localDate: date });
    if (!latestSync.changed) return { ok: true, status: "noop", actions: [] };
    const finalDraft = { ...latestSync.draft, targetDate: date, savedOn: date, updatedAt: now.toISOString() };
    transaction.set(userRef, buildPlannerDateWritePatch(latest, date, finalDraft), { merge: true });
    return { ok: true, status: "synced", actions: latestSync.actions };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method not allowed" }); return; }
  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) { res.status(500).json({ ok: false, error: "server is not configured" }); return; }

  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];
  if (!isTimestampFresh(timestamp) || !verifyHmacSignature({ secret, timestamp, rawBody, signature })) {
    res.status(401).json({ ok: false, error: "invalid or expired signature" }); return;
  }
  let body;
  try { body = JSON.parse(rawBody); }
  catch { res.status(400).json({ ok: false, error: "body is not valid JSON" }); return; }
  const date = String(body?.date || "").trim();
  if (!isDateString(date)) { res.status(400).json({ ok: false, reason: "invalid_date" }); return; }

  try {
    const result = await handlePlannerTrackerStickerSync({ db: getDb(), uid, date });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || "internal error" });
  }
}
