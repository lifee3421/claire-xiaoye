// Vercel serverless endpoint. Snow-dust calls this when it needs a
// PlannerContext for a date but has no cached copy yet (e.g. user never
// opened the 小猫管家 planner page for that date). The response is the same
// PlannerContext schema the browser push already uses — Snow-dust can cache
// it locally and feed it into the same planning-discussion tools.
//
// Unlike the browser-side buildAutoSchedulePlan path (which runs
// choosePlannerPlacement and fills timeline/taskPool/capacity with scheduled
// blocks), this endpoint has no access to the client-side placement
// algorithm. It therefore returns a PlannerContext where:
//   - baseRevision: computed from the real draft (concurrency safety works)
//   - timeline / taskPool / capacity: empty (plan={}; Snow-dust must not
//     attempt to move blocks it can't see — just discuss targets/trackers)
//   - targets: from profile study targets + draft overrides
//   - trackers: from CompletionEvents already in Firestore
//   - actual: always {status:"unknown"} (no dailyFacts server-side)
//
// The browser push (sendPlannerContext) is NOT deprecated — it still sends
// a richer context (with computed timeline) when the user opens the page.
// This endpoint is the FALLBACK for when Snow-dust needs to start a
// discussion before the user opens the page.
//
// Auth: same HMAC-SHA256 scheme as api/planner-apply.js (POST body signed
// with CATKEEPER_PLANNER_BRIDGE_SECRET). Body: { date: "YYYY-MM-DD" }.
// Required env vars: CATKEEPER_USER_UID, CATKEEPER_PLANNER_BRIDGE_SECRET,
// CATKEEPER_FIREBASE_SERVICE_ACCOUNT.

import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { buildPlannerContext } from "../src/agent/buildPlannerContext.js";
import { resolveEffectiveTrackers } from "../src/utils/trackerDefaults.js";
import { resolveTrackerEvidence } from "../src/utils/trackerFacts.js";
import { resolveDailyStudyTargets, resolveEffectiveTarget } from "../src/schedule/studyTargetResolver.js";

export const config = { api: { bodyParser: false } };

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Fetches all CompletionEvents for `date` and groups them by trackerId so
 * that resolveTrackerEvidence can compute per-tracker facts.
 */
async function loadTrackerFactsForDate(db, uid, trackers, date) {
  const snapshot = await db.collection("users").doc(uid).collection("completionEvents")
    .where("occurredOn", "==", date)
    .where("state", "==", "active")
    .get();
  const eventsByTracker = new Map();
  for (const docSnap of snapshot.docs) {
    const event = { id: docSnap.id, ...docSnap.data() };
    if (!eventsByTracker.has(event.trackerId)) eventsByTracker.set(event.trackerId, []);
    eventsByTracker.get(event.trackerId).push(event);
  }
  return trackers.map((tracker) =>
    resolveTrackerEvidence(tracker, { events: eventsByTracker.get(tracker.id) || [], today: date }),
  );
}

/**
 * Core logic, exported for unit testing. Reads Firestore, builds and
 * returns the PlannerContext for `date`. Never writes anything.
 */
export async function handlePlannerContextRequest({ db, uid, date, now = new Date() } = {}) {
  if (!isDateString(date)) {
    return { outcome: "invalid_date", date };
  }

  const [draftSnap, profileSnap] = await Promise.all([
    db.collection("users").doc(uid).collection("dailyReviewDrafts").doc(date).get(),
    db.collection("users").doc(uid).get(),
  ]);

  const draft = draftSnap.exists ? draftSnap.data() : {};
  const profile = profileSnap.exists ? profileSnap.data() : {};

  const trackers = resolveEffectiveTrackers(profile);
  const trackerFacts = await loadTrackerFactsForDate(db, uid, trackers, date);

  // Study target: use the draft's frozen snapshot if one exists (plan already
  // confirmed for this date), otherwise fall back to profile defaults + draft
  // overrides. This mirrors the client-side resolveEffectiveTarget call.
  const draftResolved = resolveDailyStudyTargets({
    defaults: profile.studyTargetDefaults,
    overrides: draft.studyTargetOverrides,
  });
  const effectiveStudyTarget = resolveEffectiveTarget({
    snapshot: draft.studyTargetSnapshot,
    draftResolved,
  });

  const timezone = profile.timezone || draft.timezone || "Asia/Shanghai";

  // plan={}: no buildAutoSchedulePlan server-side (client-only). The resulting
  // PlannerContext has empty timeline/taskPool/capacity — Snow-dust can see
  // targets and tracker state but not the scheduled block layout.
  const context = buildPlannerContext({
    date,
    timezone,
    now,
    draft,
    plan: {},
    effectiveStudyTarget,
    studyTargetProgress: [],
    dailyFacts: null,
    trackerDefs: trackers,
    trackerFacts,
    trackerFactsStatus: "ready",
    reviewContext: {},
  });

  return { outcome: "ok", context };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_PLANNER_BRIDGE_SECRET/CATKEEPER_FOCUS_SYNC_SECRET or CATKEEPER_USER_UID)" });
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

  const date = typeof body?.date === "string" ? body.date.trim() : "";
  if (!isDateString(date)) {
    res.status(400).json({ error: "invalid request body", details: ["date must be YYYY-MM-DD"] });
    return;
  }

  try {
    const result = await handlePlannerContextRequest({ db: getDb(), uid, date });
    if (result.outcome !== "ok") {
      res.status(400).json({ error: "invalid_date", date });
      return;
    }
    res.status(200).json({ context: result.context });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
